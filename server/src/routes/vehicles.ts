import { Router } from "express";
import { z } from "zod";
import { one, query } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound, parse } from "../lib/http.js";
import { classifyVehicleQuery, normalizeVehicleQuery } from "../lib/vin.js";
import { requireAdmin } from "../middleware/auth.js";
import { vehicleDataSchema } from "./search.js";

export const router = Router();

router.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const params: unknown[] = [];
  let where = "";
  if (q) {
    params.push(`%${q.replace(/[\s-]/g, "")}%`, `%${q}%`);
    where = `WHERE v.plate ILIKE $1 OR v.vin ILIKE $1 OR (coalesce(v.make,'') || ' ' || coalesce(v.model,'') || ' ' || coalesce(v.engine_code,'')) ILIKE $2`;
  }
  const r = await query(
    `SELECT v.*, (SELECT count(*) FROM searches s WHERE s.vehicle_id=v.id)::int AS searches,
            (SELECT max(created_at) FROM searches s WHERE s.vehicle_id=v.id) AS last_search_at
     FROM vehicles v ${where} ORDER BY coalesce((SELECT max(created_at) FROM searches s WHERE s.vehicle_id=v.id), v.created_at) DESC LIMIT 300`,
    params,
  );
  res.json(r.rows);
});

router.get("/:id", async (req, res) => {
  const v = await one(`SELECT * FROM vehicles WHERE id=$1`, [String(req.params.id)]);
  if (!v) throw notFound("Vehículo");
  const searches = await query(
    `SELECT s.id, s.query_part, s.query_ref, s.part_code, s.status, s.count_oem, s.count_iam, s.count_cat, s.created_at, u.name AS user_name
     FROM searches s LEFT JOIN users u ON u.id=s.user_id WHERE s.vehicle_id=$1 ORDER BY s.created_at DESC LIMIT 200`, [v.id]);
  const quotes = await query(`SELECT id, number, status, created_at FROM quotes WHERE vehicle_id=$1 ORDER BY created_at DESC`, [v.id]);
  res.json({ ...v, searches: searches.rows, quotes: quotes.rows });
});

const vehicleBody = vehicleDataSchema.extend({
  plate: z.string().trim().max(15).optional().transform((v) => (v ? normalizeVehicleQuery(v) : undefined)),
  engine: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
});

router.post("/", async (req, res) => {
  const b = parse(vehicleBody, req.body);
  if (!b.plate && !b.vin) throw new HttpError(400, "Indique la matrícula o el bastidor");
  if (b.plate && classifyVehicleQuery(b.plate) !== "matricula") throw new HttpError(400, "La matrícula no tiene un formato español válido");
  const vin = b.vin ? normalizeVehicleQuery(b.vin) : null;
  if (vin && classifyVehicleQuery(vin) !== "vin") throw new HttpError(400, "El bastidor debe tener 17 caracteres (sin I, O ni Q)");
  const v = await one(
    `INSERT INTO vehicles (plate, vin, make, model, generation, year, version, engine, engine_code, displacement_cc, power_kw, fuel, transmission, notes,
       identification_source, identification_level, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Datos introducidos por el trabajador','parcial',$15) RETURNING *`,
    [b.plate ?? null, vin, b.make ?? null, b.model ?? null, b.generation ?? null, b.year ?? null, b.version ?? null, b.engine ?? null,
      b.engine_code?.toUpperCase() ?? null, b.displacement_cc ?? null, b.power_kw ?? null, b.fuel ?? null, b.transmission ?? null, b.notes ?? null, req.user!.id],
  );
  await audit(req, "vehiculo.alta", "vehicle", v.id, { plate: v.plate, vin: v.vin });
  res.status(201).json(v);
});

router.put("/:id", async (req, res) => {
  const b = parse(vehicleBody.extend({ confirm: z.boolean().optional() }), req.body);
  const vin = b.vin ? normalizeVehicleQuery(b.vin) : null;
  if (vin && classifyVehicleQuery(vin) !== "vin") throw new HttpError(400, "El bastidor debe tener 17 caracteres (sin I, O ni Q)");
  if (b.plate && classifyVehicleQuery(b.plate) !== "matricula") throw new HttpError(400, "La matrícula no tiene un formato español válido");
  const v = await one(
    `UPDATE vehicles SET plate=$2, vin=$3, make=$4, model=$5, generation=$6, year=$7, version=$8, engine=$9, engine_code=$10, displacement_cc=$11,
       power_kw=$12, fuel=$13, transmission=$14, notes=$15,
       identification_level = CASE WHEN $16::boolean IS TRUE THEN 'confirmada' WHEN $16::boolean IS FALSE THEN 'parcial' ELSE identification_level END,
       identification_source = CASE WHEN $16::boolean IS TRUE THEN coalesce(identification_source,'') || ' · confirmada por ' || $17 ELSE identification_source END,
       updated_at=now()
     WHERE id=$1 RETURNING *`,
    [String(req.params.id), b.plate ?? null, vin, b.make ?? null, b.model ?? null, b.generation ?? null, b.year ?? null, b.version ?? null, b.engine ?? null,
      b.engine_code?.toUpperCase() ?? null, b.displacement_cc ?? null, b.power_kw ?? null, b.fuel ?? null, b.transmission ?? null, b.notes ?? null,
      b.confirm ?? null, req.user!.name],
  );
  if (!v) throw notFound("Vehículo");
  await audit(req, b.confirm ? "vehiculo.confirmacion" : "vehiculo.modificacion", "vehicle", v.id);
  res.json(v);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const r = await query(`DELETE FROM vehicles WHERE id=$1`, [String(req.params.id)]);
  if (!r.rowCount) throw notFound("Vehículo");
  await audit(req, "vehiculo.baja", "vehicle", String(req.params.id));
  res.json({ ok: true });
});
