import { query } from "../db/pool.js";

export interface CompanySettings {
  name: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  defaultVat: number;
  defaultMargin: number;
  quoteValidityDays: number;
  quoteFooter: string;
}

export const defaultCompany: CompanySettings = {
  name: "",
  taxId: "",
  address: "",
  phone: "",
  email: "",
  defaultVat: 21,
  defaultMargin: 30,
  quoteValidityDays: 15,
  quoteFooter: "",
};

export async function getCompany(): Promise<CompanySettings> {
  const r = await query("SELECT value FROM settings WHERE key='company'");
  return { ...defaultCompany, ...(r.rows[0]?.value ?? {}) };
}

export async function setCompany(v: CompanySettings) {
  await query(
    `INSERT INTO settings(key, value, updated_at) VALUES ('company', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(v)],
  );
}
