/**
 * Asistente de IA (Claude) — OPCIONAL.
 *
 * Solo se activa si el servidor tiene ANTHROPIC_API_KEY. Su papel está acotado:
 *  - Interpretar denominaciones que el diccionario no reconoce, eligiendo SIEMPRE entre los
 *    códigos de pieza existentes (salida estructurada con enumeración cerrada).
 *  - Leer en una fotografía el tipo de pieza y las referencias impresas en la etiqueta.
 * La IA no genera referencias de catálogo, precios ni compatibilidades: lo que lee en una foto
 * se usa como texto de búsqueda y se etiqueta como "leído por IA — verificar".
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import { PART_TYPES } from "../lib/parts-dictionary.js";

let client: Anthropic | null = null;
function getClient() {
  if (!config.anthropicConfigured) return null;
  client ??= new Anthropic();
  return client;
}

export function aiAvailable() {
  return config.anthropicConfigured;
}

const CODES = PART_TYPES.map((p) => p.code) as [string, ...string[]];
const CATALOG_TEXT = PART_TYPES.map((p) => `${p.code}: ${p.name} (${p.synonyms.slice(0, 4).join(", ")})`).join("\n");

const SYSTEM = `Eres el asistente técnico de AUTORECA IA, un software para distribuidores de recambios de automóvil en España.
Tu única tarea es clasificar la pieza que pide un trabajador en uno de los códigos del catálogo interno.
Reglas:
- Elige solo un código de la lista. Si no estás seguro o la pieza no está en la lista, responde DESCONOCIDO.
- Nunca inventes referencias, precios ni compatibilidades.
- Indica el lado (izquierdo/derecho) y el eje (delantero/trasero) solo si el texto lo dice explícitamente.
Catálogo de códigos:
${CATALOG_TEXT}`;

const InterpretSchema = z.object({
  part_code: z.enum([...CODES, "DESCONOCIDO"]),
  side: z.enum(["izquierdo", "derecho", "no_indicado"]),
  axle: z.enum(["delantero", "trasero", "no_indicado"]),
  certainty: z.enum(["alta", "media", "baja"]),
  explanation: z.string(),
});
export type AiInterpretation = z.infer<typeof InterpretSchema>;

export async function aiInterpretPart(text: string): Promise<AiInterpretation | null> {
  const c = getClient();
  if (!c) return null;
  const response = await c.messages.parse({
    model: config.aiModel,
    max_tokens: 2000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(InterpretSchema) },
    messages: [{ role: "user", content: `Petición del trabajador: «${text.slice(0, 300)}»` }],
  });
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}

const PhotoSchema = z.object({
  part_code: z.enum([...CODES, "DESCONOCIDO"]),
  certainty: z.enum(["alta", "media", "baja"]),
  visible_references: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(["oem", "fabricante_iam", "desconocido"]),
      brand_on_label: z.string(),
    }),
  ),
  observations: z.string(),
});
export type AiPhotoAnalysis = z.infer<typeof PhotoSchema>;

export async function aiAnalyzePhoto(data: Buffer, mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif"): Promise<AiPhotoAnalysis | null> {
  const c = getClient();
  if (!c) return null;
  const response = await c.messages.parse({
    model: config.aiModel,
    max_tokens: 4000,
    system:
      SYSTEM +
      `\nAdemás, en una fotografía: transcribe exactamente las referencias que se lean en etiquetas o grabados (sin completar dígitos que no se vean). Si no se lee ninguna, devuelve la lista vacía. En "observations" describe en español los rasgos visibles útiles para identificar la pieza (conectores, poleas, nº de dientes visibles) y lo que no se puede determinar.`,
    output_config: { effort: "medium", format: zodOutputFormat(PhotoSchema) },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: data.toString("base64") } },
          { type: "text", text: "Identifica la pieza y transcribe las referencias visibles." },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}
