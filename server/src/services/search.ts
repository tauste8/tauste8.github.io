/**
 * BUSCADOR INTELIGENTE — orquestación de la búsqueda de un recambio.
 *
 *  1. Identificar el vehículo (VIN / matrícula / ficha guardada)
 *  2. Interpretar la pieza (diccionario → sinónimos de empresa → IA opcional)
 *  3. Localizar referencias OEM (catálogos importados + registro manual + referencia introducida)
 *  4. Equivalencias IAM y ofertas de recambio nuevo
 *  5. Recambio usado en centros CAT / desguaces e inventario propio
 *  6. Unificar, validar compatibilidad y ordenar
 */
import { pool, query } from "../db/pool.js";
import { CONNECTOR_BY_KEY, CONNECTORS, logConnector, readCreds, type VehicleIdentification } from "../connectors/registry.js";
import { PART_BY_CODE } from "../lib/parts-dictionary.js";
import { normRef } from "../lib/text.js";
import { classifyVehicleQuery, decodeVinLocally, makeFromManufacturer, normalizeVehicleQuery } from "../lib/vin.js";
import { aiAvailable, aiInterpretPart } from "./ai.js";
import {
  bestOf, compareSpecs, deriveFromOem, evaluateApplication, worst,
  type Application, type Compat, type CompatStatus, type VehicleData,
} from "./compatibility.js";
import { finalize, interpretPart, type PartInterpretation } from "./part-interpreter.js";

export interface VehicleInputData {
  make?: string; model?: string; generation?: string; year?: number; engine_code?: string;
  fuel?: string; power_kw?: number; transmission?: string; displacement_cc?: number; version?: string; vin?: string;
}

export interface SearchInput {
  vehicle?: string;
  vehicleId?: string;
  vehicleData?: VehicleInputData;
  part?: string;
  partCode?: string;
  side?: "izquierdo" | "derecho";
  axle?: "delantero" | "trasero";
  ref?: string;
  customerId?: string;
}

export type StepStatus = "ok" | "parcial" | "requiere_accion" | "sin_resultados" | "omitido" | "error";
export interface StepSource { name: string; status: "consultado" | "no_conectado" | "sin_datos" | "error" | "desactivado"; matches?: number; detail?: string }
export interface Step { key: string; label: string; status: StepStatus; detail: string; sources: StepSource[] }

export interface ResultItem {
  id: string;
  category: "oem" | "iam" | "cat";
  kind: "referencia" | "oferta" | "inventario";
  name: string;
  brand: string | null;
  ref: string | null;
  oemRef: string | null;
  partCode: string | null;
  price: number | null;
  currency: string;
  condition: "nuevo" | "usado" | null;
  stock: number | null;
  availability: string | null;
  location: string | null;
  supplier: { id: string; name: string; phone: string | null; email: string | null; website: string | null; location: string | null } | null;
  imageUrl: string | null;
  externalUrl: string | null;
  compat: Compat;
  source: { label: string; verified: boolean; kind: string };
  updatedAt: string | null;
  specs: Record<string, unknown>;
  donor?: { make: string | null; model: string | null; year: number | null; engineCode: string | null } | null;
  supersededBy?: string | null;
  replaces?: string[];
  notes: string[];
  relevance: number;
  inventoryId?: string;
}

export interface VehicleSummary {
  id: string; plate: string | null; vin: string | null; make: string | null; model: string | null; generation: string | null;
  year: number | null; version: string | null; engine: string | null; engine_code: string | null; displacement_cc: number | null;
  power_kw: number | null; fuel: string | null; transmission: string | null; identification_source: string | null;
  identification_level: "confirmada" | "parcial";
}

export interface Clarification {
  message: string;
  missing: string[];
  candidates: { model: string | null; generation: string | null; year_from: number | null; year_to: number | null; engine_codes: string[]; fuel: string | null; power_kw_from: number | null; power_kw_to: number | null }[];
  canCreateFromPlate?: string;
}

export interface SearchResponse {
  id: string | null;
  status: "completado" | "sin_resultados" | "requiere_vehiculo" | "requiere_pieza";
  vehicle: VehicleSummary | null;
  vehicleQueryKind: string | null;
  clarification: Clarification | null;
  part: PartInterpretation | null;
  oemRefs: string[];
  steps: Step[];
  results: { oem: ResultItem[]; iam: ResultItem[]; cat: ResultItem[] };
  durationMs: number;
  createdAt: string;
}

const VEHICLE_COLS = `id, plate, vin, make, model, generation, year, version, engine, engine_code, displacement_cc, power_kw, fuel, transmission, identification_source, identification_level`;

const SPEC_LABELS = new Map<string, string>();
for (const p of PART_BY_CODE.values()) for (const s of p.specs) SPEC_LABELS.set(s.key, s.label);

// ────────────────────────────── PASO 1 · Vehículo ──────────────────────────────

