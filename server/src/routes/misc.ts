/** Historial, estadísticas, configuración, archivos y copias de seguridad. */
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { one, pool, query } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound, parse } from "../lib/http.js";
import { mailConfigured } from "../lib/mailer.js";
import { PART_BY_CODE } from "../lib/parts-dictionary.js";
import { getCompany, setCompany } from "../lib/settings.js";
import { normText } from "../lib/text.js";
import { requireAdmin } from "../middleware/auth.js";
import { aiAvailable } from "../services/ai.js";

// ───────── Historial ─────────
export const history = Router();
history.get("/", async (req, res) => {
  const params: unknown[] = [];
  const where: string[] = [];
  const q = String(req.query.q ?? "").trim();
  if (q) { params.push(`%${q}%`); where.push(`(s.query_vehicle ILIKE $1 OR s.query_part ILIKE $1 OR s.query_ref ILIKE $1 OR v.make ILIKE $1 OR v.model ILIKE $1)`); }
  if (req.query.status) { params.push(String(req.query.status)); where.push(`s.status=$${params.length}`); }
  if (req.query.user === "me") { params.push(req.user!.id); where.push(`s.user_id=$${params.length}`); }
  if (req.query.from) { params.push(String(req.query.from)); where.push(`s.created_at >= $${params.length}::date`); }
  if (req.query.to) { params.push(String(req.query.to)); where.push(`s.created_at < $${params.length}::date + 1`); }
  const r = await query(
    `SELECT s.id, s.query_vehicle, s.query_part, s.query_ref, s.part_code, s.status, s.count_oem, s.count_iam, s.count_cat, s.duration_ms, s.created_at,
       u.name AS user_name, v.id AS vehicle_id, v.plate, v.vin, v.make, v.model, c.name AS customer_name
     FROM searches s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN customers c ON c.id=s.customer_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.created_at DESC LIMIT 500`, params);
  res.json(r.rows.map((x) => ({ ...x, part_name: x.part_code ? PART_BY_CODE.get(x.part_code)?.name ?? x.part_code : null })));
});

