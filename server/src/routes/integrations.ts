import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { CONNECTOR_BY_KEY, CONNECTORS, logConnector, readCreds } from "../connectors/registry.js";
import { one, query } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { encrypt } from "../lib/crypto.js";
import { HttpError, notFound, parse } from "../lib/http.js";
import { requireAdmin } from "../middleware/auth.js";
import { aiAvailable } from "../services/ai.js";
import { importRows, readRows, TEMPLATES, templateCsv } from "../services/importer.js";

export const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

const KIND_LABEL: Record<string, string> = {
  vehicle: "Identificación de vehículos", oem: "Catálogo OEM", iam: "Equivalencias IAM", offers_new: "Recambio nuevo (tarifa / stock)", offers_used: "Recambio usado (CAT / desguace)",
};

router.get("/", async (_req, res) => {
  const rows = (await query(
    `SELECT d.id, d.connector_key, d.name, d.data_kind, d.supplier_id, d.enabled, d.verified_source, d.config, d.status, d.last_sync_at, d.last_error, d.created_at,
       (d.credentials_enc IS NOT NULL) AS has_credentials, s.name AS supplier_name,
       CASE d.data_kind WHEN 'oem' THEN (SELECT count(*) FROM oem_references r WHERE r.source_id=d.id)
                        WHEN 'iam' THEN (SELECT count(*) FROM cross_references x WHERE x.source_id=d.id)
                        WHEN 'vehicle' THEN 0
                        ELSE (SELECT count(*) FROM offers o WHERE o.source_id=d.id) END::int AS records,
       (SELECT count(*) FROM connector_logs l WHERE l.source_id=d.id AND l.level='error' AND l.created_at > now() - interval '7 days')::int AS recent_errors
     FROM data_sources d LEFT JOIN suppliers s ON s.id=d.supplier_id ORDER BY d.created_at`)).rows;
  const inventory = await one(`SELECT count(*)::int AS n, max(updated_at) AS last FROM inventory_items`);
  res.json({
    connectors: CONNECTORS.map((c) => ({
      key: c.key, name: c.name, vendor: c.vendor, website: c.website ?? null, kinds: c.kinds, kindLabels: c.kinds.map((k) => KIND_LABEL[k]), mode: c.mode,
      implemented: c.implemented, multiInstance: c.multiInstance, description: c.description, requirements: c.requirements,
      credentialFields: c.credentialFields, testable: !!c.test, allowsManualUrl: !!c.allowsManualUrl,
    })),
    sources: rows.map((r) => ({ ...r, kindLabel: KIND_LABEL[r.data_kind] })),
    inventory,
    ai: { configured: aiAvailable() },
    templates: Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, v])),
  });
});

