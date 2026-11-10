import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { manualSourceId } from "../connectors/registry.js";
import { one, query, tx } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound, parse } from "../lib/http.js";
import { PART_BY_CODE, PART_TYPES } from "../lib/parts-dictionary.js";
import { normRef } from "../lib/text.js";
import { aiAnalyzePhoto, aiAvailable } from "../services/ai.js";
import { runSearch } from "../services/search.js";

export const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const optStr = (max = 200) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const optInt = (min: number, max: number) =>
  z.union([z.number(), z.string()]).optional().transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `Debe ser un número entre ${min} y ${max}` });
      return z.NEVER;
    }
    return n;
  });

export const vehicleDataSchema = z.object({
  make: optStr(60), model: optStr(80), generation: optStr(60), year: optInt(1950, 2100), engine_code: optStr(30),
  fuel: optStr(30), power_kw: optInt(1, 2000), transmission: optStr(40), displacement_cc: optInt(50, 20000), version: optStr(120), vin: optStr(17),
});

const searchSchema = z.object({
  vehicle: optStr(40),
  vehicleId: z.uuid().optional(),
  vehicleData: vehicleDataSchema.optional(),
  part: optStr(200),
  partCode: z.string().optional().refine((v) => !v || PART_BY_CODE.has(v), "Tipo de pieza no válido"),
  side: z.enum(["izquierdo", "derecho"]).optional(),
  axle: z.enum(["delantero", "trasero"]).optional(),
  ref: optStr(60),
  customerId: z.uuid().optional(),
});

router.get("/parts", (_req, res) => {
  res.json(PART_TYPES.map((p) => ({ code: p.code, name: p.name, category: p.category, sided: !!p.sided, axle: !!p.axle, specs: p.specs })));
});

router.get("/capabilities", (_req, res) => {
  res.json({ ai: aiAvailable() });
});

router.post("/", async (req, res) => {
  const b = parse(searchSchema, req.body);
  if (!b.vehicle && !b.vehicleId && !b.ref && !b.part) throw new HttpError(400, "Indique matrícula o bastidor y la pieza, o una referencia");
  if (b.vehicleData?.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(b.vehicleData.vin.replace(/[\s-]/g, ""))) throw new HttpError(400, "El bastidor debe tener 17 caracteres (sin I, O ni Q)");
  try {
    const r = await runSearch(b, req.user!.id);
    res.json(r);
  } catch (e) {
    const s = (e as { status?: number }).status;
    if (s) throw new HttpError(s, (e as Error).message);
    throw e;
  }
});

/** Búsqueda por fotografía: la IA identifica el tipo de pieza y transcribe referencias visibles. */
router.post("/photo", upload.single("photo"), async (req, res) => {
  if (!aiAvailable()) throw new HttpError(503, "El reconocimiento por fotografía requiere configurar la clave de la API de Claude (ANTHROPIC_API_KEY) en el servidor.");
  const f = req.file;
  if (!f) throw new HttpError(400, "Adjunte una fotografía");
  const mime = f.mimetype as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) throw new HttpError(400, "Formato de imagen no admitido (JPG, PNG, WEBP)");
  const r = await aiAnalyzePhoto(f.buffer, mime);
  if (!r) throw new HttpError(422, "La IA no ha podido analizar la imagen");
  await audit(req, "busqueda.foto", "search", null, { part_code: r.part_code, refs: r.visible_references.length });
  res.json({
    ...r,
    part_name: PART_BY_CODE.get(r.part_code)?.name ?? null,
    disclaimer: "Lectura realizada por IA a partir de la imagen. Verifique la referencia en la pieza antes de confirmar.",
  });
});

router.get("/history/:id", async (req, res) => {
  const r = await one(`SELECT id, result, created_at FROM searches WHERE id=$1`, [String(req.params.id)]);
  if (!r) throw notFound("Búsqueda");
  res.json({ ...r.result, id: r.id, createdAt: r.created_at, fromHistory: true });
});

