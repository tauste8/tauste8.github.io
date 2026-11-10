/**
 * Motor de validación de compatibilidad.
 *
 * Principio: solo se declara COMPATIBILIDAD CONFIRMADA cuando hay evidencia técnica suficiente
 * procedente de una fuente marcada como verificada. Cualquier contradicción explícita en un dato
 * técnico produce NO COMPATIBLE. En el resto de casos el resultado queda PENDIENTE DE VERIFICAR y
 * se enumera exactamente qué información falta.
 */
import { normText } from "../lib/text.js";

export type CompatStatus = "confirmada" | "pendiente" | "no_compatible";

export interface Compat {
  status: CompatStatus;
  matched: string[];
  conflicts: string[];
  missing: string[];
  evidence: string[];
}

export interface VehicleData {
  make?: string | null;
  model?: string | null;
  generation?: string | null;
  year?: number | null;
  engine_code?: string | null;
  fuel?: string | null;
  power_kw?: number | null;
  transmission?: string | null;
  displacement_cc?: number | null;
}

export interface Application {
  make: string;
  model?: string | null;
  generation?: string | null;
  year_from?: number | null;
  year_to?: number | null;
  engine_codes?: string[] | null;
  fuel?: string | null;
  power_kw_from?: number | null;
  power_kw_to?: number | null;
  transmission?: string | null;
  position?: string | null;
}

const MAKE_ALIASES: Record<string, string> = {
  vw: "volkswagen", "mercedes": "mercedes benz", "mercedesbenz": "mercedes benz", skoda: "skoda",
  citroen: "citroen", "ds": "ds automobiles",
};

function canonMake(v: string | null | undefined) {
  const n = normText(v);
  return MAKE_ALIASES[n] ?? n;
}

function sameModel(a: string, b: string) {
  const x = normText(a);
  const y = normText(b);
  if (!x || !y) return false;
  // "golf" vs "golf v" → se considera el mismo modelo; la generación se compara aparte
  return x === y || x.startsWith(y + " ") || y.startsWith(x + " ");
}

const FUEL_MAP: Record<string, string> = {
  diesel: "diesel", gasoil: "diesel", gasoleo: "diesel", tdi: "diesel", hdi: "diesel", dci: "diesel", cdi: "diesel",
  gasolina: "gasolina", petrol: "gasolina", gasoline: "gasolina", benzina: "gasolina",
  hibrido: "hibrido", hybrid: "hibrido", electrico: "electrico", electric: "electrico", glp: "glp", lpg: "glp", gnc: "gnc", cng: "gnc",
};
export function canonFuel(v: string | null | undefined): string | null {
  const n = normText(v);
  if (!n) return null;
  for (const [k, val] of Object.entries(FUEL_MAP)) if (n.includes(k)) return val;
  return n;
}

function canonTransmission(v: string | null | undefined): string | null {
  const n = normText(v);
  if (!n) return null;
  if (/(auto|dsg|cvt|tiptronic|edc|eat|dct)/.test(n)) return "automatica";
  if (/manual/.test(n)) return "manual";
  return n;
}

