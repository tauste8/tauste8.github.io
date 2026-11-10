/**
 * Importación de catálogos y tarifas en CSV / Excel.
 * Cada fila se valida; los errores se devuelven con el número de fila para que el usuario
 * pueda corregir el archivo. Nada se inventa: las columnas vacías quedan vacías.
 */
import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import type pg from "pg";
import { tx } from "../db/pool.js";
import { normRef, normText } from "../lib/text.js";
import type { DataKind } from "../connectors/registry.js";
import { resolvePartCode } from "./part-interpreter.js";

export interface ColumnDef { key: string; required?: boolean; help: string; aliases?: string[] }

const VEHICLE_APP_COLS: ColumnDef[] = [
  { key: "modelo", help: "Modelo (p. ej. Golf)" },
  { key: "generacion", help: "Generación (p. ej. V / 1K)" },
  { key: "anio_desde", help: "Año inicial de aplicación", aliases: ["ano_desde", "desde"] },
  { key: "anio_hasta", help: "Año final de aplicación", aliases: ["ano_hasta", "hasta"] },
  { key: "codigos_motor", help: "Códigos de motor separados por | o ,", aliases: ["codigo_motor", "motor"] },
  { key: "combustible", help: "Diésel / Gasolina / Híbrido…" },
  { key: "kw_desde", help: "Potencia mínima en kW" },
  { key: "kw_hasta", help: "Potencia máxima en kW" },
  { key: "transmision", help: "Manual / Automática" },
  { key: "posicion", help: "Delantero izquierdo, trasero…", aliases: ["lado"] },
];

export const TEMPLATES: Record<Exclude<DataKind, "vehicle">, ColumnDef[]> = {
  oem: [
    { key: "referencia_oem", required: true, help: "Referencia original del fabricante", aliases: ["oem", "ref_oem"] },
    { key: "marca_vehiculo", required: true, help: "Marca del vehículo (Volkswagen, Renault…)", aliases: ["marca"] },
    { key: "descripcion", required: true, help: "Denominación de la pieza", aliases: ["denominacion"] },
    { key: "tipo_pieza", help: "Código o nombre de pieza (ALTERNADOR, Alternador…)" },
    { key: "sustituida_por", help: "Referencia que la sustituye (supersesión)", aliases: ["sustituye_a_nueva"] },
    ...VEHICLE_APP_COLS,
    { key: "verificada", help: "si / no — dato comprobado en catálogo original" },
    { key: "spec_*", help: "Características técnicas: spec_amperaje, spec_dientes, spec_conector…" },
  ],
  iam: [
    { key: "referencia_oem", required: true, help: "Referencia original", aliases: ["oem", "ref_oem"] },
    { key: "marca_iam", required: true, help: "Fabricante equivalente (Bosch, Valeo…)", aliases: ["fabricante", "marca"] },
    { key: "referencia_iam", required: true, help: "Referencia del fabricante equivalente", aliases: ["referencia", "ref"] },
    { key: "descripcion", help: "Denominación" },
    { key: "verificada", help: "si / no — equivalencia publicada por el fabricante/catálogo" },
    { key: "notas", help: "Observaciones" },
    { key: "spec_*", help: "Características técnicas de la pieza equivalente" },
  ],
  offers_new: [
    { key: "descripcion", required: true, help: "Denominación de la pieza", aliases: ["denominacion", "articulo"] },
    { key: "referencia", help: "Referencia del fabricante de la pieza", aliases: ["ref", "referencia_fabricante"] },
    { key: "marca", help: "Fabricante de la pieza", aliases: ["fabricante"] },
    { key: "referencia_oem", help: "Referencia original relacionada", aliases: ["oem"] },
    { key: "tipo_pieza", help: "Código o nombre de pieza" },
    { key: "precio", help: "Precio (EUR, sin IVA)", aliases: ["pvp", "precio_neto"] },
    { key: "stock", help: "Unidades disponibles", aliases: ["cantidad", "existencias"] },
    { key: "disponibilidad", help: "Texto de disponibilidad (24 h, bajo pedido…)", aliases: ["plazo"] },
    { key: "ubicacion", help: "Almacén / provincia", aliases: ["provincia", "localidad"] },
    { key: "url_imagen", help: "URL de la fotografía", aliases: ["imagen", "foto"] },
    { key: "url", help: "Enlace a la ficha en la web del proveedor" },
    { key: "id_externo", help: "Identificador en el sistema del proveedor" },
    { key: "fecha_actualizacion", help: "Fecha de los datos (AAAA-MM-DD)" },
    { key: "spec_*", help: "Características técnicas" },
  ],
  offers_used: [
    { key: "descripcion", required: true, help: "Denominación de la pieza", aliases: ["denominacion", "articulo"] },
    { key: "referencia_oem", help: "Referencia original grabada en la pieza", aliases: ["oem", "referencia"] },
    { key: "tipo_pieza", help: "Código o nombre de pieza" },
    { key: "precio", help: "Precio (EUR, sin IVA)", aliases: ["pvp"] },
    { key: "stock", help: "Unidades", aliases: ["cantidad"] },
    { key: "disponibilidad", help: "Texto de disponibilidad" },
    { key: "ubicacion", help: "Centro CAT / provincia", aliases: ["provincia", "localidad"] },
    { key: "vehiculo_marca", help: "Marca del vehículo donante" },
    { key: "vehiculo_modelo", help: "Modelo del vehículo donante" },
    { key: "vehiculo_anio", help: "Año del vehículo donante", aliases: ["vehiculo_ano"] },
    { key: "vehiculo_codigo_motor", help: "Código de motor del donante" },
    { key: "bastidor_donante", help: "VIN del vehículo donante" },
    { key: "url_imagen", help: "URL de la fotografía" },
    { key: "url", help: "Enlace a la ficha" },
    { key: "id_externo", help: "Identificador en el sistema del CAT" },
    { key: "fecha_actualizacion", help: "Fecha de los datos" },
    { key: "spec_*", help: "Características técnicas" },
  ],
};

