import { mkdir } from "node:fs/promises";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { ensureConnectorRows } from "./connectors/registry.js";
import { migrate } from "./db/migrate.js";
import { pool, query } from "./db/pool.js";

async function main() {
  await migrate();
  await ensureConnectorRows();
  await mkdir(config.uploadsDir, { recursive: true }).catch(() => {}); // solo para fotos antiguas en disco
  // Limpieza periódica de sesiones y enlaces caducados
  setInterval(() => {
    query(`DELETE FROM sessions WHERE expires_at < now()`).catch(() => {});
    query(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`).catch(() => {});
  }, 3600_000).unref();
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`AUTORECA IA escuchando en http://localhost:${config.port}`));
  const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