// ───────── Estadísticas ─────────
export const stats = Router();
stats.get("/", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 3650);
  const since = `now() - interval '${days} days'`;
  const [summary, parts, vehicles, refs, perDay, suppliersUsed, sales, users, catalog] = await Promise.all([
    one(`SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status='completado')::int AS with_results,
           count(*) FILTER (WHERE status='sin_resultados')::int AS without_results,
           count(*) FILTER (WHERE status IN ('requiere_vehiculo','requiere_pieza'))::int AS incomplete,
           coalesce(round(avg(duration_ms)),0)::int AS avg_ms,
           coalesce(round(avg(duration_ms) FILTER (WHERE status='completado')),0)::int AS avg_ms_ok
         FROM searches WHERE created_at > ${since}`),
    query(`SELECT part_code, count(*)::int AS n FROM searches WHERE created_at > ${since} AND part_code IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    query(`SELECT v.id, v.plate, v.make, v.model, v.engine_code, count(*)::int AS n FROM searches s JOIN vehicles v ON v.id=s.vehicle_id
           WHERE s.created_at > ${since} GROUP BY v.id ORDER BY n DESC LIMIT 10`),
    query(`SELECT ref, count(*)::int AS n FROM (SELECT jsonb_array_elements_text(result->'oemRefs') AS ref FROM searches WHERE created_at > ${since}) t GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n,
             count(*) FILTER (WHERE status='completado')::int AS ok FROM searches WHERE created_at > ${since} GROUP BY 1 ORDER BY 1`),
    query(`SELECT coalesce(s.name, 'Sin proveedor asignado') AS name, count(*)::int AS n, coalesce(sum(l.quantity*l.cost_price),0)::numeric(12,2) AS cost
           FROM order_lines l JOIN orders o ON o.id=l.order_id LEFT JOIN suppliers s ON s.id=l.supplier_id
           WHERE o.created_at > ${since} AND o.status <> 'cancelado' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    one(`SELECT
           (SELECT count(*) FROM quotes WHERE created_at > ${since})::int AS quotes,
           (SELECT count(*) FROM quotes WHERE created_at > ${since} AND status IN ('aceptado','convertido'))::int AS quotes_accepted,
           (SELECT count(*) FROM orders WHERE created_at > ${since} AND status<>'cancelado')::int AS orders,
           (SELECT coalesce(sum(round(l.unit_price*l.quantity*(1-l.discount_pct/100),2)*(1-o.global_discount_pct/100)),0)
              FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE o.created_at > ${since} AND o.status<>'cancelado')::numeric(12,2) AS revenue_base,
           (SELECT coalesce(sum(round(l.unit_price*l.quantity*(1-l.discount_pct/100),2)*(1-q.global_discount_pct/100)),0)
              FROM quote_lines l JOIN quotes q ON q.id=l.quote_id WHERE q.created_at > ${since})::numeric(12,2) AS quoted_base`),
    query(`SELECT coalesce(u.name,'—') AS name, count(*)::int AS n FROM searches s LEFT JOIN users u ON u.id=s.user_id WHERE s.created_at > ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    one(`SELECT (SELECT count(*) FROM oem_references)::int AS oem, (SELECT count(*) FROM cross_references)::int AS iam,
           (SELECT count(*) FROM offers WHERE condition='nuevo')::int AS offers_new, (SELECT count(*) FROM offers WHERE condition='usado')::int AS offers_used,
           (SELECT count(*) FROM inventory_items)::int AS inventory, (SELECT coalesce(sum(quantity),0) FROM inventory_items)::int AS inventory_units,
           (SELECT coalesce(sum(quantity*purchase_price),0) FROM inventory_items)::numeric(12,2) AS inventory_value,
           (SELECT count(*) FROM vehicles)::int AS vehicles, (SELECT count(*) FROM customers)::int AS customers`),
  ]);
  res.json({
    days,
    summary: { ...summary, success_rate: summary.total ? Math.round((summary.with_results / summary.total) * 1000) / 10 : null },
    topParts: parts.rows.map((p) => ({ ...p, name: PART_BY_CODE.get(p.part_code)?.name ?? p.part_code })),
    topVehicles: vehicles.rows,
    topRefs: refs.rows,
    perDay: perDay.rows,
    suppliersUsed: suppliersUsed.rows,
    sales,
    users: users.rows,
    catalog,
  });
});

stats.get("/dashboard", async (req, res) => {
  const [today, recent, pendingQuotes, openOrders, lowStock, sources, catalog] = await Promise.all([
    one(`SELECT count(*)::int AS searches, count(*) FILTER (WHERE status='completado')::int AS ok, coalesce(round(avg(duration_ms)),0)::int AS avg_ms
         FROM searches WHERE created_at >= date_trunc('day', now())`),
    query(`SELECT s.id, s.query_vehicle, s.query_part, s.query_ref, s.part_code, s.status, s.count_oem, s.count_iam, s.count_cat, s.created_at, u.name AS user_name,
             v.make, v.model, v.plate, v.vin FROM searches s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN vehicles v ON v.id=s.vehicle_id
           ORDER BY s.created_at DESC LIMIT 8`),
    query(`SELECT q.id, q.number, q.status, q.created_at, c.name AS customer_name FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id
           WHERE q.status IN ('borrador','enviado') ORDER BY q.updated_at DESC LIMIT 6`),
    query(`SELECT o.id, o.number, o.status, o.created_at, c.name AS customer_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
           WHERE o.status IN ('pendiente','solicitado_proveedor','recibido') ORDER BY o.created_at DESC LIMIT 6`),
    query(`SELECT id, description, quantity, location FROM inventory_items WHERE quantity <= 1 ORDER BY quantity, updated_at DESC LIMIT 6`),
    query(`SELECT name, connector_key, data_kind, enabled, status, last_sync_at FROM data_sources ORDER BY last_sync_at DESC NULLS LAST`),
    one(`SELECT (SELECT count(*) FROM oem_references)::int AS oem, (SELECT count(*) FROM cross_references)::int AS iam,
           (SELECT count(*) FROM offers WHERE condition='nuevo')::int AS offers_new, (SELECT count(*) FROM offers WHERE condition='usado')::int AS offers_used,
           (SELECT count(*) FROM inventory_items)::int AS inventory, (SELECT count(*) FROM vehicles)::int AS vehicles`),
  ]);
  res.json({
    user: req.user!.name,
    today,
    recent: recent.rows.map((r) => ({ ...r, part_name: r.part_code ? PART_BY_CODE.get(r.part_code)?.name : null })),
    pendingQuotes: pendingQuotes.rows,
    openOrders: openOrders.rows,
    lowStock: lowStock.rows,
    sources: sources.rows,
    catalog,
    ai: aiAvailable(),
  });
});

// ───────── Configuración ─────────
export const settings = Router();
const companySchema = z.object({
  name: z.string().trim().max(200), taxId: z.string().trim().max(30), address: z.string().trim().max(400), phone: z.string().trim().max(40),
  email: z.string().trim().max(200), defaultVat: z.coerce.number().min(0).max(100), defaultMargin: z.coerce.number().min(-100).max(1000),
  quoteValidityDays: z.coerce.number().int().min(1).max(365), quoteFooter: z.string().trim().max(1000),
});
settings.get("/company", async (_req, res) => res.json(await getCompany()));
settings.put("/company", requireAdmin, async (req, res) => {
  const b = parse(companySchema, req.body);
  await setCompany(b);
  await audit(req, "configuracion.empresa", "settings", "company");
  res.json(b);
});

settings.get("/system", async (_req, res) => {
  const db = await one(`SELECT version() AS v, pg_size_pretty(pg_database_size(current_database())) AS size`);
  res.json({
    ai: aiAvailable(), aiModel: aiAvailable() ? config.aiModel : null, mail: mailConfigured(), database: db.v.split(" ").slice(0, 2).join(" "), databaseSize: db.size,
    publicUrl: config.publicUrl, production: config.isProd, version: "1.0.0",
  });
});

settings.get("/synonyms", async (_req, res) => {
  const r = await query(`SELECT s.id, s.term, s.part_code, s.created_at, u.name AS user_name FROM part_synonyms s LEFT JOIN users u ON u.id=s.created_by ORDER BY s.term`);
  res.json(r.rows.map((x) => ({ ...x, part_name: PART_BY_CODE.get(x.part_code)?.name ?? x.part_code })));
});
settings.post("/synonyms", async (req, res) => {
  const b = parse(z.object({ term: z.string().trim().min(2).max(80), part_code: z.string().refine((v) => PART_BY_CODE.has(v), "Tipo de pieza no válido") }), req.body);
  const r = await one(`INSERT INTO part_synonyms (term, part_code, created_by) VALUES ($1,$2,$3) RETURNING id`, [normText(b.term), b.part_code, req.user!.id]);
  await audit(req, "configuracion.sinonimo", "synonym", r.id, b);
  res.status(201).json(r);
});
settings.delete("/synonyms/:id", requireAdmin, async (req, res) => {
  await query(`DELETE FROM part_synonyms WHERE id=$1`, [String(req.params.id)]);
  res.json({ ok: true });
});

/** Exportación completa de datos de negocio en JSON (copia lógica descargable). */
settings.get("/backup", requireAdmin, async (req, res) => {
  const tables = ["users", "settings", "part_synonyms", "suppliers", "customers", "vehicles", "data_sources", "oem_references", "oem_applications",
    "cross_references", "offers", "inventory_items", "inventory_photos", "files", "searches", "saved_results", "quotes", "quote_lines", "orders", "order_lines", "imports", "audit_log"];
  const out: Record<string, unknown[]> = {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for (const t of tables) {
      const cols = t === "users" ? "id, email, name, role, active, last_login_at, created_at, updated_at" : t === "data_sources" ? "id, connector_key, name, data_kind, supplier_id, enabled, verified_source, config, status, last_sync_at, created_at" : "*";
      out[t] = (await client.query(`SELECT ${cols} FROM ${t}`)).rows;
    }
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await audit(req, "copia.exportacion", "backup", null);
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="autoreca-copia-${stamp}.json"`);
  res.send(JSON.stringify({ app: "AUTORECA IA", version: 1, exportedAt: new Date().toISOString(), note: "Las contraseñas y credenciales de integraciones no se incluyen.", data: out }));
});

// ───────── Archivos ─────────
export const files = Router();
files.get("/:id", async (req, res) => {
  const f = await one(`SELECT * FROM files WHERE id=$1`, [String(req.params.id)]);
  if (!f) throw notFound("Archivo");
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(f.storage_name)) throw new HttpError(400, "Archivo no válido");
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(path.resolve(config.uploadsDir, f.storage_name));
});
