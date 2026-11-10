import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(log = true) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const dir = path.join(here, "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        if (log) console.log(`[migrate] aplicada ${f}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => {});
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
