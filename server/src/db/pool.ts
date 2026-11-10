import pg from "pg";
import { config } from "../config.js";

// NUMERIC -> number (los importes se redondean a 2 decimales en la capa de servicio)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// BIGINT (count) -> number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Queryable = Pick<pg.PoolClient, "query">;

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params as any[]);
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const r = await pool.query<T>(text, params as any[]);
  return r.rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
