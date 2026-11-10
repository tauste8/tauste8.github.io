/** Clientes y proveedores (CRM). */
import { Router } from "express";
import { z } from "zod";
import { one, query } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { notFound, parse } from "../lib/http.js";
import { requireAdmin } from "../middleware/auth.js";

const s = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const email = z.string().trim().max(200).optional().nullable().transform((v) => (v ? v : null)).refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Correo electrónico no válido");
const url = z.string().trim().max(300).optional().nullable().transform((v) => (v ? v : null)).refine((v) => !v || /^https?:\/\//.test(v), "La web debe empezar por http:// o https://");

// ───────── Clientes ─────────
export const customers = Router();
const customerSchema = z.object({
  name: z.string().trim().min(2).max(200), tax_id: s(30), phone: s(40), email, address: s(400), notes: s(4000),
});

customers.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const r = await query(
    `SELECT c.*, (SELECT count(*) FROM quotes q WHERE q.customer_id=c.id)::int AS quotes,
       (SELECT count(*) FROM orders o WHERE o.customer_id=c.id)::int AS orders,
       (SELECT count(*) FROM searches s WHERE s.customer_id=c.id)::int AS searches
     FROM customers c ${q ? "WHERE c.name ILIKE $1 OR c.phone ILIKE $1 OR c.email ILIKE $1 OR c.tax_id ILIKE $1" : ""} ORDER BY c.name LIMIT 500`,
    q ? [`%${q}%`] : [],
  );
  res.json(r.rows);
});

customers.get("/:id", async (req, res) => {
  const c = await one(`SELECT * FROM customers WHERE id=$1`, [String(req.params.id)]);
  if (!c) throw notFound("Cliente");
  const [searches, quotes, orders] = await Promise.all([
    query(`SELECT s.id, s.query_vehicle, s.query_part, s.query_ref, s.status, s.created_at FROM searches s WHERE s.customer_id=$1 ORDER BY s.created_at DESC LIMIT 100`, [c.id]),
    query(`SELECT id, number, status, created_at FROM quotes WHERE customer_id=$1 ORDER BY created_at DESC`, [c.id]),
    query(`SELECT id, number, status, created_at FROM orders WHERE customer_id=$1 ORDER BY created_at DESC`, [c.id]),
  ]);
  res.json({ ...c, searches: searches.rows, quotes: quotes.rows, orders: orders.rows });
});

customers.post("/", async (req, res) => {
  const b = parse(customerSchema, req.body);
  const r = await one(`INSERT INTO customers (name, tax_id, phone, email, address, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [b.name, b.tax_id, b.phone, b.email, b.address, b.notes]);
  await audit(req, "cliente.alta", "customer", r.id);
  res.status(201).json(r);
});

customers.put("/:id", async (req, res) => {
  const b = parse(customerSchema, req.body);
  const r = await one(`UPDATE customers SET name=$2, tax_id=$3, phone=$4, email=$5, address=$6, notes=$7, updated_at=now() WHERE id=$1 RETURNING *`, [
    String(req.params.id), b.name, b.tax_id, b.phone, b.email, b.address, b.notes,
  ]);
  if (!r) throw notFound("Cliente");
  await audit(req, "cliente.modificacion", "customer", r.id);
  res.json(r);
});

customers.delete("/:id", requireAdmin, async (req, res) => {
  const r = await query(`DELETE FROM customers WHERE id=$1`, [String(req.params.id)]);
  if (!r.rowCount) throw notFound("Cliente");
  await audit(req, "cliente.baja", "customer", String(req.params.id));
  res.json({ ok: true });
});

// ───────── Proveedores ─────────
export const suppliers = Router();
const supplierSchema = z.object({
  name: z.string().trim().min(2).max(200), contact_name: s(120), phone: s(40), email, website: url,
  type: z.enum(["distribuidor", "fabricante", "concesionario", "cat", "desguace", "otro"]),
  location: s(200), catalog_info: s(2000), commercial_terms: s(4000), notes: s(4000),
});

suppliers.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const params: unknown[] = [];
  const where: string[] = [];
  if (q) { params.push(`%${q}%`); where.push(`(s.name ILIKE $1 OR s.contact_name ILIKE $1 OR s.location ILIKE $1)`); }
  if (req.query.type) { params.push(String(req.query.type)); where.push(`s.type=$${params.length}`); }
  const r = await query(
    `SELECT s.*,
       (SELECT count(*) FROM data_sources d WHERE d.supplier_id=s.id)::int AS sources,
       (SELECT count(*) FROM offers o WHERE o.supplier_id=s.id)::int AS offers,
       (SELECT max(d.last_sync_at) FROM data_sources d WHERE d.supplier_id=s.id) AS last_sync_at
     FROM suppliers s ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.name LIMIT 500`, params);
  res.json(r.rows);
});

suppliers.get("/:id", async (req, res) => {
  const s = await one(`SELECT * FROM suppliers WHERE id=$1`, [String(req.params.id)]);
  if (!s) throw notFound("Proveedor");
  const [sources, purchases] = await Promise.all([
    query(`SELECT id, name, connector_key, data_kind, enabled, status, last_sync_at, (SELECT count(*) FROM offers o WHERE o.source_id=d.id)::int AS items FROM data_sources d WHERE supplier_id=$1`, [s.id]),
    query(
      `SELECT o.id AS order_id, o.number, o.status, o.created_at, l.description, l.ref, l.quantity, l.cost_price
       FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE l.supplier_id=$1 ORDER BY o.created_at DESC LIMIT 200`, [s.id]),
  ]);
  res.json({ ...s, dataSources: sources.rows, purchases: purchases.rows });
});

suppliers.post("/", async (req, res) => {
  const b = parse(supplierSchema, req.body);
  const r = await one(
    `INSERT INTO suppliers (name, contact_name, phone, email, website, type, location, catalog_info, commercial_terms, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.name, b.contact_name, b.phone, b.email, b.website, b.type, b.location, b.catalog_info, b.commercial_terms, b.notes]);
  await audit(req, "proveedor.alta", "supplier", r.id);
  res.status(201).json(r);
});

suppliers.put("/:id", async (req, res) => {
  const b = parse(supplierSchema, req.body);
  const r = await one(
    `UPDATE suppliers SET name=$2, contact_name=$3, phone=$4, email=$5, website=$6, type=$7, location=$8, catalog_info=$9, commercial_terms=$10, notes=$11, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [String(req.params.id), b.name, b.contact_name, b.phone, b.email, b.website, b.type, b.location, b.catalog_info, b.commercial_terms, b.notes]);
  if (!r) throw notFound("Proveedor");
  await audit(req, "proveedor.modificacion", "supplier", r.id);
  res.json(r);
});

suppliers.delete("/:id", requireAdmin, async (req, res) => {
  const r = await query(`DELETE FROM suppliers WHERE id=$1`, [String(req.params.id)]);
  if (!r.rowCount) throw notFound("Proveedor");
  await audit(req, "proveedor.baja", "supplier", String(req.params.id));
  res.json({ ok: true });
});
