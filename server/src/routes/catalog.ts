/** Módulos Referencias OEM, Equivalencias IAM y Recambios usados CAT. */
import { Router } from "express";
import { z } from "zod";
import { manualSourceId } from "../connectors/registry.js";
import { one, query, tx } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { notFound, parse } from "../lib/http.js";
import { PART_BY_CODE } from "../lib/parts-dictionary.js";
import { normRef } from "../lib/text.js";
import { requireAdmin } from "../middleware/auth.js";

export const router = Router();

// ───────── OEM ─────────
router.get("/oem", async (req, res) => {
  const params: unknown[] = [];
  const where: string[] = [];
  const q = String(req.query.q ?? "").trim();
  if (q) {
    params.push(`%${normRef(q)}%`, `%${q}%`);
    where.push(`(r.oem_ref LIKE $1 OR r.description ILIKE $2 OR r.vehicle_make ILIKE $2 OR EXISTS (SELECT 1 FROM oem_applications a WHERE a.oem_reference_id=r.id AND (a.model ILIKE $2 OR array_to_string(a.engine_codes,' ') ILIKE $2)))`);
  }
  if (req.query.part_code) { params.push(String(req.query.part_code)); where.push(`r.part_code=$${params.length}`); }
  if (req.query.make) { params.push(String(req.query.make)); where.push(`lower(r.vehicle_make)=lower($${params.length})`); }
  if (req.query.verified === "si") where.push("r.verified");
  if (req.query.verified === "no") where.push("NOT r.verified");
  const r = await query(
    `SELECT r.*, (SELECT count(*) FROM oem_applications a WHERE a.oem_reference_id=r.id)::int AS applications,
       (SELECT count(*) FROM cross_references x WHERE x.oem_ref=r.oem_ref)::int AS equivalences
     FROM oem_references r ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.updated_at DESC LIMIT 500`,
    params,
  );
  res.json(r.rows);
});

router.get("/oem/makes", async (_req, res) => {
  const r = await query(`SELECT DISTINCT vehicle_make FROM oem_references ORDER BY 1`);
  res.json(r.rows.map((x) => x.vehicle_make));
});

router.get("/oem/:id", async (req, res) => {
  const r = await one(`SELECT * FROM oem_references WHERE id=$1`, [String(req.params.id)]);
  if (!r) throw notFound("Referencia OEM");
  const apps = await query(`SELECT * FROM oem_applications WHERE oem_reference_id=$1 ORDER BY model, year_from`, [r.id]);
  const xrefs = await query(`SELECT * FROM cross_references WHERE oem_ref=$1 ORDER BY iam_brand`, [r.oem_ref]);
  const offers = await query(`SELECT o.*, s.name AS supplier_name FROM offers o LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE o.oem_ref=$1 OR o.ref=$1 ORDER BY o.price NULLS LAST LIMIT 100`, [r.oem_ref]);
  res.json({ ...r, applications: apps.rows, crossReferences: xrefs.rows, offers: offers.rows });
});

const appSchema = z.object({
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().max(80).optional().nullable(),
  generation: z.string().trim().max(60).optional().nullable(),
  year_from: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
  year_to: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
  engine_codes: z.array(z.string().trim().max(30)).max(50).default([]),
  fuel: z.string().trim().max(30).optional().nullable(),
  power_kw_from: z.coerce.number().int().min(1).max(2000).optional().nullable(),
  power_kw_to: z.coerce.number().int().min(1).max(2000).optional().nullable(),
  transmission: z.string().trim().max(40).optional().nullable(),
  position: z.string().trim().max(60).optional().nullable(),
});

const oemSchema = z.object({
  oem_ref: z.string().trim().min(3).max(60),
  vehicle_make: z.string().trim().min(1).max(60),
  description: z.string().trim().min(2).max(300),
  part_code: z.string().optional().nullable().refine((v) => !v || PART_BY_CODE.has(v), "Tipo de pieza no válido"),
  superseded_by: z.string().trim().max(60).optional().nullable(),
  verified: z.boolean().default(false),
  source_note: z.string().trim().max(200).optional().nullable(),
  specs: z.record(z.string(), z.string().max(120)).default({}),
  applications: z.array(appSchema).max(200).default([]),
});

const nz = (v: unknown) => (v === "" || v === undefined ? null : v);