async function identifyVehicle(input: SearchInput, userId: string | null) {
  const step: Step = { key: "vehiculo", label: "Identificación del vehículo", status: "omitido", detail: "", sources: [] };
  let vehicle: VehicleSummary | null = null;
  let kind: string | null = null;
  let clarification: Clarification | null = null;

  if (input.vehicleId) {
    vehicle = (await query<VehicleSummary>(`SELECT ${VEHICLE_COLS} FROM vehicles WHERE id=$1`, [input.vehicleId])).rows[0] ?? null;
    if (!vehicle) throw Object.assign(new Error("Vehículo no encontrado"), { status: 404 });
    step.sources.push({ name: "Fichas de vehículos de AUTORECA IA", status: "consultado", matches: 1 });
  } else if (input.vehicle?.trim()) {
    const q = normalizeVehicleQuery(input.vehicle);
    kind = classifyVehicleQuery(q);
    if (kind === "desconocido") {
      step.status = "requiere_accion";
      step.detail = `«${input.vehicle}» no es una matrícula española válida ni un bastidor (VIN) de 17 caracteres.`;
      return { vehicle, kind, clarification: { message: step.detail, missing: ["Matrícula o bastidor válido"], candidates: [] }, step };
    }
    const col = kind === "vin" ? "vin" : "plate";
    vehicle = (await query<VehicleSummary>(`SELECT ${VEHICLE_COLS} FROM vehicles WHERE ${col}=$1`, [q])).rows[0] ?? null;
    step.sources.push({ name: "Fichas de vehículos de AUTORECA IA", status: "consultado", matches: vehicle ? 1 : 0 });

    if (!vehicle && kind === "vin") {
      const local = decodeVinLocally(q);
      const ident: VehicleIdentification = { make: makeFromManufacturer(local.manufacturer), notes: [] };
      const sources: string[] = [];
      if (local.manufacturer) sources.push(`Decodificación local del VIN (WMI ${local.wmi})`);
      step.sources.push({ name: "Decodificación local VIN (ISO 3779)", status: "consultado", matches: local.manufacturer ? 1 : 0 });
      // Conectores de vehículo con API implementada y activos
      const active = await query(`SELECT id, connector_key, credentials_enc, enabled FROM data_sources WHERE data_kind='vehicle' OR connector_key IN ('tecdoc','plan-parts','autowiz','matricula-dgt')`);
      for (const row of active.rows) {
        const def = CONNECTOR_BY_KEY.get(row.connector_key);
        if (!def || !def.kinds.includes("vehicle")) continue;
        if (!def.implemented || !def.identifyVin) {
          step.sources.push({ name: def.name, status: "no_conectado", detail: "Pendiente de licencia / API" });
          continue;
        }
        if (!row.enabled) { step.sources.push({ name: def.name, status: "desactivado" }); continue; }
        try {
          const r = await def.identifyVin(q, readCreds(row.credentials_enc));
          if (r) {
            for (const [k, v] of Object.entries(r)) {
              if (k === "raw" || k === "notes") continue;
              if (v !== null && v !== undefined && v !== "" && (ident as any)[k] == null) (ident as any)[k] = v;
            }
            ident.notes!.push(...(r.notes ?? []));
            sources.push(def.name);
          }
          step.sources.push({ name: def.name, status: "consultado", matches: r ? 1 : 0 });
          await logConnector(def.key, row.id, "info", `VIN consultado`, { found: !!r });
        } catch (e) {
          step.sources.push({ name: def.name, status: "error", detail: (e as Error).message });
          await logConnector(def.key, row.id, "error", `Error al decodificar VIN: ${(e as Error).message}`);
        }
      }
      const ins = await query<VehicleSummary>(
        `INSERT INTO vehicles (vin, make, model, year, engine, engine_code, displacement_cc, power_kw, fuel, transmission, version, identification_source, identification_level, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'parcial',$13) RETURNING ${VEHICLE_COLS}`,
        [q, ident.make ?? null, ident.model ?? null, ident.year ?? null, ident.engine ?? null, ident.engine_code ?? null, ident.displacement_cc ?? null,
          ident.power_kw ?? null, ident.fuel ?? null, ident.transmission ?? null, ident.version ?? null, sources.join(" + ") || null, userId],
      );
      vehicle = ins.rows[0];
    }

    if (!vehicle && kind === "matricula") {
      const plateConn = await query(`SELECT enabled FROM data_sources WHERE connector_key='matricula-dgt'`);
      step.sources.push({ name: "Identificación por matrícula (proveedor autorizado)", status: plateConn.rows[0]?.enabled ? "error" : "no_conectado", detail: "No hay proveedor de matrícula contratado" });
      if (input.vehicleData && (input.vehicleData.make || input.vehicleData.vin)) {
        vehicle = await upsertVehicleFromUser({ ...input.vehicleData }, q, userId);
      } else {
        step.status = "requiere_accion";
        step.detail = `La matrícula ${q} no está registrada y no hay un servicio de matrícula conectado. Indique el bastidor o los datos básicos del vehículo; quedará guardado para próximas búsquedas.`;
        clarification = { message: step.detail, missing: ["Bastidor (VIN) o marca, modelo, año y código de motor"], candidates: [], canCreateFromPlate: q };
        return { vehicle, kind, clarification, step };
      }
    }
  } else {
    step.detail = "No se ha indicado vehículo.";
    return { vehicle, kind, clarification, step };
  }

  // Datos aportados por el trabajador para completar la ficha
  if (vehicle && input.vehicleData && Object.values(input.vehicleData).some((v) => v !== undefined && v !== "")) {
    vehicle = await completeVehicle(vehicle.id, input.vehicleData);
  }

  if (vehicle) {
    const missing: string[] = [];
    if (!vehicle.make) missing.push("Marca");
    if (!vehicle.model) missing.push("Modelo");
    if (!vehicle.year) missing.push("Año");
    if (!vehicle.engine_code) missing.push("Código de motor");
    if (!vehicle.fuel) missing.push("Combustible");
    const desc = [vehicle.make, vehicle.model, vehicle.generation, vehicle.year, vehicle.engine_code].filter(Boolean).join(" · ");
    if (missing.length) {
      step.status = "parcial";
      step.detail = `${desc || "Vehículo sin datos técnicos"}. Faltan: ${missing.join(", ")}.`;
      const candidates = vehicle.make ? await versionCandidates(vehicle) : [];
      clarification = {
        message: candidates.length
          ? "Hay varias versiones posibles en los catálogos cargados. Seleccione la correcta o complete los datos que faltan."
          : "Complete los datos que faltan para poder confirmar compatibilidades.",
        missing,
        candidates,
      };
    } else {
      step.status = "ok";
      step.detail = `${desc}${vehicle.identification_level === "confirmada" ? " (ficha confirmada)" : " (pendiente de confirmar por un trabajador)"}`;
    }
  }
  return { vehicle, kind, clarification, step };
}

