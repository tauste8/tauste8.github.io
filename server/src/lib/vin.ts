/**
 * Utilidades de identificación de vehículos sin servicios externos.
 *
 * - El VIN (ISO 3779) tiene 17 caracteres sin I, O ni Q. Los tres primeros (WMI) identifican
 *   al fabricante. Esa es la única información que se puede obtener del VIN de forma fiable
 *   sin un catálogo del fabricante: modelo, motor y versión NO se deducen aquí.
 * - La posición 10 codifica el año-modelo en vehículos norteamericanos; en vehículos europeos
 *   no es obligatoria, así que solo se muestra como indicio.
 */

export type VehicleQueryKind = "vin" | "matricula" | "desconocido";

const PLATE_PATTERNS: RegExp[] = [
  /^[0-9]{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/, // Sistema actual (2000-): 1234BCD
  /^[A-Z]{1,2}[0-9]{4}[A-Z]{1,2}$/, // Provincial (1971-2000): M1234AB
  /^[A-Z]{1,2}[0-9]{1,6}$/, // Provincial antiguo: M123456
  /^E[0-9]{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/, // Especial (vehículos especiales)
  /^[A-Z][0-9]{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/, // Ciclomotores / temporales con prefijo
];

export function normalizeVehicleQuery(q: string): string {
  return q.toUpperCase().replace(/[\s\-.]/g, "");
}

export function classifyVehicleQuery(raw: string): VehicleQueryKind {
  const q = normalizeVehicleQuery(raw);
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(q)) return "vin";
  if (PLATE_PATTERNS.some((r) => r.test(q))) return "matricula";
  return "desconocido";
}

/** WMI → fabricante. Lista de códigos públicos (SAE / ISO 3780) de las marcas más comunes en España. */
const WMI: Record<string, string> = {
  WVW: "Volkswagen", WV1: "Volkswagen (comerciales)", WV2: "Volkswagen (comerciales)", WVG: "Volkswagen (SUV)",
  WAU: "Audi", WUA: "Audi (quattro GmbH)", TRU: "Audi (Hungría)",
  VSS: "SEAT", VSE: "SEAT",
  TMB: "Škoda",
  WBA: "BMW", WBS: "BMW M", WBY: "BMW i", WMW: "MINI",
  WDD: "Mercedes-Benz", WDB: "Mercedes-Benz", WDC: "Mercedes-Benz (SUV)", WDF: "Mercedes-Benz (comerciales)", W1K: "Mercedes-Benz", W1N: "Mercedes-Benz (SUV)", W1V: "Mercedes-Benz (comerciales)",
  WP0: "Porsche", WP1: "Porsche (SUV)",
  W0L: "Opel", W0V: "Opel", VXK: "Opel",
  WF0: "Ford (Alemania)", WF1: "Ford (Alemania)",
  VF1: "Renault", VF6: "Renault (vehículos industriales)", VF2: "Renault",
  VF3: "Peugeot", VR3: "Peugeot",
  VF7: "Citroën", VR7: "Citroën",
  VR1: "DS Automobiles",
  UU1: "Dacia",
  ZFA: "Fiat", ZFC: "Fiat (comerciales)", ZAR: "Alfa Romeo", ZLA: "Lancia", ZAP: "Piaggio",
  ZFF: "Ferrari",
  SAL: "Land Rover", SAJ: "Jaguar", SCC: "Lotus",
  SJN: "Nissan (Reino Unido)", VSK: "Nissan (España)", JN1: "Nissan", JN8: "Nissan (SUV)",
  SB1: "Toyota (Reino Unido)", VNK: "Toyota (Francia)", JTD: "Toyota", JTE: "Toyota", JTN: "Toyota", NMT: "Toyota (Turquía)",
  JHM: "Honda", SHH: "Honda (Reino Unido)", SHS: "Honda (Reino Unido)",
  JMZ: "Mazda", JM1: "Mazda",
  JMB: "Mitsubishi", JA3: "Mitsubishi",
  JSA: "Suzuki", TSM: "Suzuki (Hungría)",
  JF1: "Subaru",
  KMH: "Hyundai", TMA: "Hyundai (Chequia)", NLH: "Hyundai (Turquía)",
  KNA: "Kia", KNE: "Kia", U5Y: "Kia (Eslovaquia)", U6Y: "Kia (Eslovaquia)",
  YV1: "Volvo", YV4: "Volvo (SUV)", YS3: "Saab",
  "5YJ": "Tesla", LRW: "Tesla (China)", XP7: "Tesla (Alemania)",
  "1FA": "Ford (EE. UU.)", "1G1": "Chevrolet (EE. UU.)", "1J4": "Jeep", "1C4": "Chrysler / Jeep",
  KL1: "Chevrolet / Daewoo", KLA: "Daewoo",
  LSJ: "MG (SAIC)", SFD: "Alexander Dennis",
  VSA: "Mercedes-Benz (España)",
};

const YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";

export interface VinInfo {
  vin: string;
  wmi: string;
  manufacturer: string | null;
  checkDigitValid: boolean | null;
  /** Posibles años-modelo según la posición 10 (ciclo de 30 años). Solo orientativo. */
  possibleModelYears: number[];
}

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function checkDigit(vin: string): boolean {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const v = /[0-9]/.test(c) ? Number(c) : TRANSLIT[c];
    sum += v * WEIGHTS[i];
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? "X" : String(r));
}

export function decodeVinLocally(raw: string): VinInfo {
  const vin = normalizeVehicleQuery(raw);
  const wmi = vin.slice(0, 3);
  const manufacturer = WMI[wmi] ?? null;
  // El dígito de control solo es obligatorio en Norteamérica
  const naRegion = /^[1-5]/.test(vin);
  const yc = vin[9];
  const idx = YEAR_CODES.indexOf(yc);
  const possibleModelYears: number[] = [];
  if (idx >= 0) {
    const now = new Date().getFullYear() + 1;
    for (let y = 1980 + idx; y <= now; y += 30) possibleModelYears.push(y);
  }
  return { vin, wmi, manufacturer, checkDigitValid: naRegion ? checkDigit(vin) : null, possibleModelYears };
}

/** Marca "comercial" a partir del texto del WMI (sin el país). */
export function makeFromManufacturer(m: string | null): string | null {
  if (!m) return null;
  return m.replace(/\s*\(.*\)\s*/g, "").trim();
}