/** Registrar una referencia OEM consultada manualmente en el catálogo original del fabricante. */
router.post("/register-oem", async (req, res) => {
  const b = parse(
    z.object({
      vehicleId: z.uuid(),
      partCode: z.string().refine((v) => PART_BY_CODE.has(v), "Tipo de pieza no válido"),
      oemRef: z.string().trim().min(3).max(60),
      description: z.string().trim().min(2).max(200),
      verified: z.boolean(),
      sourceNote: z.string().trim().max(200).optional(),
      supersededBy: z.string().trim().max(60).optional(),
      side: z.enum(["izquierdo", "derecho"]).optional(),
      axle: z.enum(["delantero", "trasero"]).optional(),
    }),
    req.body,
  );
  const v = await one(`SELECT * FROM vehicles WHERE id=$1`, [b.vehicleId]);
  if (!v) throw notFound("Vehículo");
  if (!v.make || !v.model) throw new HttpError(400, "El vehículo debe tener al menos marca y modelo para registrar la aplicación");
  const ref = normRef(b.oemRef);
  const sourceId = await manualSourceId("oem");
  const label = `Registro manual — ${req.user!.name}${b.sourceNote ? ` (${b.sourceNote})` : ""}`;
  const id = await tx(async (c) => {
    const r = await c.query(
      `INSERT INTO oem_references (oem_ref, oem_ref_display, vehicle_make, part_code, description, superseded_by, source_id, source_label, verified, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (oem_ref, vehicle_make, COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET description=EXCLUDED.description, part_code=EXCLUDED.part_code, verified=EXCLUDED.verified OR oem_references.verified,
         superseded_by=COALESCE(EXCLUDED.superseded_by, oem_references.superseded_by), updated_at=now()
       RETURNING id`,
      [ref, b.oemRef.trim().toUpperCase(), v.make, b.partCode, b.description, b.supersededBy ? normRef(b.supersededBy) : null, sourceId, label, b.verified, req.user!.id],
    );
    const oid = r.rows[0].id;
    const position = [b.axle, b.side].filter(Boolean).join(" ") || null;
    const dup = await c.query(
      `SELECT 1 FROM oem_applications WHERE oem_reference_id=$1 AND lower(make)=lower($2) AND lower(coalesce(model,''))=lower($3)
         AND engine_codes = $4 AND coalesce(position,'') = coalesce($5,'')`,
      [oid, v.make, v.model, v.engine_code ? [v.engine_code] : [], position],
    );
    if (!dup.rowCount) {
      await c.query(
        `INSERT INTO oem_applications (oem_reference_id, make, model, generation, engine_codes, fuel, transmission, position, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [oid, v.make, v.model, v.generation, v.engine_code ? [v.engine_code] : [], v.fuel, null, position, `Registrada desde el vehículo ${v.plate ?? v.vin ?? v.id}`],
      );
    }
    return oid;
  });
  await audit(req, "oem.registro_manual", "oem_reference", id, { ref, vehicle: b.vehicleId, verified: b.verified });
  res.status(201).json({ id });
});

router.get("/saved", async (req, res) => {
  const r = await query(`SELECT id, search_id, item, note, created_at FROM saved_results WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user!.id]);
  res.json(r.rows);
});

router.post("/saved", async (req, res) => {
  const b = parse(z.object({ searchId: z.uuid().optional(), item: z.record(z.string(), z.unknown()), note: z.string().max(500).optional() }), req.body);
  const r = await one(`INSERT INTO saved_results (user_id, search_id, item, note) VALUES ($1,$2,$3,$4) RETURNING id`, [
    req.user!.id, b.searchId ?? null, JSON.stringify(b.item), b.note ?? null,
  ]);
  res.status(201).json(r);
});

router.delete("/saved/:id", async (req, res) => {
  await query(`DELETE FROM saved_results WHERE id=$1 AND user_id=$2`, [String(req.params.id), req.user!.id]);
  res.json({ ok: true });
});