async function versionCandidates(v: VehicleSummary) {
  const params: unknown[] = [v.make];
  let where = `lower(make) = lower($1)`;
  if (v.model) { params.push(v.model); where += ` AND (model IS NULL OR lower(model) = lower($${params.length}) OR lower(model) LIKE lower($${params.length}) || ' %')`; }
  if (v.year) { params.push(v.year); where += ` AND (year_from IS NULL OR year_from <= $${params.length}) AND (year_to IS NULL OR year_to >= $${params.length})`; }
  const r = await query(
    `SELECT DISTINCT model, generation, year_from, year_to, engine_codes, fuel, power_kw_from, power_kw_to
     FROM oem_applications WHERE ${where} AND cardinality(engine_codes) > 0 ORDER BY model, generation, year_from LIMIT 25`,
    params,
  );
  return r.rows;
}

export async function upsertVehicleFromUser(d: VehicleInputData, plate: string | null, userId: string | null): Promise<VehicleSummary> {
  const vin = d.vin ? normalizeVehicleQuery(d.vin) : null;
  if (vin) {
    const existing = await query<VehicleSummary>(`SELECT ${VEHICLE_COLS} FROM vehicles WHERE vin=$1`, [vin]);
    if (existing.rows[0]) {
      if (plate) await query(`UPDATE vehicles SET plate=COALESCE(plate,$2), updated_at=now() WHERE id=$1`, [existing.rows[0].id, plate]);
      return completeVehicle(existing.rows[0].id, d);
    }
  }
  const r = await query<VehicleSummary>(
    `INSERT INTO vehicles (plate, vin, make, model, generation, year, engine_code, fuel, power_kw, transmission, displacement_cc, version, identification_source, identification_level, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Datos introducidos por el trabajador','parcial',$13) RETURNING ${VEHICLE_COLS}`,
    [plate, vin, d.make || null, d.model || null, d.generation || null, d.year || null, d.engine_code?.toUpperCase() || null, d.fuel || null,
      d.power_kw || null, d.transmission || null, d.displacement_cc || null, d.version || null, userId],
  );
  return r.rows[0];
}

async function completeVehicle(id: string, d: VehicleInputData): Promise<VehicleSummary> {
  const r = await query<VehicleSummary>(
    `UPDATE vehicles SET make=COALESCE($2,make), model=COALESCE($3,model), generation=COALESCE($4,generation), year=COALESCE($5,year),
       engine_code=COALESCE($6,engine_code), fuel=COALESCE($7,fuel), power_kw=COALESCE($8,power_kw), transmission=COALESCE($9,transmission),
       displacement_cc=COALESCE($10,displacement_cc), version=COALESCE($11,version),
       identification_source = CASE WHEN identification_source IS NULL THEN 'Datos introducidos por el trabajador'
         WHEN identification_source LIKE '%trabajador%' THEN identification_source ELSE identification_source || ' + datos del trabajador' END,
       updated_at=now()
     WHERE id=$1 RETURNING ${VEHICLE_COLS}`,
    [id, d.make || null, d.model || null, d.generation || null, d.year || null, d.engine_code?.toUpperCase() || null, d.fuel || null,
      d.power_kw || null, d.transmission || null, d.displacement_cc || null, d.version || null],
  );
  return r.rows[0];
}

// ────────────────────────────── PASO 2 · Pieza ──────────────────────────────

async function interpret(input: SearchInput): Promise<{ part: PartInterpretation | null; step: Step; refFromPart: string | null }> {
  const step: Step = { key: "pieza", label: "Interpretación de la pieza", status: "omitido", detail: "", sources: [] };
  if (input.partCode) {
    const p = PART_BY_CODE.get(input.partCode);
    if (!p) throw Object.assign(new Error("Tipo de pieza no válido"), { status: 400 });
    const part = finalize({
      input: input.part || p.name, code: p.code, name: p.name, category: p.category, side: input.side ?? null, axle: input.axle ?? null,
      confidence: 1, method: "exacto", alternatives: [], missing: [], notes: ["Pieza seleccionada por el trabajador."], source: "Selección del trabajador",
    }, p);
    step.status = "ok";
    step.detail = describePart(part);
    step.sources.push({ name: "Selección del trabajador", status: "consultado", matches: 1 });
    return { part, step, refFromPart: null };
  }
  if (!input.part?.trim()) return { part: null, step, refFromPart: null };

  let part = await interpretPart(input.part);
  if (input.side) part.side = input.side;
  if (input.axle) part.axle = input.axle;
  step.sources.push({ name: "Diccionario de denominaciones", status: "consultado", matches: part.code ? 1 : 0 });

  // ¿Ha escrito una referencia en el campo de pieza?
  const looksLikeRef = /\d/.test(input.part) && normRef(input.part).length >= 5 && !/\s{1}\w+\s/.test(input.part.trim());
  if (!part.code && looksLikeRef) {
    step.status = "omitido";
    step.detail = `«${input.part}» parece una referencia: se busca como referencia.`;
    return { part: null, step, refFromPart: input.part };
  }

  if ((!part.code || part.confidence < 0.7) && aiAvailable()) {
    try {
      const ai = await aiInterpretPart(input.part);
      step.sources.push({ name: "Asistente IA (Claude)", status: "consultado", matches: ai && ai.part_code !== "DESCONOCIDO" ? 1 : 0 });
      if (ai && ai.part_code !== "DESCONOCIDO") {
        const p = PART_BY_CODE.get(ai.part_code)!;
        const conf = ai.certainty === "alta" ? 0.85 : ai.certainty === "media" ? 0.65 : 0.4;
        if (!part.code || conf > part.confidence) {
          part = finalize({
            ...part, code: p.code, name: p.name, category: p.category, confidence: conf, method: "ia", missing: [],
            side: part.side ?? (ai.side !== "no_indicado" ? ai.side : null),
            axle: part.axle ?? (ai.axle !== "no_indicado" ? ai.axle : null),
            source: "Asistente IA (Claude) — interpretación a verificar",
            notes: [...part.notes, `IA: ${ai.explanation}`],
          }, p);
        }
      }
    } catch (e) {
      step.sources.push({ name: "Asistente IA (Claude)", status: "error", detail: (e as Error).message });
    }
  } else if (!part.code) {
    step.sources.push({ name: "Asistente IA (Claude)", status: aiAvailable() ? "consultado" : "no_conectado", detail: aiAvailable() ? undefined : "Sin clave de API configurada" });
  }

  if (!part.code) {
    step.status = "requiere_accion";
    step.detail = `No se reconoce «${input.part}». Seleccione el tipo de pieza en la lista o añada el término como sinónimo en Configuración.`;
  } else {
    step.status = part.missing.length || part.confidence < 0.7 ? "parcial" : "ok";
    step.detail = describePart(part);
  }
  return { part, step, refFromPart: null };
}

