/** Presupuestos y pedidos. */
import { Router, type Response } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { one, query, tx } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound, parse } from "../lib/http.js";
import { getCompany } from "../lib/settings.js";
import { round2 } from "../lib/text.js";
import { requireAdmin } from "../middleware/auth.js";

export interface Line {
  description: string; brand: string | null; ref: string | null; oem_ref: string | null; condition: string | null; supplier_id: string | null;
  source_label: string | null; cost_price: number | null; margin_pct: number | null; unit_price: number; quantity: number; discount_pct: number;
}

export function totals(lines: Line[], vatRate: number, globalDiscountPct: number) {
  const rows = lines.map((l) => {
    const gross = l.unit_price * l.quantity;
    const net = round2(gross * (1 - l.discount_pct / 100));
    const cost = l.cost_price != null ? round2(l.cost_price * l.quantity) : null;
    return { net, cost };
  });
  const subtotal = round2(rows.reduce((s, r) => s + r.net, 0));
  const discount = round2(subtotal * (globalDiscountPct / 100));
  const base = round2(subtotal - discount);
  const vat = round2(base * (vatRate / 100));
  const total = round2(base + vat);
  const costKnown = rows.every((r) => r.cost != null);
  const cost = costKnown ? round2(rows.reduce((s, r) => s + (r.cost ?? 0), 0)) : null;
  return { lines: rows.map((r) => r.net), subtotal, discount, base, vat, total, cost, margin: cost != null ? round2(base - cost) : null };
}

const num = (min: number, max: number) => z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) { ctx.addIssue({ code: "custom", message: `Valor fuera de rango (${min}–${max})` }); return z.NEVER; }
  return round2(n);
});
const optNum = (min: number, max: number) => z.union([z.number(), z.string(), z.null()]).optional().transform((v, ctx) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) { ctx.addIssue({ code: "custom", message: `Valor fuera de rango (${min}–${max})` }); return z.NEVER; }
  return round2(n);
});
const s = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

const lineSchema = z.object({
  description: z.string().trim().min(1).max(300), brand: s(80), ref: s(60), oem_ref: s(60), condition: z.enum(["nuevo", "usado"]).optional().nullable().transform((v) => v ?? null),
  supplier_id: z.uuid().optional().nullable().or(z.literal("")).transform((v) => v || null), source_label: s(200),
  cost_price: optNum(0, 1e7), margin_pct: optNum(-100, 1000), unit_price: optNum(0, 1e7), quantity: num(0.01, 100000), discount_pct: optNum(0, 100),
}).transform((l) => ({
  ...l,
  unit_price: l.unit_price ?? (l.cost_price != null && l.margin_pct != null ? round2(l.cost_price * (1 + l.margin_pct / 100)) : 0),
  discount_pct: l.discount_pct ?? 0,
}));

const docSchema = z.object({
  customer_id: z.uuid().optional().nullable().or(z.literal("")).transform((v) => v || null),
  vehicle_id: z.uuid().optional().nullable().or(z.literal("")).transform((v) => v || null),
  vat_rate: num(0, 100),
  global_discount_pct: optNum(0, 100).transform((v) => v ?? 0),
  valid_until: z.string().optional().nullable().transform((v) => v || null).refine((v) => !v || !Number.isNaN(Date.parse(v)), "Fecha no válida"),
  notes: s(4000),
  lines: z.array(lineSchema).max(200),
});

async function loadDoc(kind: "quote" | "order", id: string) {
  const t = kind === "quote" ? "quotes" : "orders";
  const lt = kind === "quote" ? "quote_lines" : "order_lines";
  const fk = kind === "quote" ? "quote_id" : "order_id";
  const d = await one(
    `SELECT d.*, c.name AS customer_name, c.tax_id AS customer_tax_id, c.phone AS customer_phone, c.email AS customer_email, c.address AS customer_address,
       v.plate AS vehicle_plate, v.vin AS vehicle_vin, v.make AS vehicle_make, v.model AS vehicle_model, v.year AS vehicle_year, v.engine_code AS vehicle_engine_code,
       u.name AS created_by_name
     FROM ${t} d LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN vehicles v ON v.id=d.vehicle_id LEFT JOIN users u ON u.id=d.created_by WHERE d.id=$1`, [id]);
  if (!d) return null;
  const lines = (await query(`SELECT l.*, s.name AS supplier_name FROM ${lt} l LEFT JOIN suppliers s ON s.id=l.supplier_id WHERE l.${fk}=$1 ORDER BY l.position`, [id])).rows as (Line & { id: string })[];
  return { ...d, lines, totals: totals(lines, Number(d.vat_rate), Number(d.global_discount_pct)) };
}