async function saveApps(c: { query: (q: string, p: unknown[]) => Promise<unknown> }, id: string, apps: z.infer<typeof appSchema>[]) {
  await c.query(`DELETE FROM oem_applications WHERE oem_reference_id=$1`, [id]);
  for (const a of apps) {
    await c.query(
      `INSERT INTO oem_applications (oem_reference_id, make, model, generation, year_from, year_to, engine_codes, fuel, power_kw_from, power_kw_to, transmission, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, a.make, nz(a.model), nz(a.generation), nz(a.year_from), nz(a.year_to), a.engine_codes.map((e) => e.toUpperCase()).filter(Boolean),
        nz(a.fuel), nz(a.power_kw_from), nz(a.power_kw_to), nz(a.transmission), nz(a.position)],
    );
  }
}

router.post("/oem", async (req, res) => {
  const b = parse(oemSchema, req.body);
  const sourceId = await manualSourceId("oem");
  const id = await tx(async (c) => {
    const r = await c.query(
      `INSERT INTO oem_references (oem_ref, oem_ref_display, vehicle_make, part_code, description, superseded_by, specs, source_id, source_label, verified, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [normRef(b.oem_ref), b.oem_ref.toUpperCase(), b.vehicle_make, b.part_code ?? null, b.description, b.superseded_by ? normRef(b.superseded_by) : null,
        JSON.stringify(b.specs), sourceId, `Registro manual — ${req.user!.name}${b.source_note ? ` (${b.source_note})` : ""}`, b.verified, req.user!.id],
    );
    await saveApps(c, r.rows[0].id, b.applications);
    return r.rows[0].id;
  });
  await audit(req, "oem.alta", "oem_reference", id, { ref: b.oem_ref });
  res.status(201).json({ id });
});

router.put("/oem/:id", async (req, res) => {
  const b = parse(oemSchema, req.body);
  const id = String(req.params.id);
  await tx(async (c) => {
    const r = await c.query(
      `UPDATE oem_references SET oem_ref=$2, oem_ref_display=$3, vehicle_make=$4, part_code=$5, description=$6, superseded_by=$7, specs=$8, verified=$9, updated_at=now()
       WHERE id=$1 RETURNING id`,
      [id, normRef(b.oem_ref), b.oem_ref.toUpperCase(), b.vehicle_make, b.part_code ?? null, b.description, b.superseded_by ? normRef(b.superseded_by) : null,
        JSON.stringify(b.specs), b.verified],
    );
    if (!r.rowCount) throw notFound("Referencia OEM");
    await saveApps(c, id, b.applications);
  });
  await audit(req, "oem.modificacion", "oem_reference", id);
  res.json({ id });
});

router.delete("/oem/:id", requireAdmin, async (req, res) => {
  const r = await query(`DELETE FROM oem_references WHERE id=$1`, [String(req.params.id)]);
  if (!r.rowCount) throw notFound("Referencia OEM");
  await audit(req, "oem.baja", "oem_reference", String(req.params.id));
  res.json({ ok: true });
});

// ───────── IAM ─────────
router.get("/iam", async (req, res) => {
  const params: unknown[] = [];
  const where: string[] = [];
  const q = String(req.query.q ?? "").trim();
  if (q) { params.push(`%${normRef(q)}%`, `%${q}%`); where.push(`(x.oem_ref LIKE $1 OR x.iam_ref LIKE $1 OR x.iam_brand ILIKE $2 OR x.description ILIKE $2)`); }
  if (req.query.brand) { params.push(String(req.query.brand)); where.push(`upper(x.iam_brand)=upper($${params.length})`); }
  if (req.query.verified === "si") where.push("x.verified");
  if (req.query.verified === "no") where.push("NOT x.verified");
  const r = await query(
    `SELECT x.*, (SELECT min(o.price) FROM offers o WHERE o.ref=x.iam_ref AND o.condition='nuevo') AS best_price,
       (SELECT count(*) FROM offers o WHERE o.ref=x.iam_ref AND o.condition='nuevo')::int AS offers
     FROM cross_references x ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY x.updated_at DESC LIMIT 500`, params);
  res.json(r.rows);
});

router.get("/iam/brands", async (_req, res) => {
  const r = await query(`SELECT DISTINCT iam_brand FROM cross_references ORDER BY 1`);
  res.json(r.rows.map((x) => x.iam_brand));
});