function describePart(p: PartInterpretation) {
  const extra = [p.axle, p.side].filter(Boolean).join(" ");
  let s = `${p.name}${extra ? ` (${extra})` : ""} · ${p.category}`;
  if (p.missing.length) s += `. Falta: ${p.missing.join(", ")}`;
  return s;
}

// ────────────────────────────── PASOS 3-6 · Referencias y ofertas ──────────────────────────────

interface OemRow {
  id: string; oem_ref: string; oem_ref_display: string; vehicle_make: string; part_code: string | null; description: string;
  superseded_by: string | null; specs: Record<string, unknown>; source_id: string | null; source_label: string; verified: boolean; updated_at: string;
}

interface SupplierRow { id: string; name: string; phone: string | null; email: string | null; website: string | null; location: string | null }

function vehicleData(v: VehicleSummary | null): VehicleData | null {
  return v ? { make: v.make, model: v.model, generation: v.generation, year: v.year, engine_code: v.engine_code, fuel: v.fuel, power_kw: v.power_kw, transmission: v.transmission } : null;
}

const NO_VEHICLE: Compat = { status: "pendiente", matched: [], conflicts: [], missing: ["Vehículo no identificado: no se puede validar la aplicación"], evidence: [] };

function relevance(c: CompatStatus, price: number | null, stock: number | null, verified: boolean) {
  return (c === "confirmada" ? 300 : c === "pendiente" ? 200 : 0) + (stock && stock > 0 ? 30 : 0) + (price != null ? 10 : 0) + (verified ? 5 : 0);
}

