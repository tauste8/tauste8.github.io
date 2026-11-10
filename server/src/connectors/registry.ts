/**
 * Sistema de conectores.
 *
 * Cada conector es un módulo independiente que declara qué tipo de datos aporta
 * (vehículo, OEM, IAM, ofertas de nuevo, usados CAT), cómo se conecta y qué necesita.
 * Añadir un proveedor nuevo = añadir un objeto a CONNECTORS (y, si tiene API, implementar
 * sus funciones). El buscador no necesita cambios: consulta la base de datos unificada y
 * los conectores en tiempo real que estén implementados y activos.
 *
 * Política: no se simula ninguna conexión. Un conector sin API implementada se muestra
 * como "pendiente de licencia/acuerdo" y se puede alimentar mediante archivos CSV/Excel.
 */
import { query } from "../db/pool.js";
import { decrypt } from "../lib/crypto.js";

export type DataKind = "vehicle" | "oem" | "iam" | "offers_new" | "offers_used";

export interface VehicleIdentification {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  engine?: string | null;
  engine_code?: string | null;
  displacement_cc?: number | null;
  power_kw?: number | null;
  fuel?: string | null;
  transmission?: string | null;
  version?: string | null;
  raw?: unknown;
  notes?: string[];
}

export interface ConnectorDef {
  key: string;
  name: string;
  vendor: string;
  website?: string;
  kinds: DataKind[];
  /** interno: datos propios · archivo: CSV/Excel · api: API implementada · licencia: requiere contrato y documentación */
  mode: "interno" | "archivo" | "api" | "licencia";
  /** Hay llamadas reales implementadas en el código. */
  implemented: boolean;
  /** Se pueden crear varias instancias (p. ej. una por tarifa de proveedor). */
  multiInstance: boolean;
  description: string;
  requirements: string[];
  credentialFields: { key: string; label: string; secret: boolean }[];
  /** Admite que el administrador configure una URL de consulta manual (se abre desde los resultados). */
  allowsManualUrl?: boolean;
  test?: (creds: Record<string, string>, config: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>;
  identifyVin?: (vin: string, creds: Record<string, string>) => Promise<VehicleIdentification | null>;
}

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";

async function fetchJson(url: string, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "Not Applicable" ? v.trim() : null);

export const CONNECTORS: ConnectorDef[] = [
  {
    key: "inventario",
    name: "Inventario propio",
    vendor: "AUTORECA IA",
    kinds: ["offers_new", "offers_used"],
    mode: "interno",
    implemented: true,
    multiInstance: false,
    description: "Piezas registradas en el módulo Inventario. Se consultan siempre en cada búsqueda.",
    requirements: [],
    credentialFields: [],
  },
  {
    key: "manual",
    name: "Registro manual de referencias",
    vendor: "AUTORECA IA",
    kinds: ["oem", "iam"],
    mode: "interno",
    implemented: true,
    multiInstance: false,
    description:
      "Referencias OEM y equivalencias que los trabajadores registran tras consultarlas en el catálogo original. Cada búsqueda posterior las reutiliza.",
    requirements: [],
    credentialFields: [],
  },
  {
    key: "archivo",
    name: "Importación CSV / Excel",
    vendor: "AUTORECA IA",
    kinds: ["oem", "iam", "offers_new", "offers_used"],
    mode: "archivo",
    implemented: true,
    multiInstance: true,
    description:
      "Tarifas de proveedores, stock de centros CAT y desguaces, tablas de equivalencias y catálogos OEM exportados en CSV o Excel. Cree una fuente por proveedor o catálogo.",
    requirements: ["Archivo CSV (separado por ; o ,) o Excel .xlsx con la plantilla de columnas de AUTORECA IA"],
    credentialFields: [],
  },
  {
    key: "nhtsa-vpic",
    name: "NHTSA vPIC — decodificador de VIN",
    vendor: "National Highway Traffic Safety Administration (EE. UU.)",
    website: "https://vpic.nhtsa.dot.gov/api/",
    kinds: ["vehicle"],
    mode: "api",
    implemented: true,
    multiInstance: false,
    description:
      "API pública y gratuita del Gobierno de EE. UU. para decodificar bastidores. Para vehículos europeos suele devolver solo la marca y, a veces, el año; nunca se usa para dar por confirmada la versión.",
    requirements: ["Sin credenciales. El servidor necesita salida a internet hacia vpic.nhtsa.dot.gov."],
    credentialFields: [],
    async test() {
      try {
        const j = await fetchJson(`${VPIC_BASE}/DecodeVinValues/1HGCM82633A004352?format=json`);
        const ok = Array.isArray(j?.Results) && j.Results.length > 0;
        return { ok, message: ok ? "Respuesta correcta del servicio vPIC" : "Respuesta inesperada del servicio" };
      } catch (e) {
        return { ok: false, message: `No se pudo contactar con vPIC: ${(e as Error).message}` };
      }
    },
    async identifyVin(vin) {
      const j = await fetchJson(`${VPIC_BASE}/DecodeVinValues/${encodeURIComponent(vin)}?format=json`);
      const r = j?.Results?.[0];
      if (!r) return null;
      const kw = num(r.EngineKW) ?? (num(r.EngineHP) ? Math.round(Number(r.EngineHP) * 0.7355) : null);
      return {
        make: str(r.Make) ? String(r.Make).replace(/\b\w/g, (c: string) => c.toUpperCase()).replace(/\B\w/g, (c: string) => c.toLowerCase()) : null,
        model: str(r.Model),
        year: num(r.ModelYear),
        engine_code: str(r.EngineModel),
        displacement_cc: num(r.DisplacementCC) ? Math.round(Number(r.DisplacementCC)) : null,
        power_kw: kw ? Math.round(kw) : null,
        fuel: str(r.FuelTypePrimary),
        transmission: str(r.TransmissionStyle),
        version: [str(r.Series), str(r.Trim)].filter(Boolean).join(" ") || null,
        raw: { ErrorCode: r.ErrorCode, ErrorText: r.ErrorText },
        notes: str(r.ErrorText) && r.ErrorCode !== "0" ? [`vPIC: ${r.ErrorText}`] : [],
      };
    },
  },
  {
    key: "tecdoc",
    allowsManualUrl: true,
    name: "TecDoc (TecAlliance)",
    vendor: "TecAlliance GmbH",
    website: "https://www.tecalliance.net/",
    kinds: ["vehicle", "oem", "iam"],
    mode: "licencia",
    implemented: false,
    multiInstance: false,
    description:
      "Catálogo de referencia del mercado IAM: vehículos (KType), artículos, equivalencias OE ↔ IAM y criterios técnicos. Requiere contrato de datos con TecAlliance.",
    requirements: [
      "Contrato de licencia de datos TecDoc con TecAlliance",
      "Credenciales del servicio web (Provider ID y API key) y su documentación técnica",
      "Alternativa sin API: exportaciones de datos de TecAlliance en CSV importadas como fuente de archivo",
    ],
    credentialFields: [
      { key: "provider_id", label: "Provider ID", secret: false },
      { key: "api_key", label: "API key", secret: true },
    ],
  },
  {
    key: "recambiofacil",
    allowsManualUrl: true,
    name: "Recambiofácil",
    vendor: "Recambiofácil",
    kinds: ["offers_new"],
    mode: "licencia",
    implemented: false,
    multiInstance: false,
    description: "Plataforma de compra de recambio nuevo. No se ha publicado una API abierta: la integración requiere acuerdo comercial.",
    requirements: ["Acuerdo con Recambiofácil para acceso a API o envío periódico de tarifa (CSV/Excel)"],
    credentialFields: [
      { key: "usuario", label: "Usuario", secret: false },
      { key: "token", label: "Token / clave", secret: true },
    ],
  },
  {
    key: "plan-parts",
    allowsManualUrl: true,
    name: "plan.parts",
    vendor: "plan.parts",
    kinds: ["vehicle", "oem"],
    mode: "licencia",
    implemented: false,
    multiInstance: false,
    description: "Catálogos electrónicos de piezas originales por VIN. Integración sujeta a contrato y documentación del proveedor.",
    requirements: ["Contrato con plan.parts y documentación de su API"],
    credentialFields: [{ key: "api_key", label: "API key", secret: true }],
  },
  {
    key: "autowiz",
    allowsManualUrl: true,
    name: "AutoWiz",
    vendor: "AutoWiz",
    kinds: ["vehicle", "oem"],
    mode: "licencia",
    implemented: false,
    multiInstance: false,
    description: "Identificación de vehículo y despiece. Integración sujeta a contrato y documentación del proveedor.",
    requirements: ["Contrato con AutoWiz y documentación de su API"],
    credentialFields: [{ key: "api_key", label: "API key", secret: true }],
  },
  {
    key: "matricula-dgt",
    name: "Identificación por matrícula",
    vendor: "Proveedor autorizado (pendiente de elegir)",
    kinds: ["vehicle"],
    mode: "licencia",
    implemented: false,
    multiInstance: false,
    description:
      "La DGT no ofrece una API pública de matrícula → bastidor. Esta información solo está disponible mediante proveedores autorizados (servicios de catálogo profesionales). Mientras no haya uno contratado, la matrícula se resuelve con los vehículos ya registrados en AUTORECA IA.",
    requirements: ["Contrato con un proveedor autorizado de identificación por matrícula y su documentación de API"],
    credentialFields: [{ key: "api_key", label: "API key", secret: true }],
  },
];

export const CONNECTOR_BY_KEY = new Map(CONNECTORS.map((c) => [c.key, c]));

export async function logConnector(connectorKey: string, sourceId: string | null, level: "info" | "warn" | "error", message: string, details?: unknown) {
  await query(`INSERT INTO connector_logs (source_id, connector_key, level, message, details) VALUES ($1,$2,$3,$4,$5)`, [
    sourceId, connectorKey, level, message, details ? JSON.stringify(details) : null,
  ]).catch(() => {});
}

export function readCreds(enc: string | null): Record<string, string> {
  if (!enc) return {};
  try {
    return JSON.parse(decrypt(enc));
  } catch {
    return {};
  }
}

/** Crea las filas de configuración de los conectores de instancia única. */
export async function ensureConnectorRows() {
  for (const c of CONNECTORS) {
    if (c.multiInstance || c.key === "inventario") continue;
    if (c.key === "manual") {
      for (const kind of ["oem", "iam"] as const) {
        await query(
          `INSERT INTO data_sources (connector_key, name, data_kind, status, enabled)
           SELECT 'manual', $1, $2, 'activo', true
           WHERE NOT EXISTS (SELECT 1 FROM data_sources WHERE connector_key='manual' AND data_kind=$2)`,
          [kind === "oem" ? "Referencias OEM registradas manualmente" : "Equivalencias registradas manualmente", kind],
        );
      }
      continue;
    }
    await query(
      `INSERT INTO data_sources (connector_key, name, data_kind, status, enabled)
       SELECT $1, $2, $3, 'no_conectado', false
       WHERE NOT EXISTS (SELECT 1 FROM data_sources WHERE connector_key=$1)`,
      [c.key, c.name, c.kinds[0]],
    );
  }
}

export async function manualSourceId(kind: "oem" | "iam"): Promise<string> {
  const r = await query("SELECT id FROM data_sources WHERE connector_key='manual' AND data_kind=$1", [kind]);
  if (r.rows[0]) return r.rows[0].id;
  await ensureConnectorRows();
  return (await query("SELECT id FROM data_sources WHERE connector_key='manual' AND data_kind=$1", [kind])).rows[0].id;
}
