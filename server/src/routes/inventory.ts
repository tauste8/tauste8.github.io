import { unlink } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../config.js";
import { one, query } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound, parse } from "../lib/http.js";
import { PART_BY_CODE } from "../lib/parts-dictionary.js";
import { normRef } from "../lib/text.js";
import { requireAdmin } from "../middleware/auth.js";
import { resolvePartCode } from "../services/part-interpreter.js";

export const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 6 } });

const money = z.union([z.number(), z.string()]).optional().nullable().transform((v, ctx) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) { ctx.addIssue({ code: "custom", message: "Importe no válido" }); return z.NEVER; }
  return Math.round(n * 100) / 100;
});
const s = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

const itemSchema = z.object({
  sku: s(60),
  description: z.string().trim().min(2).max(300),
  part_code: z.string().optional().nullable().refine((v) => !v || PART_BY_CODE.has(v), "Tipo de pieza no válido"),
  brand: s(80),
  oem_ref: s(60),
  iam_ref: s(60),
  condition: z.enum(["nuevo", "usado"]),
  purchase_price: money,
  sale_price: money,
  quantity: z.coerce.number().int().min(0).max(1_000_000),
  location: s(120),
  supplier_id: z.uuid().optional().nullable().or(z.literal("")).transform((v) => v || null),
  vehicle_make: s(60),
  vehicle_model: s(80),
  vehicle_year: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === "" || v == null ? null : Number(v))),
  vehicle_engine_code: s(30),
  specs: z.record(z.string(), z.string().max(120)).optional().default({}),
  notes: s(4000),
});

router.get("/", async (req, res) => {
  const params: unknown[] = [];
  const where: string[] = [];
  const q = String(req.query.q ?? "").trim();
  if (q) {
    params.push(`%${q}%`, `%${normRef(q)}%`);
    where.push(`(i.description ILIKE $${params.length - 1} OR i.brand ILIKE $${params.length - 1} OR i.location ILIKE $${params.length - 1} OR i.sku ILIKE $${params.length - 1}
      OR i.oem_ref LIKE $${params.length} OR i.iam_ref LIKE $${params.length})`);
  }
  if (req.query.condition === "nuevo" || req.query.condition === "usado") { params.push(req.query.condition); where.push(`i.condition=$${params.length}`); }
  if (req.query.part_code) { params.push(String(req.query.part_code)); where.push(`i.part_code=$${params.length}`); }
  if (req.query.supplier_id) { params.push(String(req.query.supplier_id)); where.push(`i.supplier_id=$${params.length}`); }
  if (req.query.stock === "con") where.push(`i.quantity > 0`);
  if (req.query.stock === "sin") where.push(`i.quantity = 0`);
  const r = await query(
    `SELECT i.*, s.name AS supplier_name,
       (SELECT array_agg(p.file_id ORDER BY p.position) FROM inventory_photos p WHERE p.item_id=i.id) AS photos
     FROM inventory_items i LEFT JOIN suppliers s ON s.id=i.supplier_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY i.updated_at DESC LIMIT 500`,
    params,
  );
  res.json(r.rows);
});

router.get("/:id", async (req, res) => {
  const r = await one(
    `SELECT i.*, s.name AS supplier_name, (SELECT array_agg(p.file_id ORDER BY p.position) FROM inventory_photos p WHERE p.item_id=i.id) AS photos
     FROM inventory_items i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.id=$1`, [String(req.params.id)]);
  if (!r) throw notFound("Pieza");
  res.json(r);
});

function values(b: z.infer<typeof itemSchema>) {
  return [
    b.sku, b.description, b.part_code || resolvePartCode(b.description), b.brand, normRef(b.oem_ref) || null, b.oem_ref?.toUpperCase() ?? null,
    normRef(b.iam_ref) || null, b.iam_ref?.toUpperCase() ?? null, b.condition, b.purchase_price, b.sale_price, b.quantity, b.location, b.supplier_id,
    b.vehicle_make, b.vehicle_model, b.vehicle_year, b.vehicle_engine_code?.toUpperCase() ?? null, JSON.stringify(b.specs ?? {}), b.notes,
  ];
}