export async function runSearch(input: SearchInput, userId: string | null): Promise<SearchResponse> {
  const t0 = Date.now();
  const steps: Step[] = [];

  const v = await identifyVehicle(input, userId);
  steps.push(v.step);
  const vehicle = v.vehicle;
  const vd = vehicleData(vehicle);

  const ip = await interpret(input);
  steps.push(ip.step);
  const part = ip.part;
  const refInput = input.ref?.trim() || ip.refFromPart;

  const base = { vehicle, vehicleQueryKind: v.kind, clarification: v.clarification, part };

  if (!vehicle && !refInput) {
    return finish({ ...base, status: v.clarification ? "requiere_vehiculo" : "requiere_vehiculo", steps, oemRefs: [], results: { oem: [], iam: [], cat: [] } }, input, userId, t0);
  }
  if (!part?.code && !refInput) {
    return finish({ ...base, status: "requiere_pieza", steps, oemRefs: [], results: { oem: [], iam: [], cat: [] } }, input, userId, t0);
  }

  const sources = (await query(`SELECT id, connector_key, name, data_kind, enabled, verified_source, status, supplier_id FROM data_sources`)).rows;
  const sourceName = new Map<string, string>(sources.map((s) => [s.id, s.name]));
  const disabledSources = sources.filter((s) => !s.enabled).map((s) => s.id);
  const suppliers = new Map<string, SupplierRow>(
    (await query<SupplierRow>(`SELECT id, name, phone, email, website, location FROM suppliers`)).rows.map((s) => [s.id, s]),
  );
  const licensed = CONNECTORS.filter((c) => c.mode === "licencia");
  const notConnected = (kind: string): StepSource[] =>
    licensed.filter((c) => c.kinds.includes(kind as any)).map((c) => ({ name: c.name, status: "no_conectado" as const, detail: c.implemented ? undefined : "Pendiente de licencia / API" }));
  const sourceUsage = new Map<string, number>();
  const bump = (id: string | null) => id && sourceUsage.set(id, (sourceUsage.get(id) ?? 0) + 1);
  const enabledFilter = `(source_id IS NULL OR NOT (source_id = ANY($__::uuid[])))`;
  const withDisabled = (sql: string, params: unknown[]) => {
    params.push(disabledSources);
    return sql.replaceAll("$__", `$${params.length}`);
  };

  // ── PASO 3 · OEM ──
  const oemStep: Step = { key: "oem", label: "Referencias OEM", status: "sin_resultados", detail: "", sources: [] };
  const oemRows = new Map<string, OemRow>();
  const oemCompat = new Map<string, Compat>();
  const directRefs = new Set<string>();
  const refNotes: string[] = [];

  if (refInput) {
    const r = normRef(refInput);
    directRefs.add(r);
    const p: unknown[] = [r];
    const rows = await query<OemRow>(withDisabled(`SELECT * FROM oem_references WHERE (oem_ref=$1 OR superseded_by=$1) AND ${enabledFilter}`, p), p);
    rows.rows.forEach((o) => oemRows.set(o.id, o));
    const p2: unknown[] = [r];
    const viaIam = await query(withDisabled(`SELECT DISTINCT oem_ref FROM cross_references WHERE iam_ref=$1 AND ${enabledFilter}`, p2), p2);
    viaIam.rows.forEach((x) => directRefs.add(x.oem_ref));
    if (viaIam.rows.length) refNotes.push(`La referencia ${refInput} es equivalente IAM de: ${viaIam.rows.map((x) => x.oem_ref).join(", ")}`);
    const p3: unknown[] = [r];
    const viaOffers = await query(withDisabled(`SELECT DISTINCT oem_ref FROM offers WHERE ref=$1 AND oem_ref IS NOT NULL AND ${enabledFilter}`, p3), p3);
    viaOffers.rows.forEach((x) => directRefs.add(x.oem_ref));
    const viaInv = await query(`SELECT DISTINCT oem_ref FROM inventory_items WHERE iam_ref=$1 AND oem_ref IS NOT NULL`, [r]);
    viaInv.rows.forEach((x) => directRefs.add(x.oem_ref));
    if (directRefs.size > 1) {
      const p4: unknown[] = [[...directRefs]];
      const more = await query<OemRow>(withDisabled(`SELECT * FROM oem_references WHERE oem_ref = ANY($1) AND ${enabledFilter}`, p4), p4);
      more.rows.forEach((o) => oemRows.set(o.id, o));
    }
  }
  if (vehicle?.make && part?.code) {
    const p: unknown[] = [part.code, vehicle.make];
    const rows = await query<OemRow>(
      withDisabled(
        `SELECT r.* FROM oem_references r WHERE r.part_code=$1 AND ${enabledFilter.replaceAll("source_id", "r.source_id")}
           AND (lower(r.vehicle_make)=lower($2) OR EXISTS (SELECT 1 FROM oem_applications a WHERE a.oem_reference_id=r.id AND lower(a.make)=lower($2)))`,
        p,
      ),
      p,
    );
    rows.rows.forEach((o) => oemRows.set(o.id, o));
  }
  // Supersesiones: incluir la referencia que sustituye
  const supersedingRefs = [...oemRows.values()].map((o) => o.superseded_by).filter((x): x is string => !!x);
  if (supersedingRefs.length) {
    const p: unknown[] = [supersedingRefs];
    const rows = await query<OemRow>(withDisabled(`SELECT * FROM oem_references WHERE oem_ref = ANY($1) AND ${enabledFilter}`, p), p);
    rows.rows.forEach((o) => oemRows.set(o.id, o));
  }

  const apps = oemRows.size
    ? (await query<Application & { oem_reference_id: string }>(`SELECT * FROM oem_applications WHERE oem_reference_id = ANY($1)`, [[...oemRows.keys()]])).rows
    : [];
  const appsBy = new Map<string, Application[]>();
  for (const a of apps) appsBy.set(a.oem_reference_id, [...(appsBy.get(a.oem_reference_id) ?? []), a]);

  // Una misma referencia OEM puede venir de varias fuentes: se agrupan por referencia normalizada
  const byRef = new Map<string, OemRow[]>();
  for (const o of oemRows.values()) byRef.set(o.oem_ref, [...(byRef.get(o.oem_ref) ?? []), o]);

  const results = { oem: [] as ResultItem[], iam: [] as ResultItem[], cat: [] as ResultItem[] };

  for (const [ref, rows] of byRef) {
    const evals: Compat[] = [];
    for (const o of rows) {
      bump(o.source_id);
      const list = appsBy.get(o.id) ?? [];
      if (!vd) continue;
      for (const a of list) {
        evals.push(evaluateApplication(vd, a, { verifiedSource: o.verified, requestedSide: part?.side, requestedAxle: part?.axle, sourceLabel: o.source_label }));
      }
    }
    let compat = vd ? bestOf(evals) : { ...NO_VEHICLE, missing: [...NO_VEHICLE.missing] };
    // Comprobación del tipo de pieza solicitado
    const main = rows.find((r) => r.verified) ?? rows[0];
    if (part?.code && main.part_code && main.part_code !== part.code) {
      compat = { ...compat, status: "no_compatible", conflicts: [...compat.conflicts, `Es ${PART_BY_CODE.get(main.part_code)?.name ?? main.part_code}, no ${part.name}`] };
    }
    oemCompat.set(ref, compat);
    const replaces = [...oemRows.values()].filter((x) => x.superseded_by === ref).map((x) => x.oem_ref_display);
    const notes: string[] = [];
    if (main.superseded_by) notes.push(`Sustituida por ${main.superseded_by}`);
    if (replaces.length) notes.push(`Sustituye a ${replaces.join(", ")}`);
    if (rows.length > 1) notes.push(`Presente en ${rows.length} fuentes: ${rows.map((r) => r.source_label).join(", ")}`);
    results.oem.push({
      id: `oemref:${ref}`,
      category: "oem",
      kind: "referencia",
      name: main.description,
      brand: main.vehicle_make,
      ref: main.oem_ref_display,
      oemRef: ref,
      partCode: main.part_code,
      price: null,
      currency: "EUR",
      condition: "nuevo",
      stock: null,
      availability: null,
      location: null,
      supplier: null,
      imageUrl: null,
      externalUrl: null,
      compat,
      source: { label: rows.map((r) => r.source_label).join(" · "), verified: rows.some((r) => r.verified), kind: "Catálogo OEM" },
      updatedAt: rows.map((r) => r.updated_at).sort().at(-1) ?? null,
      specs: main.specs ?? {},
      supersededBy: main.superseded_by,
      replaces,
      notes,
      relevance: relevance(compat.status, null, null, main.verified) + (directRefs.has(ref) ? 50 : 0),
    });
  }
  // Referencia introducida que no está en ningún catálogo OEM cargado: se usa igualmente para buscar ofertas
  for (const r of directRefs) {
    if (!byRef.has(r)) {
      oemCompat.set(r, {
        status: "pendiente", matched: [], conflicts: [],
        missing: ["La referencia no está en los catálogos OEM cargados: no hay aplicaciones por vehículo"],
        evidence: [`Referencia introducida por el trabajador: ${refInput}`],
      });
    }
  }
  const oemRefs = [...new Set([...byRef.keys(), ...directRefs])];

  oemStep.sources.push(
    ...sources.filter((s) => s.data_kind === "oem").map((s) => ({
      name: s.name, status: (s.enabled ? "consultado" : "desactivado") as StepSource["status"],
      matches: [...oemRows.values()].filter((o) => o.source_id === s.id).length,
    })),
    ...notConnected("oem"),
  );
  oemStep.status = byRef.size ? "ok" : directRefs.size ? "parcial" : "sin_resultados";
  oemStep.detail = byRef.size
    ? `${byRef.size} referencia(s) OEM: ${[...byRef.values()].map((r) => r[0].oem_ref_display).join(", ")}`
    : directRefs.size
      ? `Se busca por la referencia introducida (${[...directRefs].join(", ")}); no figura en los catálogos OEM cargados.`
      : "No hay referencias OEM para esta pieza y vehículo en los catálogos cargados. Puede registrar la referencia tras consultarla en el catálogo original.";
  if (refNotes.length) oemStep.detail += ` ${refNotes.join(". ")}`;
  steps.push(oemStep);

  const oemSpecs = new Map<string, Record<string, unknown>>();
  for (const o of oemRows.values()) if (Object.keys(o.specs ?? {}).length) oemSpecs.set(o.oem_ref, o.specs);
  const makeOfRef = new Map<string, string>();
  for (const o of oemRows.values()) makeOfRef.set(o.oem_ref, o.vehicle_make);

  // ── PASO 4 · IAM + ofertas de nuevo ──
  const iamStep: Step = { key: "iam", label: "Equivalencias IAM y recambio nuevo", status: "sin_resultados", detail: "", sources: [] };
  const seen = new Set<string>();
  if (oemRefs.length) {
    const p: unknown[] = [oemRefs];
    const xrefs = (await query(withDisabled(`SELECT * FROM cross_references WHERE oem_ref = ANY($1) AND ${enabledFilter}`, p), p)).rows;
    const iamRefs = [...new Set(xrefs.map((x) => x.iam_ref))];
    const pOff: unknown[] = [oemRefs, iamRefs];
    const offers = (await query(withDisabled(`SELECT * FROM offers WHERE condition='nuevo' AND (oem_ref = ANY($1) OR ref = ANY($2) OR ref = ANY($1)) AND ${enabledFilter}`, pOff), pOff)).rows;
    const inv = (await query(`SELECT * FROM inventory_items WHERE condition='nuevo' AND (oem_ref = ANY($1) OR iam_ref = ANY($2) OR iam_ref = ANY($1))`, [oemRefs, iamRefs])).rows;

    const isOriginal = (brand: string | null, ref: string | null, oemRef: string | null) =>
      (!!ref && oemRefs.includes(ref)) || (!!brand && !!oemRef && makeOfRef.get(oemRef)?.toLowerCase() === brand.toLowerCase());

    // Ofertas
    for (const o of offers) {
      const linkX = xrefs.find((x) => x.iam_ref === o.ref && (!o.brand || x.iam_brand.toLowerCase() === String(o.brand).toLowerCase()));
      const oemRef = linkX?.oem_ref ?? o.oem_ref ?? (oemRefs.includes(o.ref) ? o.ref : null);
      const base = oemCompat.get(oemRef) ?? { ...NO_VEHICLE, missing: [...NO_VEHICLE.missing] };
      const original = isOriginal(o.brand, o.ref, o.oem_ref);
      const specRef = oemSpecs.get(oemRef) ?? {};
      const linkLabel = original
        ? "Misma referencia original"
        : linkX ? `Equivalencia ${linkX.source_label}` : `Referencia OEM declarada en la tarifa de ${sourceName.get(o.source_id)}`;
      const compat = deriveFromOem(base, {
        verified: original || (!!linkX && linkX.verified),
        label: linkLabel,
        specs: compareSpecs(specRef, { ...(linkX?.specs ?? {}), ...(o.specs ?? {}) }, SPEC_LABELS),
      });
      bump(o.source_id);
      if (linkX) bump(linkX.source_id);
      const item = offerItem(o, original ? "oem" : "iam", compat, suppliers, sourceName, oemRef);
      if (linkX) item.notes.push(`Equivalencia: ${linkX.iam_brand} ${linkX.iam_ref_display} ↔ OEM ${linkX.oem_ref}`);
      results[item.category].push(item);
      if (linkX) seen.add(linkX.id);
    }
    // Inventario propio (nuevo)
    for (const it of inv) {
      const linkX = xrefs.find((x) => x.iam_ref === it.iam_ref);
      const oemRef = it.oem_ref ?? linkX?.oem_ref ?? null;
      const original =
        (!!it.iam_ref && oemRefs.includes(it.iam_ref)) ||
        (!it.iam_ref && (!it.brand || makeOfRef.get(it.oem_ref)?.toLowerCase() === String(it.brand).toLowerCase()));
      const base = oemCompat.get(oemRef) ?? { ...NO_VEHICLE, missing: [...NO_VEHICLE.missing] };
      const compat = deriveFromOem(base, {
        verified: original || (!!linkX && linkX.verified),
        label: original ? "Misma referencia original (inventario)" : linkX ? `Equivalencia ${linkX.source_label}` : "Referencias registradas en inventario",
        specs: compareSpecs(oemSpecs.get(oemRef) ?? {}, it.specs ?? {}, SPEC_LABELS),
      });
      const item = inventoryItem(it, original ? "oem" : "iam", compat, suppliers, oemRef);
      results[item.category].push(item);
      if (linkX) seen.add(linkX.id);
    }
    // Equivalencias sin oferta de precio
    for (const x of xrefs) {
      if (seen.has(x.id)) continue;
      bump(x.source_id);
      const base = oemCompat.get(x.oem_ref) ?? { ...NO_VEHICLE, missing: [...NO_VEHICLE.missing] };
      const compat = deriveFromOem(base, { verified: x.verified, label: `Equivalencia ${x.source_label}`, specs: compareSpecs(oemSpecs.get(x.oem_ref) ?? {}, x.specs ?? {}, SPEC_LABELS) });
      results.iam.push({
        id: `xref:${x.id}`,
        category: "iam",
        kind: "referencia",
        name: x.description || part?.name || "Equivalencia",
        brand: x.iam_brand,
        ref: x.iam_ref_display,
        oemRef: x.oem_ref,
        partCode: part?.code ?? null,
        price: null,
        currency: "EUR",
        condition: "nuevo",
        stock: null,
        availability: null,
        location: null,
        supplier: null,
        imageUrl: null,
        externalUrl: null,
        compat,
        source: { label: x.source_label, verified: x.verified, kind: "Equivalencia IAM" },
        updatedAt: x.updated_at,
        specs: x.specs ?? {},
        notes: ["Sin precio: ningún proveedor conectado ofrece esta referencia", ...(x.notes ? [x.notes] : [])],
        relevance: relevance(compat.status, null, null, x.verified),
      });
    }
  }
  iamStep.sources.push(
    { name: "Inventario propio", status: "consultado", matches: [...results.oem, ...results.iam].filter((r) => r.kind === "inventario").length },
    ...sources.filter((s) => s.data_kind === "iam" || s.data_kind === "offers_new").map((s) => ({
      name: s.name, status: (s.enabled ? "consultado" : "desactivado") as StepSource["status"], matches: sourceUsage.get(s.id) ?? 0,
    })),
    ...notConnected("iam"),
    ...notConnected("offers_new").filter((x) => !notConnected("iam").some((y) => y.name === x.name)),
  );
  iamStep.status = results.iam.length ? "ok" : oemRefs.length ? "sin_resultados" : "omitido";
  iamStep.detail = results.iam.length
    ? `${results.iam.length} equivalencia(s) / oferta(s) de recambio nuevo`
    : oemRefs.length
      ? "No hay equivalencias ni ofertas para las referencias encontradas en las fuentes conectadas."
      : "Sin referencia OEM no se pueden buscar equivalencias verificables.";
  steps.push(iamStep);

  // ── PASO 5 · Usado CAT ──
  const catStep: Step = { key: "cat", label: "Recambio usado (centros CAT y desguaces)", status: "sin_resultados", detail: "", sources: [] };
  const catSeen = new Set<string>();
  const pushUsed = (rows: any[], fromInventory: boolean) => {
    for (const o of rows) {
      const key = (fromInventory ? "inv:" : "off:") + o.id;
      if (catSeen.has(key)) continue;
      catSeen.add(key);
      let compat: Compat;
      const oemRef = o.oem_ref && oemRefs.includes(o.oem_ref) ? o.oem_ref : null;
      if (oemRef) {
        compat = deriveFromOem(oemCompat.get(oemRef)!, {
          verified: true,
          label: `Referencia OEM ${oemRef} indicada por ${fromInventory ? "el inventario" : sourceName.get(o.source_id)}`,
          specs: compareSpecs(oemSpecs.get(oemRef) ?? {}, o.specs ?? {}, SPEC_LABELS),
        });
      } else if (vd) {
        const donorApp: Application = {
          make: o.vehicle_make, model: o.vehicle_model,
          year_from: o.vehicle_year, year_to: o.vehicle_year,
          engine_codes: o.vehicle_engine_code ? [o.vehicle_engine_code] : [],
        };
        compat = evaluateApplication(vd, donorApp, { verifiedSource: false, sourceLabel: "Datos del vehículo donante", requestedSide: null, requestedAxle: null });
        // El año del donante no tiene por qué coincidir: no se considera conflicto
        compat.conflicts = compat.conflicts.filter((c) => !c.startsWith("Año"));
        compat.status = compat.conflicts.length ? "no_compatible" : "pendiente";
        compat.missing = [...new Set([...compat.missing.filter((m) => !m.startsWith("Fuente no verificada") && m !== "Rango de años en el catálogo"), "Referencia OEM de la pieza usada (comprobar etiqueta)"])];
        compat.evidence = ["Coincidencia por vehículo donante (marca, modelo y motor)"];
      } else {
        compat = { ...NO_VEHICLE, missing: [...NO_VEHICLE.missing] };
      }
      if (part?.code && o.part_code && o.part_code !== part.code) continue;
      if (!fromInventory) bump(o.source_id);
      const item = fromInventory ? inventoryItem(o, "cat", compat, suppliers, oemRef) : offerItem(o, "cat", compat, suppliers, sourceName, oemRef);
      item.donor = { make: o.vehicle_make, model: o.vehicle_model, year: o.vehicle_year, engineCode: o.vehicle_engine_code };
      results.cat.push(item);
    }
  };
  if (oemRefs.length) {
    const p: unknown[] = [oemRefs];
    pushUsed((await query(withDisabled(`SELECT * FROM offers WHERE condition='usado' AND oem_ref = ANY($1) AND ${enabledFilter}`, p), p)).rows, false);
    pushUsed((await query(`SELECT * FROM inventory_items WHERE condition='usado' AND oem_ref = ANY($1)`, [oemRefs])).rows, true);
  }
  if (vehicle?.make && vehicle.model && part?.code) {
    const p: unknown[] = [part.code, vehicle.make, vehicle.model];
    const donorWhere = `part_code=$1 AND lower(vehicle_make)=lower($2) AND (lower(vehicle_model)=lower($3) OR lower(vehicle_model) LIKE lower($3) || ' %' OR lower($3) LIKE lower(vehicle_model) || ' %')`;
    pushUsed((await query(withDisabled(`SELECT * FROM offers WHERE condition='usado' AND ${donorWhere} AND ${enabledFilter}`, p), p)).rows, false);
    pushUsed((await query(`SELECT * FROM inventory_items WHERE condition='usado' AND ${donorWhere}`, [part.code, vehicle.make, vehicle.model])).rows, true);
  }
  catStep.sources.push(
    { name: "Inventario propio (usado)", status: "consultado", matches: results.cat.filter((r) => r.kind === "inventario").length },
    ...sources.filter((s) => s.data_kind === "offers_used").map((s) => ({
      name: s.name, status: (s.enabled ? "consultado" : "desactivado") as StepSource["status"], matches: results.cat.filter((r) => r.source.label === s.name).length,
    })),
    ...notConnected("offers_used"),
  );
  catStep.status = results.cat.length ? "ok" : "sin_resultados";
  catStep.detail = results.cat.length ? `${results.cat.length} pieza(s) usada(s) localizada(s)` : "No hay piezas usadas para esta referencia o vehículo en las fuentes conectadas.";
  steps.push(catStep);

  // ── PASO 6 · Unificar ──
  for (const k of ["oem", "iam", "cat"] as const) results[k].sort((a, b) => b.relevance - a.relevance || (a.price ?? 1e12) - (b.price ?? 1e12));
  const total = results.oem.length + results.iam.length + results.cat.length;
  const confirmed = [...results.oem, ...results.iam, ...results.cat].filter((r) => r.compat.status === "confirmada").length;
  steps.push({
    key: "unificar",
    label: "Validación y unificación",
    status: total ? "ok" : "sin_resultados",
    detail: total ? `${total} resultado(s); ${confirmed} con compatibilidad confirmada.` : "Sin resultados en las fuentes conectadas.",
    sources: [],
  });

  // Actualizar estado de uso de las fuentes
  return finish({ ...base, status: total ? "completado" : "sin_resultados", steps, oemRefs, results }, input, userId, t0);
}