router.post("/iam", async (req, res) => {
  const b = parse(z.object({
    oem_ref: z.string().trim().min(3).max(60), iam_brand: z.string().trim().min(1).max(80), iam_ref: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300).optional().nullable(), verified: z.boolean().default(false), notes: z.string().trim().max(1000).optional().nullable(),
    source_note: z.string().trim().max(200).optional().nullable(), specs: z.record(z.string(), z.string().max(120)).default({}),
  }), req.body);
  const sourceId = await manualSourceId("iam");
  const r = await one(
    `INSERT INTO cross_references (oem_ref, iam_brand, iam_ref, iam_ref_display, description, specs, source_id, source_label, verified, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [normRef(b.oem_ref), b.iam_brand, normRef(b.iam_ref), b.iam_ref.toUpperCase(), b.description ?? null, JSON.stringify(b.specs), sourceId,
      `Registro manual — ${req.user!.name}${b.source_note ? ` (${b.source_note})` : ""}`, b.verified, b.notes ?? null, req.user!.id],
  );
  await audit(req, "iam.alta", "cross_reference", r.id, { oem: b.oem_ref, iam: `${b.iam_brand} ${b.iam_ref}` });
  res.status(201).json(r);
});

router.patch("/iam/:id", async (req, res) => {
  const b = parse(z.object({ verified: z.boolean().optional(), notes: z.string().trim().max(1000).optional().nullable() }), req.body);
  const r = await one(`UPDATE cross_references SET verified=COALESCE($2,verified), notes=COALESCE($3,notes), updated_at=now() WHERE id=$1 RETURNING id`, [
    String(req.params.id), b.verified ?? null, b.notes ?? null,
  ]);
  if (!r) throw notFound("Equivalencia");
  await audit(req, "iam.modificacion", "cross_reference", r.id, b);
  res.json(r);
});

router.delete("/iam/:id", requireAdmin, async (req, res) => {
  const r = await query(`DELETE FROM cross_references WHERE id=$1`, [String(req.params.id)]);
  if (!r.rowCount) throw notFound("Equivalencia");
  await audit(req, "iam.baja", "cross_reference", String(req.params.id));
  res.json({ ok: true });
});

// ───────── Usados CAT ─────────
router.get("/cat", async (req, res) => {
  const params: unknown[] = [];
  const where: string[] = ["o.condition='usado'"];
  const q = String(req.query.q ?? "").trim();
  if (q) {
    params.push(`%${normRef(q)}%`, `%${q}%`);
    where.push(`(o.oem_ref LIKE $1 OR o.description ILIKE $2 OR o.vehicle_make ILIKE $2 OR o.vehicle_model ILIKE $2 OR o.vehicle_engine_code ILIKE $2 OR o.location ILIKE $2)`);
  }
  if (req.query.part_code) { params.push(String(req.query.part_code)); where.push(`o.part_code=$${params.length}`); }
  if (req.query.source_id) { params.push(String(req.query.source_id)); where.push(`o.source_id=$${params.length}`); }
  const r = await query(
    `SELECT o.*, s.name AS supplier_name, d.name AS source_name, s.phone AS supplier_phone, s.email AS supplier_email
     FROM offers o JOIN data_sources d ON d.id=o.source_id LEFT JOIN suppliers s ON s.id=o.supplier_id
     WHERE ${where.join(" AND ")} ORDER BY o.updated_at DESC LIMIT 500`, params);
  const inv = await query(
    `SELECT i.*, s.name AS supplier_name FROM inventory_items i LEFT JOIN suppliers s ON s.id=i.supplier_id
     WHERE i.condition='usado' ${q ? `AND (i.oem_ref LIKE $1 OR i.description ILIKE $2 OR i.vehicle_make ILIKE $2 OR i.vehicle_model ILIKE $2)` : ""}
     ORDER BY i.updated_at DESC LIMIT 200`, q ? params.slice(0, 2) : []);
  res.json({ offers: r.rows, inventory: inv.rows });
});

router.get("/cat/sources", async (_req, res) => {
  const r = await query(`SELECT d.id, d.name, (SELECT count(*) FROM offers o WHERE o.source_id=d.id)::int AS items FROM data_sources d WHERE d.data_kind='offers_used' ORDER BY d.name`);
  res.json(r.rows);
});
