import { query } from "../db/pool.js";
import { PART_BY_CODE, PART_TYPES, type PartType } from "../lib/parts-dictionary.js";
import { levenshtein, normText } from "../lib/text.js";

export type Side = "izquierdo" | "derecho";
export type Axle = "delantero" | "trasero";

export interface PartInterpretation {
  input: string;
  code: string | null;
  name: string | null;
  category: string | null;
  side: Side | null;
  axle: Axle | null;
  /** 0..1 */
  confidence: number;
  method: "exacto" | "sinonimo" | "correccion_ortografica" | "sinonimo_empresa" | "ia" | "sin_resultado";
  correctedFrom?: string;
  alternatives: { code: string; name: string }[];
  /** Información que falta para poder validar compatibilidades con precisión. */
  missing: string[];
  notes: string[];
  source: string;
}

const SIDE_WORDS: Record<string, Side> = {
  izquierdo: "izquierdo", izquierda: "izquierdo", izq: "izquierdo", izdo: "izquierdo", izda: "izquierdo",
  conductor: "izquierdo",
  derecho: "derecho", derecha: "derecho", dcho: "derecho", dcha: "derecho", der: "derecho",
  copiloto: "derecho", acompanante: "derecho", "acompañante": "derecho",
};
const AXLE_WORDS: Record<string, Axle> = {
  delantero: "delantero", delantera: "delantero", delanteros: "delantero", delanteras: "delantero", del: "delantero",
  trasero: "trasero", trasera: "trasero", traseros: "trasero", traseras: "trasero", tras: "trasero", tra: "trasero",
};
const STOP = new Set(["de", "la", "el", "los", "las", "un", "una", "para", "lado", "y", "con"]);

function extractQualifiers(q: string) {
  const tokens = normText(q).split(" ").filter(Boolean);
  let side: Side | null = null;
  let axle: Axle | null = null;
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // "del" solo es "delantero" si va al final o seguido de un lado (p. ej. "pinza del izq")
    if (t === "del" && i < tokens.length - 1 && !SIDE_WORDS[tokens[i + 1]]) {
      rest.push(t);
      continue;
    }
    if (SIDE_WORDS[t]) { side = SIDE_WORDS[t]; continue; }
    if (AXLE_WORDS[t]) { axle = AXLE_WORDS[t]; continue; }
    rest.push(t);
  }
  return { side, axle, core: rest.join(" ") };
}

function significant(s: string) {
  return s.split(" ").filter((t) => t && !STOP.has(t));
}

interface Candidate { part: PartType; score: number; method: PartInterpretation["method"]; corrected?: string }

function scoreAgainst(core: string, part: PartType): Candidate | null {
  const coreTokens = significant(core);
  if (!coreTokens.length) return null;
  const coreJoined = coreTokens.join(" ");
  let best: Candidate | null = null;
  const consider = (c: Candidate) => { if (!best || c.score > best.score) best = c; };

  for (const syn of [part.name, ...part.synonyms]) {
    const synN = significant(normText(syn)).join(" ");
    if (!synN) continue;
    if (synN === coreJoined) { consider({ part, score: 1, method: "exacto" }); continue; }
    // La consulta contiene el sinónimo completo (por palabras)
    const re = new RegExp(`(^| )${synN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
    if (re.test(coreJoined)) {
      consider({ part, score: 0.8 + Math.min(0.15, synN.length / 200), method: "sinonimo" });
      continue;
    }
    // Corrección ortográfica palabra a palabra
    const synTokens = synN.split(" ");
    if (synTokens.length === coreTokens.length) {
      let dist = 0;
      let ok = true;
      for (let i = 0; i < synTokens.length; i++) {
        const a = synTokens[i];
        const b = coreTokens[i];
        const d = levenshtein(a, b);
        const tol = a.length >= 8 ? 2 : a.length >= 5 ? 1 : 0;
        if (d > tol) { ok = false; break; }
        dist += d;
      }
      if (ok && dist > 0) consider({ part, score: 0.72 - dist * 0.03, method: "correccion_ortografica", corrected: synN });
    }
  }
  return best;
}

/** Resolución síncrona contra el diccionario (para importaciones masivas). Acepta código o texto. */
export function resolvePartCode(text: string | null | undefined, minScore = 0.79): string | null {
  if (!text) return null;
  const up = text.trim().toUpperCase().replace(/\s+/g, "_");
  if (PART_BY_CODE.has(up)) return up;
  const { core } = extractQualifiers(text);
  let best: Candidate | null = null;
  for (const p of PART_TYPES) {
    const c = scoreAgainst(core, p);
    if (c && (!best || c.score > best.score)) best = c;
  }
  return best && best.score >= minScore ? best.part.code : null;
}

export async function interpretPart(input: string): Promise<PartInterpretation> {
  const { side, axle, core } = extractQualifiers(input);
  const base: PartInterpretation = {
    input, code: null, name: null, category: null, side, axle, confidence: 0,
    method: "sin_resultado", alternatives: [], missing: [], notes: [], source: "Diccionario AUTORECA",
  };
  if (!core) return base;

  // 1) Sinónimos propios de la empresa (Configuración)
  const own = await query<{ term: string; part_code: string }>("SELECT term, part_code FROM part_synonyms");
  for (const r of own.rows) {
    if (normText(r.term) === normText(core)) {
      const p = PART_BY_CODE.get(r.part_code);
      if (p) return finalize({ ...base, code: p.code, name: p.name, category: p.category, confidence: 1, method: "sinonimo_empresa", source: "Sinónimos de la empresa" }, p);
    }
  }

  // 2) Diccionario
  const cands = PART_TYPES.map((p) => scoreAgainst(core, p)).filter((c): c is Candidate => !!c).sort((a, b) => b.score - a.score);
  if (!cands.length) return base;
  const top = cands[0];
  const alternatives = cands.slice(1, 4).filter((c) => c.score >= top.score - 0.15).map((c) => ({ code: c.part.code, name: c.part.name }));
  const r: PartInterpretation = {
    ...base,
    code: top.part.code,
    name: top.part.name,
    category: top.part.category,
    confidence: Math.round(top.score * 100) / 100,
    method: top.method,
    correctedFrom: top.method === "correccion_ortografica" ? core : undefined,
    alternatives,
  };
  if (top.method === "correccion_ortografica") r.notes.push(`Se ha interpretado «${core}» como «${top.corrected}».`);
  if (alternatives.length) r.notes.push("Hay otras piezas con denominación parecida; revise si la interpretación es correcta.");
  return finalize(r, top.part);
}

export function finalize(r: PartInterpretation, p: PartType): PartInterpretation {
  if (p.sided && !r.side) r.missing.push("Lado (izquierdo / derecho)");
  if (p.axle && !r.axle) r.missing.push("Eje (delantero / trasero)");
  return r;
}