function headerKey(h: string) {
  return normText(h).replace(/ñ/g, "n").replace(/\s+/g, "_");
}

export async function readRows(buffer: Buffer, filename: string): Promise<Record<string, string>[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => (headers[col] = headerKey(String(cell.text ?? ""))));
    const rows: Record<string, string>[] = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const o: Record<string, string> = {};
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (headers[col]) o[headers[col]] = String(cell.text ?? "").trim();
      });
      if (Object.values(o).some((v) => v)) rows.push(o);
    });
    return rows;
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    let text = buffer.toString("utf8");
    if (text.includes("�")) text = buffer.toString("latin1");
    text = text.replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
    const recs = parseCsv(text, { delimiter, columns: (h: string[]) => h.map(headerKey), skip_empty_lines: true, trim: true, relax_column_count: true });
    return recs as Record<string, string>[];
  }
  throw new Error("Formato no admitido. Use .csv o .xlsx");
}

function pick(row: Record<string, string>, def: ColumnDef): string {
  for (const k of [def.key, ...(def.aliases ?? [])]) {
    const v = row[k];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

function intOrNull(v: string, field: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`${field}: «${v}» no es un número`);
  return Math.round(n);
}
function priceOrNull(v: string): number | null {
  if (!v) return null;
  // Admite 1.234,56 · 1234,56 · 1234.56
  let s = v.replace(/[€\s]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error(`precio: «${v}» no es un importe válido`);
  return Math.round(n * 100) / 100;
}
function bool(v: string, dflt: boolean) {
  if (!v) return dflt;
  return ["si", "sí", "s", "yes", "y", "1", "true", "verdadero", "x"].includes(v.trim().toLowerCase());
}
function dateOrNull(v: string): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const iso = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : v;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`fecha_actualizacion: «${v}» no es una fecha válida`);
  return d.toISOString();
}
function specsOf(row: Record<string, string>) {
  const specs: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) if (k.startsWith("spec_") && v) specs[k.slice(5)] = v;
  return specs;
}
function codesOf(v: string) {
  return v.split(/[|,/;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

export interface ImportResult { total: number; ok: number; errors: { fila: number; error: string }[] }

export interface SourceRow { id: string; data_kind: DataKind; supplier_id: string | null; verified_source: boolean; name: string }

export async function importRows(source: SourceRow, rows: Record<string, string>[], mode: "anadir" | "reemplazar", userId: string | null): Promise<ImportResult> {
  if (source.data_kind === "vehicle") throw new Error("Esta fuente no admite importación de archivos");
  const defs = TEMPLATES[source.data_kind];
  const errors: ImportResult["errors"] = [];
  let ok = 0;
  const col = (row: Record<string, string>, key: string) => pick(row, defs.find((d) => d.key === key)!);

  if (rows.length) {
    const present = new Set(Object.keys(rows[0]));
    const missingCols = defs.filter((d) => d.required && ![d.key, ...(d.aliases ?? [])].some((k) => present.has(k)));
    if (missingCols.length) {
      return { total: rows.length, ok: 0, errors: [{ fila: 1, error: `Faltan columnas obligatorias: ${missingCols.map((m) => m.key).join(", ")}` }] };
    }
  }

  await tx(async (c: pg.PoolClient) => {
    if (mode === "reemplazar") {
      const table = source.data_kind === "oem" ? "oem_references" : source.data_kind === "iam" ? "cross_references" : "offers";
      await c.query(`DELETE FROM ${table} WHERE source_id=$1`, [source.id]);
    }
    const touchedOem = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const fila = i + 2;
      try {
        await c.query("SAVEPOINT r");
        for (const d of defs) if (d.required && !pick(row, d)) throw new Error(`Falta «${d.key}»`);
        if (source.data_kind === "oem") {
          const ref = normRef(col(row, "referencia_oem"));
          if (!ref) throw new Error("referencia_oem vacía tras normalizar");
          const make = col(row, "marca_vehiculo");
          const part = resolvePartCode(col(row, "tipo_pieza") || col(row, "descripcion"));
          const verified = bool(col(row, "verificada"), source.verified_source);
          const r = await c.query(
            `INSERT INTO oem_references (oem_ref, oem_ref_display, vehicle_make, part_code, description, superseded_by, specs, source_id, source_label, verified, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (oem_ref, vehicle_make, COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid))
             DO UPDATE SET part_code=EXCLUDED.part_code, description=EXCLUDED.description, superseded_by=EXCLUDED.superseded_by,
               specs=EXCLUDED.specs, verified=EXCLUDED.verified, updated_at=now()
             RETURNING id`,
            [ref, col(row, "referencia_oem"), make, part, col(row, "descripcion"), normRef(col(row, "sustituida_por")) || null,
              JSON.stringify(specsOf(row)), source.id, source.name, verified, userId],
          );
          const oemId = r.rows[0].id;
          const key = `${oemId}`;
          if (!touchedOem.has(key)) {
            await c.query("DELETE FROM oem_applications WHERE oem_reference_id=$1", [oemId]);
            touchedOem.add(key);
          }
          await c.query(
            `INSERT INTO oem_applications (oem_reference_id, make, model, generation, year_from, year_to, engine_codes, fuel, power_kw_from, power_kw_to, transmission, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [oemId, make, col(row, "modelo") || null, col(row, "generacion") || null, intOrNull(col(row, "anio_desde"), "anio_desde"),
              intOrNull(col(row, "anio_hasta"), "anio_hasta"), codesOf(col(row, "codigos_motor")), col(row, "combustible") || null,
              intOrNull(col(row, "kw_desde"), "kw_desde"), intOrNull(col(row, "kw_hasta"), "kw_hasta"), col(row, "transmision") || null,
              col(row, "posicion") || null],
          );
        } else if (source.data_kind === "iam") {
          const oem = normRef(col(row, "referencia_oem"));
          const iam = normRef(col(row, "referencia_iam"));
          if (!oem || !iam) throw new Error("Referencia vacía tras normalizar");
          await c.query(
            `INSERT INTO cross_references (oem_ref, iam_brand, iam_ref, iam_ref_display, description, specs, source_id, source_label, verified, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (oem_ref, upper(iam_brand), iam_ref, COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid))
             DO UPDATE SET description=EXCLUDED.description, specs=EXCLUDED.specs, verified=EXCLUDED.verified, notes=EXCLUDED.notes, updated_at=now()`,
            [oem, col(row, "marca_iam"), iam, col(row, "referencia_iam"), col(row, "descripcion") || null, JSON.stringify(specsOf(row)),
              source.id, source.name, bool(col(row, "verificada"), source.verified_source), col(row, "notas") || null, userId],
          );
        } else {
          const used = source.data_kind === "offers_used";
          const ref = used ? "" : col(row, "referencia");
          const oem = col(row, "referencia_oem");
          const desc = col(row, "descripcion");
          const part = resolvePartCode(col(row, "tipo_pieza") || desc);
          if (!ref && !oem && !part) throw new Error("La fila necesita referencia, referencia_oem o un tipo de pieza reconocible");
          const stockRaw = col(row, "stock");
          await c.query(
            `INSERT INTO offers (source_id, supplier_id, condition, brand, ref, ref_display, oem_ref, part_code, description, price, stock, availability,
               location, image_url, external_url, external_id, vehicle_make, vehicle_model, vehicle_year, vehicle_engine_code, vehicle_vin, specs, source_updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
            [source.id, source.supplier_id, used ? "usado" : "nuevo", used ? null : col(row, "marca") || null, normRef(ref) || null, ref || null,
              normRef(oem) || null, part, desc, priceOrNull(col(row, "precio")), stockRaw ? intOrNull(stockRaw, "stock") : null,
              col(row, "disponibilidad") || null, col(row, "ubicacion") || null, safeUrl(col(row, "url_imagen")), safeUrl(col(row, "url")),
              col(row, "id_externo") || null, used ? col(row, "vehiculo_marca") || null : null, used ? col(row, "vehiculo_modelo") || null : null,
              used ? intOrNull(col(row, "vehiculo_anio"), "vehiculo_anio") : null, used ? col(row, "vehiculo_codigo_motor").toUpperCase() || null : null,
              used ? normRef(col(row, "bastidor_donante")) || null : null, JSON.stringify(specsOf(row)), dateOrNull(col(row, "fecha_actualizacion"))],
          );
        }
        await c.query("RELEASE SAVEPOINT r");
        ok++;
      } catch (e) {
        await c.query("ROLLBACK TO SAVEPOINT r");
        if (errors.length < 500) errors.push({ fila, error: (e as Error).message });
      }
    }
    await c.query(
      `UPDATE data_sources SET last_sync_at=now(), status=CASE WHEN $2::int > 0 THEN 'activo' ELSE status END,
         last_error=$3, updated_at=now() WHERE id=$1`,
      [source.id, ok, errors.length ? `${errors.length} filas con errores en la última importación` : null],
    );
  });
  return { total: rows.length, ok, errors };
}

function safeUrl(v: string): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.toString();
  } catch {
    throw new Error(`URL no válida: «${v}»`);
  }
}

export function templateCsv(kind: Exclude<DataKind, "vehicle">): string {
  const cols = TEMPLATES[kind].map((c) => (c.key === "spec_*" ? "spec_ejemplo" : c.key));
  return "﻿" + cols.join(";") + "\n";
}