function supplierOf(id: string | null, suppliers: Map<string, SupplierRow>) {
  return id ? suppliers.get(id) ?? null : null;
}

function offerItem(o: any, category: ResultItem["category"], compat: Compat, suppliers: Map<string, SupplierRow>, sourceName: Map<string, string>, oemRef: string | null): ResultItem {
  return {
    id: `offer:${o.id}`,
    category,
    kind: "oferta",
    name: o.description,
    brand: o.brand,
    ref: o.ref_display ?? null,
    oemRef: oemRef ?? o.oem_ref,
    partCode: o.part_code,
    price: o.price,
    currency: o.currency,
    condition: o.condition,
    stock: o.stock,
    availability: o.availability ?? (o.stock != null ? (o.stock > 0 ? `${o.stock} en stock` : "Sin stock") : null),
    location: o.location ?? supplierOf(o.supplier_id, suppliers)?.location ?? null,
    supplier: supplierOf(o.supplier_id, suppliers),
    imageUrl: o.image_url,
    externalUrl: o.external_url,
    compat,
    source: { label: sourceName.get(o.source_id) ?? "Fuente", verified: false, kind: o.condition === "usado" ? "Stock CAT / desguace" : "Tarifa de proveedor" },
    updatedAt: o.source_updated_at ?? o.updated_at,
    specs: o.specs ?? {},
    notes: [],
    relevance: relevance(compat.status, o.price, o.stock, false),
  };
}