router.post("/", async (req, res) => {
  const b = parse(itemSchema, req.body);
  const r = await one(
    `INSERT INTO inventory_items (sku, description, part_code, brand, oem_ref, oem_ref_display, iam_ref, iam_ref_display, condition, purchase_price, sale_price,
       quantity, location, supplier_id, vehicle_make, vehicle_model, vehicle_year, vehicle_engine_code, specs, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [...values(b), req.user!.id],
  );
  await audit(req, "inventario.alta", "inventory", r.id, { description: r.description });
  res.status(201).json(r);
});

router.put("/:id", async (req, res) => {
  const b = parse(itemSchema, req.body);
  const r = await one(
    `UPDATE inventory_items SET sku=$2, description=$3, part_code=$4, brand=$5, oem_ref=$6, oem_ref_display=$7, iam_ref=$8, iam_ref_display=$9, condition=$10,
       purchase_price=$11, sale_price=$12, quantity=$13, location=$14, supplier_id=$15, vehicle_make=$16, vehicle_model=$17, vehicle_year=$18,
       vehicle_engine_code=$19, specs=$20, notes=$21, updated_at=now() WHERE id=$1 RETURNING *`,
    [String(req.params.id), ...values(b)],
  );
  if (!r) throw notFound("Pieza");
  await audit(req, "inventario.modificacion", "inventory", r.id);
  res.json(r);
});

router.patch("/:id/quantity", async (req, res) => {
  const b = parse(z.object({ delta: z.number().int().min(-100000).max(100000) }), req.body);
  const r = await one(`UPDATE inventory_items SET quantity = quantity + $2, updated_at=now() WHERE id=$1 AND quantity + $2 >= 0 RETURNING id, quantity`, [String(req.params.id), b.delta]);
  if (!r) throw new HttpError(400, "No hay suficientes unidades o la pieza no existe");
  await audit(req, "inventario.ajuste_stock", "inventory", r.id, { delta: b.delta });
  res.json(r);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const photos = await query(`SELECT f.id, f.storage_name FROM inventory_photos p JOIN files f ON f.id=p.file_id WHERE p.item_id=$1`, [String(req.params.id)]);
  const r = await query(`DELETE FROM inventory_items WHERE id=$1`, [String(req.params.id)]);
  if (!r.rowCount) throw notFound("Pieza");
  for (const p of photos.rows) {
    await query(`DELETE FROM files WHERE id=$1`, [p.id]);
    if (p.storage_name) await unlink(path.join(config.uploadsDir, p.storage_name)).catch(() => {});
  }
  await audit(req, "inventario.baja", "inventory", String(req.params.id));
  res.json({ ok: true });
});

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

router.post("/:id/photos", upload.array("photos", 6), async (req, res) => {
  const item = await one(`SELECT id FROM inventory_items WHERE id=$1`, [String(req.params.id)]);
  if (!item) throw notFound("Pieza");
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw new HttpError(400, "Adjunte al menos una fotografía");
  const ids: string[] = [];
  for (const f of files) {
    const ext = IMAGE_TYPES[f.mimetype];
    if (!ext) throw new HttpError(400, `Formato no admitido: ${f.originalname} (use JPG, PNG o WEBP)`);
    // Comprobación de firma del archivo (no se confía solo en la extensión)
    const sig = f.buffer.subarray(0, 12);
    const ok = (ext === ".jpg" && sig[0] === 0xff && sig[1] === 0xd8) || (ext === ".png" && sig[0] === 0x89 && sig[1] === 0x50) || (ext === ".webp" && sig.toString("ascii", 8, 12) === "WEBP");
    if (!ok) throw new HttpError(400, `El archivo ${f.originalname} no es una imagen válida`);
    const r = await one(`INSERT INTO files (original_name, mime, size_bytes, data, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [
      f.originalname.slice(0, 200), f.mimetype, f.size, f.buffer, req.user!.id,
    ]);
    await query(`INSERT INTO inventory_photos (item_id, file_id, position) VALUES ($1,$2,(SELECT coalesce(max(position)+1,0) FROM inventory_photos WHERE item_id=$1))`, [item.id, r.id]);
    ids.push(r.id);
  }
  await audit(req, "inventario.fotos", "inventory", item.id, { count: ids.length });
  res.status(201).json({ ids });
});

router.delete("/:id/photos/:fileId", async (req, res) => {
  const f = await one(`SELECT f.id, f.storage_name FROM inventory_photos p JOIN files f ON f.id=p.file_id WHERE p.item_id=$1 AND p.file_id=$2`, [String(req.params.id), String(req.params.fileId)]);
  if (!f) throw notFound("Fotografía");
  await query(`DELETE FROM files WHERE id=$1`, [f.id]);
  if (f.storage_name) await unlink(path.join(config.uploadsDir, f.storage_name)).catch(() => {});
  res.json({ ok: true });
});