const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Evalúa una aplicación concreta de catálogo frente al vehículo identificado. */
export function evaluateApplication(
  v: VehicleData,
  app: Application,
  opts: { verifiedSource: boolean; requestedSide?: string | null; requestedAxle?: string | null; sourceLabel: string },
): Compat {
  const matched: string[] = [];
  const conflicts: string[] = [];
  const missing: string[] = [];

  // Marca
  if (!v.make) missing.push("Marca del vehículo");
  else if (canonMake(v.make) !== canonMake(app.make)) conflicts.push(`Marca: el vehículo es ${v.make}, la pieza es para ${app.make}`);
  else matched.push(`Marca ${app.make}`);

  // Modelo
  if (app.model) {
    if (!v.model) missing.push("Modelo del vehículo");
    else if (!sameModel(v.model, app.model)) conflicts.push(`Modelo: ${v.model} ≠ ${app.model}`);
    else matched.push(`Modelo ${app.model}`);
  } else missing.push("Modelo en la aplicación del catálogo");

  // Generación
  if (app.generation && v.generation) {
    if (normText(app.generation) !== normText(v.generation)) conflicts.push(`Generación: ${v.generation} ≠ ${app.generation}`);
    else matched.push(`Generación ${app.generation}`);
  }

  // Año
  if (app.year_from || app.year_to) {
    if (!v.year) missing.push("Año del vehículo");
    else if ((app.year_from && v.year < app.year_from) || (app.year_to && v.year > app.year_to)) {
      conflicts.push(`Año ${v.year} fuera del rango ${app.year_from ?? "…"}–${app.year_to ?? "…"}`);
    } else matched.push(`Año ${v.year} dentro de ${app.year_from ?? "…"}–${app.year_to ?? "…"}`);
  } else missing.push("Rango de años en el catálogo");

  // Código de motor — dato decisivo para piezas de motor
  const codes = (app.engine_codes ?? []).map(norm).filter(Boolean);
  if (codes.length) {
    if (!v.engine_code) missing.push("Código de motor del vehículo");
    else if (!codes.includes(norm(v.engine_code))) conflicts.push(`Código de motor ${v.engine_code} no figura en la aplicación (${codes.join(", ")})`);
    else matched.push(`Código de motor ${v.engine_code}`);
  } else missing.push("Códigos de motor en el catálogo");

  // Combustible
  if (app.fuel) {
    const a = canonFuel(app.fuel);
    const b = canonFuel(v.fuel);
    if (!b) missing.push("Combustible del vehículo");
    else if (a !== b) conflicts.push(`Combustible: ${v.fuel} ≠ ${app.fuel}`);
    else matched.push(`Combustible ${app.fuel}`);
  }

  // Potencia
  if (app.power_kw_from || app.power_kw_to) {
    if (!v.power_kw) missing.push("Potencia del vehículo");
    else if ((app.power_kw_from && v.power_kw < app.power_kw_from) || (app.power_kw_to && v.power_kw > app.power_kw_to)) {
      conflicts.push(`Potencia ${v.power_kw} kW fuera de ${app.power_kw_from ?? "…"}–${app.power_kw_to ?? "…"} kW`);
    } else matched.push(`Potencia ${v.power_kw} kW`);
  }

  // Transmisión
  if (app.transmission) {
    const a = canonTransmission(app.transmission);
    const b = canonTransmission(v.transmission);
    if (!b) missing.push("Tipo de transmisión del vehículo");
    else if (a !== b) conflicts.push(`Transmisión: ${v.transmission} ≠ ${app.transmission}`);
    else matched.push(`Transmisión ${app.transmission}`);
  }

  // Posición de montaje (lado / eje)
  const pos = normText(app.position);
  if (opts.requestedSide) {
    if (pos.includes("izquierd") || pos.includes("derech")) {
      if (!pos.includes(opts.requestedSide.slice(0, 6))) conflicts.push(`Lado de montaje: se pide ${opts.requestedSide}, la pieza es ${app.position}`);
      else matched.push(`Lado ${opts.requestedSide}`);
    }
  }
  if (opts.requestedAxle) {
    if (pos.includes("delanter") || pos.includes("traser")) {
      if (!pos.includes(opts.requestedAxle.slice(0, 6))) conflicts.push(`Eje: se pide ${opts.requestedAxle}, la pieza es ${app.position}`);
      else matched.push(`Eje ${opts.requestedAxle}`);
    }
  }

  let status: CompatStatus;
  if (conflicts.length) status = "no_compatible";
  else {
    const decisiveOk =
      matched.some((m) => m.startsWith("Marca")) &&
      matched.some((m) => m.startsWith("Modelo")) &&
      matched.some((m) => m.startsWith("Código de motor")) &&
      !missing.includes("Año del vehículo");
    if (decisiveOk && opts.verifiedSource) status = "confirmada";
    else {
      status = "pendiente";
      if (!opts.verifiedSource) missing.push(`Fuente no verificada (${opts.sourceLabel})`);
    }
  }
  return { status, matched, conflicts, missing, evidence: [`Aplicación de catálogo: ${opts.sourceLabel}`] };
}

const RANK: Record<CompatStatus, number> = { confirmada: 2, pendiente: 1, no_compatible: 0 };

/** De varias aplicaciones de una misma referencia, se queda con la mejor evaluación. */
export function bestOf(list: Compat[]): Compat {
  if (!list.length) {
    return { status: "pendiente", matched: [], conflicts: [], missing: ["No hay aplicaciones por vehículo para esta referencia"], evidence: [] };
  }
  return [...list].sort((a, b) => RANK[b.status] - RANK[a.status] || a.missing.length - b.missing.length)[0];
}

/** Compara especificaciones técnicas (amperaje, dientes, conector…) entre dos piezas. */
export function compareSpecs(reference: Record<string, unknown>, candidate: Record<string, unknown>, labels: Map<string, string>) {
  const matched: string[] = [];
  const conflicts: string[] = [];
  for (const [k, refV] of Object.entries(reference ?? {})) {
    if (refV === null || refV === undefined || refV === "") continue;
    const cV = candidate?.[k];
    if (cV === null || cV === undefined || cV === "") continue;
    const label = labels.get(k) ?? k;
    if (normText(String(refV)) === normText(String(cV))) matched.push(`${label}: ${refV}`);
    else conflicts.push(`${label}: ${cV} ≠ ${refV} (original)`);
  }
  return { matched, conflicts };
}

/** Combina la compatibilidad de la referencia OEM con la calidad de la equivalencia. */
export function deriveFromOem(oem: Compat, link: { verified: boolean; label: string; specs?: { matched: string[]; conflicts: string[] } }): Compat {
  const c: Compat = {
    status: oem.status,
    matched: [...oem.matched, ...(link.specs?.matched ?? [])],
    conflicts: [...oem.conflicts, ...(link.specs?.conflicts ?? [])],
    missing: [...oem.missing],
    evidence: [...oem.evidence, link.label],
  };
  if (c.conflicts.length) c.status = "no_compatible";
  else if (!link.verified && c.status === "confirmada") {
    c.status = "pendiente";
    c.missing.push("Equivalencia no verificada por la fuente");
  }
  return c;
}

export function worst(a: CompatStatus, b: CompatStatus): CompatStatus {
  return RANK[a] <= RANK[b] ? a : b;
}