async function insertLines(c: { query: (q: string, p: unknown[]) => Promise<unknown> }, table: string, fk: string, id: string, lines: Line[]) {
  await c.query(`DELETE FROM ${table} WHERE ${fk}=$1`, [id]);
  let pos = 0;
  for (const l of lines) {
    await c.query(
      `INSERT INTO ${table} (${fk}, position, description, brand, ref, oem_ref, condition, supplier_id, source_label, cost_price, margin_pct, unit_price, quantity, discount_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, pos++, l.description, l.brand, l.ref, l.oem_ref, l.condition, l.supplier_id, l.source_label, l.cost_price, l.margin_pct, l.unit_price, l.quantity, l.discount_pct],
    );
  }
}

function listRoute(kind: "quote" | "order") {
  const t = kind === "quote" ? "quotes" : "orders";
  const lt = kind === "quote" ? "quote_lines" : "order_lines";
  const fk = kind === "quote" ? "quote_id" : "order_id";
  return async (req: any, res: Response) => {
    const params: unknown[] = [];
    const where: string[] = [];
    const q = String(req.query.q ?? "").trim();
    if (q) { params.push(`%${q}%`); where.push(`(d.number ILIKE $1 OR c.name ILIKE $1 OR v.plate ILIKE $1)`); }
    if (req.query.status) { params.push(String(req.query.status)); where.push(`d.status=$${params.length}`); }
    const r = await query(
      `SELECT d.id, d.number, d.status, d.created_at, d.updated_at, d.vat_rate, d.global_discount_pct, c.name AS customer_name, v.plate AS vehicle_plate,
         ${kind === "order" ? "d.quote_id, (SELECT number FROM quotes WHERE id=d.quote_id) AS quote_number," : "d.valid_until,"}
         (SELECT coalesce(sum(round(l.unit_price*l.quantity*(1-l.discount_pct/100),2)),0) FROM ${lt} l WHERE l.${fk}=d.id) AS subtotal,
         (SELECT count(*) FROM ${lt} l WHERE l.${fk}=d.id)::int AS line_count
       FROM ${t} d LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN vehicles v ON v.id=d.vehicle_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY d.created_at DESC LIMIT 500`, params);
    res.json(r.rows.map((d) => {
      const base = round2(Number(d.subtotal) * (1 - Number(d.global_discount_pct) / 100));
      return { ...d, base, total: round2(base * (1 + Number(d.vat_rate) / 100)) };
    }));
  };
}

// ───────── Presupuestos ─────────
export const quotes = Router();

quotes.get("/", listRoute("quote"));
quotes.get("/:id", async (req, res) => {
  const d = await loadDoc("quote", String(req.params.id));
  if (!d) throw notFound("Presupuesto");
  const order = await one(`SELECT id, number FROM orders WHERE quote_id=$1`, [d.id]);
  res.json({ ...d, order });
});

quotes.post("/", async (req, res) => {
  const b = parse(docSchema, req.body);
  const id = await tx(async (c) => {
    const n = (await c.query(`SELECT nextval('quote_number_seq') AS n`)).rows[0].n;
    const number = `P-${new Date().getFullYear()}-${String(n).padStart(5, "0")}`;
    const r = await c.query(
      `INSERT INTO quotes (number, customer_id, vehicle_id, vat_rate, global_discount_pct, valid_until, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [number, b.customer_id, b.vehicle_id, b.vat_rate, b.global_discount_pct, b.valid_until, b.notes, req.user!.id]);
    await insertLines(c, "quote_lines", "quote_id", r.rows[0].id, b.lines);
    return r.rows[0].id;
  });
  await audit(req, "presupuesto.alta", "quote", id);
  res.status(201).json(await loadDoc("quote", id));
});

quotes.put("/:id", async (req, res) => {
  const b = parse(docSchema, req.body);
  const id = String(req.params.id);
  const cur = await one(`SELECT status FROM quotes WHERE id=$1`, [id]);
  if (!cur) throw notFound("Presupuesto");
  if (cur.status === "convertido") throw new HttpError(409, "El presupuesto ya se convirtió en pedido y no se puede modificar");
  await tx(async (c) => {
    await c.query(`UPDATE quotes SET customer_id=$2, vehicle_id=$3, vat_rate=$4, global_discount_pct=$5, valid_until=$6, notes=$7, updated_at=now() WHERE id=$1`,
      [id, b.customer_id, b.vehicle_id, b.vat_rate, b.global_discount_pct, b.valid_until, b.notes]);
    await insertLines(c, "quote_lines", "quote_id", id, b.lines);
  });
  await audit(req, "presupuesto.modificacion", "quote", id);
  res.json(await loadDoc("quote", id));
});

