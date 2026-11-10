export type Role = "admin" | "worker";
export interface User { id: string; email: string; name: string; role: Role }

export type CompatStatus = "confirmada" | "pendiente" | "no_compatible";
export interface Compat { status: CompatStatus; matched: string[]; conflicts: string[]; missing: string[]; evidence: string[] }

export interface Supplier { id: string; name: string; phone: string | null; email: string | null; website: string | null; location: string | null }

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
  supplier: Supplier | null;
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

export interface Vehicle {
  id: string; plate: string | null; vin: string | null; make: string | null; model: string | null; generation: string | null; year: number | null;
  version: string | null; engine: string | null; engine_code: string | null; displacement_cc: number | null; power_kw: number | null; fuel: string | null;
  transmission: string | null; identification_source: string | null; identification_level: "confirmada" | "parcial"; notes?: string | null;
}

export interface PartInterpretation {
  input: string; code: string | null; name: string | null; category: string | null; side: string | null; axle: string | null; confidence: number;
  method: string; correctedFrom?: string; alternatives: { code: string; name: string }[]; missing: string[]; notes: string[]; source: string;
}

export interface StepSource { name: string; status: "consultado" | "no_conectado" | "sin_datos" | "error" | "desactivado"; matches?: number; detail?: string }
export interface Step { key: string; label: string; status: "ok" | "parcial" | "requiere_accion" | "sin_resultados" | "omitido" | "error"; detail: string; sources: StepSource[] }

export interface Clarification {
  message: string;
  missing: string[];
  candidates: { model: string | null; generation: string | null; year_from: number | null; year_to: number | null; engine_codes: string[]; fuel: string | null; power_kw_from: number | null; power_kw_to: number | null }[];
  canCreateFromPlate?: string;
}

export interface SearchResponse {
  id: string | null;
  status: "completado" | "sin_resultados" | "requiere_vehiculo" | "requiere_pieza";
  vehicle: Vehicle | null;
  vehicleQueryKind: string | null;
  clarification: Clarification | null;
  part: PartInterpretation | null;
  oemRefs: string[];
  steps: Step[];
  results: { oem: ResultItem[]; iam: ResultItem[]; cat: ResultItem[] };
  durationMs: number;
  createdAt: string;
  fromHistory?: boolean;
}

export interface PartType { code: string; name: string; category: string; sided: boolean; axle: boolean; specs: { key: string; label: string; unit?: string }[] }