router.get("/templates/:kind", (req, res) => {
  const kind = String(req.params.kind) as keyof typeof TEMPLATES;
  if (!TEMPLATES[kind]) throw notFound("Plantilla");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="plantilla_${kind}.csv"`);
  res.send(templateCsv(kind));
});

router.post("/sources", requireAdmin, async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(2).max(120),
    data_kind: z.enum(["oem", "iam", "offers_new", "offers_used"]),
    supplier_id: z.uuid().optional().nullable().or(z.literal("")).transform((v) => v || null),
    verified_source: z.boolean().default(false),
  }), req.body);
  const r = await one(`INSERT INTO data_sources (connector_key, name, data_kind, supplier_id, verified_source, status) VALUES ('archivo',$1,$2,$3,$4,'sin_datos') RETURNING *`,
    [b.name, b.data_kind, b.supplier_id, b.verified_source]);
  await audit(req, "integracion.fuente_alta", "data_source", r.id, b);
  res.status(201).json(r);
});

router.put("/sources/:id", requireAdmin, async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(2).max(120).optional(),
    enabled: z.boolean().optional(),
    verified_source: z.boolean().optional(),
    supplier_id: z.uuid().optional().nullable().or(z.literal("")).transform((v) => (v === "" ? null : v)),
    manual_url: z.string().trim().max(400).optional().nullable().refine((v) => !v || /^https:\/\//.test(v), "La URL debe empezar por https://"),
    credentials: z.record(z.string(), z.string().max(500)).optional(),
  }), req.body);
  const id = String(req.params.id);
  const src = await one(`SELECT * FROM data_sources WHERE id=$1`, [id]);
  if (!src) throw notFound("Fuente");
  const def = CONNECTOR_BY_KEY.get(src.connector_key);
  let credsEnc: string | null | undefined;
  if (b.credentials) {
    const allowed = new Set(def?.credentialFields.map((f) => f.key) ?? []);
    const current = readCreds(src.credentials_enc);
    for (const [k, v] of Object.entries(b.credentials)) {
      if (!allowed.has(k)) continue;
      if (v === "") delete current[k];
      else current[k] = v;
    }
    credsEnc = Object.keys(current).length ? encrypt(JSON.stringify(current)) : null;
  }
  if (b.enabled && def && def.mode === "licencia" && !def.implemented) {
    throw new HttpError(409, `${def.name} no se puede activar: la integración por API aún no está implementada (requiere licencia y documentación del proveedor). Use la importación de archivos.`);
  }
  const config = { ...(src.config ?? {}) };
  if (b.manual_url !== undefined) config.manual_url = b.manual_url || null;
  const r = await one(
    `UPDATE data_sources SET name=COALESCE($2,name), enabled=COALESCE($3,enabled), verified_source=COALESCE($4,verified_source),
       supplier_id=CASE WHEN $5::boolean THEN $6::uuid ELSE supplier_id END, credentials_enc=CASE WHEN $7::boolean THEN $8 ELSE credentials_enc END,
       config=$9, status = CASE WHEN connector_key='nhtsa-vpic' AND $3 IS TRUE THEN 'activo' WHEN connector_key='nhtsa-vpic' AND $3 IS FALSE THEN 'desactivado' ELSE status END,
       updated_at=now()
     WHERE id=$1 RETURNING id`,
    [id, b.name ?? null, b.enabled ?? null, b.verified_source ?? null, b.supplier_id !== undefined, b.supplier_id ?? null, credsEnc !== undefined, credsEnc ?? null, JSON.stringify(config)],
  );
  // Las ofertas heredan el proveedor de la fuente
  if (b.supplier_id !== undefined) await query(`UPDATE offers SET supplier_id=$2 WHERE source_id=$1`, [id, b.supplier_id]);
  await audit(req, "integracion.configuracion", "data_source", id, { ...b, credentials: b.credentials ? Object.keys(b.credentials) : undefined });
  res.json(r);
});

router.delete("/sources/:id", requireAdmin, async (req, res) => {
  const r = await query(`DELETE FROM data_sources WHERE id=$1 AND connector_key='archivo'`, [String(req.params.id)]);
  if (!r.rowCount) throw new HttpError(409, "Solo se pueden eliminar fuentes de archivo");
  await audit(req, "integracion.fuente_baja", "data_source", String(req.params.id));
  res.json({ ok: true });
});

router.post("/sources/:id/test", requireAdmin, async (req, res) => {
  const src = await one(`SELECT * FROM data_sources WHERE id=$1`, [String(req.params.id)]);
  if (!src) throw notFound("Fuente");
  const def = CONNECTOR_BY_KEY.get(src.connector_key);
  let result: { ok: boolean; message: string };
  if (!def) result = { ok: false, message: "Conector desconocido" };
  else if (def.test) result = await def.test(readCreds(src.credentials_enc), src.config ?? {});
  else if (src.connector_key === "archivo" || src.connector_key === "manual") {
    const n = (await one(
      src.data_kind === "oem" ? `SELECT count(*)::int AS n FROM oem_references WHERE source_id=$1`
        : src.data_kind === "iam" ? `SELECT count(*)::int AS n FROM cross_references WHERE source_id=$1`
          : `SELECT count(*)::int AS n FROM offers WHERE source_id=$1`, [src.id]))!.n;
    result = { ok: n > 0, message: n > 0 ? `${n} registros disponibles para el buscador` : "La fuente no tiene datos: importe un archivo" };
  } else result = { ok: false, message: `${def.name}: no hay API implementada. Requiere: ${def.requirements.join("; ")}` };
  await logConnector(src.connector_key, src.id, result.ok ? "info" : "warn", `Prueba de conexión: ${result.message}`);
  if (def?.test) await query(`UPDATE data_sources SET last_error=$2, status=CASE WHEN $3 THEN status ELSE 'error' END, updated_at=now() WHERE id=$1`, [src.id, result.ok ? null : result.message, result.ok]);
  res.json(result);
});

router.get("/sources/:id/logs", async (req, res) => {
  const r = await query(`SELECT id, level, message, details, created_at FROM connector_logs WHERE source_id=$1 ORDER BY created_at DESC LIMIT 100`, [String(req.params.id)]);
  const imports = await query(`SELECT i.*, u.name AS user_name FROM imports i LEFT JOIN users u ON u.id=i.created_by WHERE source_id=$1 ORDER BY created_at DESC LIMIT 30`, [String(req.params.id)]);
  res.json({ logs: r.rows, imports: imports.rows });
});

router.post("/sources/:id/import", requireAdmin, upload.single("file"), async (req, res) => {
  const src = await one(`SELECT * FROM data_sources WHERE id=$1`, [String(req.params.id)]);
  if (!src) throw notFound("Fuente");
  if (src.connector_key !== "archivo") throw new HttpError(409, "Esta fuente no admite importación de archivos");
  if (!req.file) throw new HttpError(400, "Adjunte un archivo .csv o .xlsx");
  const mode = req.body?.mode === "reemplazar" ? "reemplazar" : "anadir";
  let rows: Record<string, string>[];
  try {
    rows = await readRows(req.file.buffer, req.file.originalname);
  } catch (e) {
    throw new HttpError(400, `No se pudo leer el archivo: ${(e as Error).message}`);
  }
  if (!rows.length) throw new HttpError(400, "El archivo no contiene filas de datos");
  if (rows.length > 200_000) throw new HttpError(400, "El archivo supera las 200.000 filas; divídalo en varios");
  const result = await importRows(src, rows, mode, req.user!.id);
  await query(`INSERT INTO imports (source_id, filename, mode, rows_total, rows_ok, rows_error, errors, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [src.id, req.file.originalname.slice(0, 200), mode, result.total, result.ok, result.errors.length, JSON.stringify(result.errors.slice(0, 200)), req.user!.id]);
  await logConnector("archivo", src.id, result.errors.length ? "warn" : "info", `Importación ${req.file.originalname}: ${result.ok}/${result.total} filas correctas`);
  await audit(req, "integracion.importacion", "data_source", src.id, { file: req.file.originalname, ok: result.ok, total: result.total });
  res.json(result);
});