/** Añadir una línea desde los resultados del buscador (crea un borrador si no se indica presupuesto). */
quotes.post("/add-line", async (req, res) => {
  const b = parse(z.object({ quote_id: z.uuid().optional(), vehicle_id: z.uuid().optional().nullable(), customer_id: z.uuid().optional().nullable(), line: lineSchema }), req.body);
  const company = await getCompany();
  const id = await tx(async (c) => {
    let qid = b.quote_id;
    if (qid) {
      const q = (await c.query(`SELECT status FROM quotes WHERE id=$1 FOR UPDATE`, [qid])).rows[0];
      if (!q) throw notFound("Presupuesto");
      if (q.status !== "borrador") throw new HttpError(409, "Solo se pueden añadir líneas a presupuestos en borrador");
    } else {
      const n = (await c.query(`SELECT nextval('quote_number_seq') AS n`)).rows[0].n;
      const valid = new Date(Date.now() + company.quoteValidityDays * 86400_000).toISOString().slice(0, 10);
      qid = (await c.query(
        `INSERT INTO quotes (number, customer_id, vehicle_id, vat_rate, valid_until, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [`P-${new Date().getFullYear()}-${String(n).padStart(5, "0")}`, b.customer_id ?? null, b.vehicle_id ?? null, company.defaultVat, valid, req.user!.id])).rows[0].id;
    }
    const l = b.line;
    await c.query(
      `INSERT INTO quote_lines (quote_id, position, description, brand, ref, oem_ref, condition, supplier_id, source_label, cost_price, margin_pct, unit_price, quantity, discount_pct)
       VALUES ($1,(SELECT coalesce(max(position)+1,0) FROM quote_lines WHERE quote_id=$1),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [qid, l.description, l.brand, l.ref, l.oem_ref, l.condition, l.supplier_id, l.source_label, l.cost_price, l.margin_pct, l.unit_price, l.quantity, l.discount_pct]);
    await c.query(`UPDATE quotes SET updated_at=now(), vehicle_id=COALESCE(vehicle_id,$2) WHERE id=$1`, [qid, b.vehicle_id ?? null]);
    return qid!;
  });
  await audit(req, "presupuesto.linea_desde_buscador", "quote", id);
  res.status(201).json(await loadDoc("quote", id));
});

quotes.patch("/:id/status", async (req, res) => {
  const b = parse(z.object({ status: z.enum(["borrador", "enviado", "aceptado", "rechazado"]) }), req.body);
  const r = await one(`UPDATE quotes SET status=$2, updated_at=now() WHERE id=$1 AND status<>'convertido' RETURNING id`, [String(req.params.id), b.status]);
  if (!r) throw new HttpError(409, "No se puede cambiar el estado (no existe o ya es un pedido)");
  await audit(req, "presupuesto.estado", "quote", r.id, b);
  res.json(await loadDoc("quote", r.id));
});

quotes.post("/:id/convert", async (req, res) => {
  const id = String(req.params.id);
  const orderId = await tx(async (c) => {
    const q = (await c.query(`SELECT * FROM quotes WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!q) throw notFound("Presupuesto");
    if (q.status === "convertido") throw new HttpError(409, "El presupuesto ya se convirtió en pedido");
    if (q.status !== "aceptado") throw new HttpError(409, "Solo se pueden convertir presupuestos aceptados");
    const lines = (await c.query(`SELECT * FROM quote_lines WHERE quote_id=$1 ORDER BY position`, [id])).rows;
    if (!lines.length) throw new HttpError(409, "El presupuesto no tiene líneas");
    const n = (await c.query(`SELECT nextval('order_number_seq') AS n`)).rows[0].n;
    const o = (await c.query(
      `INSERT INTO orders (number, quote_id, customer_id, vehicle_id, vat_rate, global_discount_pct, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [`PED-${new Date().getFullYear()}-${String(n).padStart(5, "0")}`, id, q.customer_id, q.vehicle_id, q.vat_rate, q.global_discount_pct, q.notes, req.user!.id])).rows[0];
    await insertLines(c, "order_lines", "order_id", o.id, lines);
    await c.query(`UPDATE quotes SET status='convertido', updated_at=now() WHERE id=$1`, [id]);
    return o.id;
  });
  await audit(req, "presupuesto.convertido", "quote", id, { order: orderId });
  res.status(201).json(await loadDoc("order", orderId));
});

quotes.post("/:id/duplicate", async (req, res) => {
  const src = await loadDoc("quote", String(req.params.id));
  if (!src) throw notFound("Presupuesto");
  const id = await tx(async (c) => {
    const n = (await c.query(`SELECT nextval('quote_number_seq') AS n`)).rows[0].n;
    const r = await c.query(
      `INSERT INTO quotes (number, customer_id, vehicle_id, vat_rate, global_discount_pct, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [`P-${new Date().getFullYear()}-${String(n).padStart(5, "0")}`, src.customer_id, src.vehicle_id, src.vat_rate, src.global_discount_pct, src.notes, req.user!.id]);
    await insertLines(c, "quote_lines", "quote_id", r.rows[0].id, src.lines);
    return r.rows[0].id;
  });
  await audit(req, "presupuesto.duplicado", "quote", id, { from: src.id });
  res.status(201).json(await loadDoc("quote", id));
});

quotes.delete("/:id", requireAdmin, async (req, res) => {
  const r = await query(`DELETE FROM quotes WHERE id=$1 AND status<>'convertido'`, [String(req.params.id)]);
  if (!r.rowCount) throw new HttpError(409, "No se puede eliminar (no existe o ya es un pedido)");
  await audit(req, "presupuesto.baja", "quote", String(req.params.id));
  res.json({ ok: true });
});

quotes.get("/:id/pdf", async (req, res) => {
  const d = await loadDoc("quote", String(req.params.id));
  if (!d) throw notFound("Presupuesto");
  await renderPdf(res, "PRESUPUESTO", d);
});

// ───────── Pedidos ─────────
export const orders = Router();
orders.get("/", listRoute("order"));
orders.get("/:id", async (req, res) => {
  const d = await loadDoc("order", String(req.params.id));
  if (!d) throw notFound("Pedido");
  res.json(d);
});
orders.patch("/:id", async (req, res) => {
  const b = parse(z.object({ status: z.enum(["pendiente", "solicitado_proveedor", "recibido", "entregado", "cancelado"]).optional(), notes: s(4000) }), req.body);
  const r = await one(`UPDATE orders SET status=COALESCE($2,status), notes=COALESCE($3,notes), updated_at=now() WHERE id=$1 RETURNING id`, [String(req.params.id), b.status ?? null, b.notes]);
  if (!r) throw notFound("Pedido");
  await audit(req, "pedido.modificacion", "order", r.id, b);
  res.json(await loadDoc("order", r.id));
});
orders.get("/:id/pdf", async (req, res) => {
  const d = await loadDoc("order", String(req.params.id));
  if (!d) throw notFound("Pedido");
  await renderPdf(res, "PEDIDO", d);
});

// ───────── PDF ─────────
const eur = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n));

async function renderPdf(res: Response, title: string, d: any) {
  const company = await getCompany();
  const doc = new PDFDocument({ size: "A4", margin: 42, info: { Title: `${title} ${d.number}`, Producer: "AUTORECA IA" } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${d.number}.pdf"`);
  doc.pipe(res);
  const W = doc.page.width - 84;
  const lime = "#5BAA1F";
  const dark = "#111614";

  // Cabecera
  doc.rect(0, 0, doc.page.width, 8).fill("#A5FF5F");
  doc.fillColor(dark).font("Helvetica-Bold").fontSize(18).text(company.name || "Nombre de la empresa (Configuración)", 42, 30, { width: W * 0.6 });
  doc.font("Helvetica").fontSize(9).fillColor("#444")
    .text([company.taxId && `CIF/NIF: ${company.taxId}`, company.address, [company.phone, company.email].filter(Boolean).join(" · ")].filter(Boolean).join("\n"), { width: W * 0.6 });
  doc.font("Helvetica-Bold").fontSize(16).fillColor(lime).text(title, 42 + W * 0.6, 30, { width: W * 0.4, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor(dark).text(`Nº ${d.number}`, { width: W * 0.4, align: "right" })
    .text(`Fecha: ${new Date(d.created_at).toLocaleDateString("es-ES")}`, { width: W * 0.4, align: "right" });
  if (d.valid_until) doc.text(`Válido hasta: ${new Date(d.valid_until).toLocaleDateString("es-ES")}`, { width: W * 0.4, align: "right" });

  // Cliente / vehículo
  let y = Math.max(doc.y, 110) + 14;
  doc.roundedRect(42, y, W / 2 - 6, 70, 4).strokeColor("#DDD").stroke();
  doc.roundedRect(42 + W / 2 + 6, y, W / 2 - 6, 70, 4).stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#777").text("CLIENTE", 52, y + 8).text("VEHÍCULO", 52 + W / 2 + 6, y + 8);
  doc.font("Helvetica").fontSize(9.5).fillColor(dark)
    .text([d.customer_name ?? "Sin cliente asignado", d.customer_tax_id, d.customer_phone, d.customer_email].filter(Boolean).join("\n"), 52, y + 20, { width: W / 2 - 26 })
    .text([d.vehicle_plate && `Matrícula: ${d.vehicle_plate}`, d.vehicle_vin && `VIN: ${d.vehicle_vin}`,
      [d.vehicle_make, d.vehicle_model, d.vehicle_year].filter(Boolean).join(" "), d.vehicle_engine_code && `Motor: ${d.vehicle_engine_code}`].filter(Boolean).join("\n") || "—",
      52 + W / 2 + 6, y + 20, { width: W / 2 - 26 });
  y += 86;

  // Tabla
  const cols = [
    { k: "desc", t: "Descripción", w: 0.42 }, { k: "ref", t: "Referencia", w: 0.17 }, { k: "qty", t: "Cant.", w: 0.07, a: "right" },
    { k: "price", t: "Precio", w: 0.12, a: "right" }, { k: "dto", t: "Dto.", w: 0.07, a: "right" }, { k: "total", t: "Importe", w: 0.15, a: "right" },
  ] as const;
  const header = () => {
    doc.rect(42, y, W, 20).fill(dark);
    let x = 42;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#A5FF5F");
    for (const c of cols) { doc.text(c.t, x + 5, y + 6, { width: c.w * W - 10, align: (c as any).a ?? "left" }); x += c.w * W; }
    y += 24;
  };
  header();
  d.lines.forEach((l: any, i: number) => {
    const desc = [l.description, [l.brand, l.condition === "usado" ? "USADO" : null].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
    const h = Math.max(doc.font("Helvetica").fontSize(9).heightOfString(desc, { width: cols[0].w * W - 10 }), 12) + 8;
    if (y + h > doc.page.height - 160) { doc.addPage(); y = 42; header(); }
    if (i % 2) doc.rect(42, y - 3, W, h).fill("#F4F6F4");
    let x = 42;
    const vals = [desc, [l.ref, l.oem_ref && l.oem_ref !== l.ref ? `OEM ${l.oem_ref}` : null].filter(Boolean).join("\n"), String(Number(l.quantity)), eur(Number(l.unit_price)),
      Number(l.discount_pct) ? `${Number(l.discount_pct)} %` : "", eur(d.totals.lines[i])];
    doc.fillColor(dark).font("Helvetica").fontSize(9);
    cols.forEach((c, ci) => { doc.text(vals[ci], x + 5, y, { width: c.w * W - 10, align: (c as any).a ?? "left" }); x += c.w * W; });
    y += h;
  });

  // Totales
  if (y > doc.page.height - 170) { doc.addPage(); y = 42; }
  y += 10;
  const tx0 = 42 + W * 0.55;
  const row = (label: string, value: string, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5).fillColor(dark)
      .text(label, tx0, y, { width: W * 0.25 }).text(value, tx0 + W * 0.25, y, { width: W * 0.2, align: "right" });
    y += bold ? 18 : 15;
  };
  row("Subtotal", eur(d.totals.subtotal));
  if (Number(d.global_discount_pct)) row(`Descuento ${Number(d.global_discount_pct)} %`, `-${eur(d.totals.discount)}`);
  row("Base imponible", eur(d.totals.base));
  row(`IVA ${Number(d.vat_rate)} %`, eur(d.totals.vat));
  doc.moveTo(tx0, y).lineTo(42 + W, y).strokeColor(lime).lineWidth(1.5).stroke();
  y += 6;
  row("TOTAL", eur(d.totals.total), true);

  if (d.notes) {
    y += 10;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#777").text("OBSERVACIONES", 42, y);
    doc.font("Helvetica").fontSize(9).fillColor(dark).text(d.notes, 42, y + 12, { width: W });
  }
  if (company.quoteFooter) doc.font("Helvetica").fontSize(7.5).fillColor("#777").text(company.quoteFooter, 42, doc.page.height - 70, { width: W, align: "center" });
  doc.end();
}