function inventoryItem(it: any, category: ResultItem["category"], compat: Compat, suppliers: Map<string, SupplierRow>, oemRef: string | null): ResultItem {
  return {
    id: `inv:${it.id}`,
    inventoryId: it.id,
    category,
    kind: "inventario",
    name: it.description,
    brand: it.brand,
    ref: it.iam_ref_display ?? it.oem_ref_display ?? null,
    oemRef: oemRef ?? it.oem_ref,
    partCode: it.part_code,
    price: it.sale_price,
    currency: "EUR",
    condition: it.condition,
    stock: it.quantity,
    availability: it.quantity > 0 ? `${it.quantity} en almacén propio` : "Sin existencias",
    location: it.location,
    supplier: supplierOf(it.supplier_id, suppliers),
    imageUrl: null,
    externalUrl: null,
    compat,
    source: { label: "Inventario propio", verified: false, kind: "Inventario" },
    updatedAt: it.updated_at,
    specs: it.specs ?? {},
    notes: it.location ? [`Ubicación: ${it.location}`] : [],
    relevance: relevance(compat.status, it.sale_price, it.quantity, false) + 40,
  };
}

async function finish(r: Omit<SearchResponse, "id" | "durationMs" | "createdAt">, input: SearchInput, userId: string | null, t0: number): Promise<SearchResponse> {
  const durationMs = Date.now() - t0;
  const full: SearchResponse = { ...r, id: null, durationMs, createdAt: new Date().toISOString() };
  const ins = await pool.query(
    `INSERT INTO searches (user_id, vehicle_id, customer_id, query_vehicle, query_part, query_ref, part_code, status, count_oem, count_iam, count_cat, duration_ms, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, created_at`,
    [userId, r.vehicle?.id ?? null, input.customerId ?? null, input.vehicle ?? null, input.part ?? null, input.ref ?? null, r.part?.code ?? null,
      r.status, r.results.oem.length, r.results.iam.length, r.results.cat.length, durationMs, JSON.stringify({ ...full, id: undefined })],
  );
  full.id = ins.rows[0].id;
  full.createdAt = ins.rows[0].created_at;
  return full;
}

export { worst };
