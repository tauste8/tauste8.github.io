import { randomBytes } from "node:crypto";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Falta la variable de entorno obligatoria ${name}`);
  }
  return v;
}

const isProd = process.env.NODE_ENV === "production";

/**
 * Dirección de PostgreSQL. Acepta DATABASE_URL y los nombres alternativos que usan algunos
 * proveedores, o las variables sueltas PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT.
 * En producción, si no hay ninguna, se detiene con un mensaje claro.
 */
function resolveDatabaseUrl(): string {
  for (const k of ["DATABASE_URL", "DATABASE_PRIVATE_URL", "POSTGRES_URL", "POSTGRESQL_URL"]) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (PGHOST && PGUSER) {
    const auth = encodeURIComponent(PGUSER) + (PGPASSWORD ? ":" + encodeURIComponent(PGPASSWORD) : "");
    return `postgres://${auth}@${PGHOST}:${PGPORT || "5432"}/${encodeURIComponent(PGDATABASE || PGUSER)}`;
  }
  if (isProd) {
    throw new Error(
      "Falta la conexión a la base de datos: defina DATABASE_URL (o PGHOST, PGUSER, PGPASSWORD, PGDATABASE). " +
        `Variables de base de datos presentes: ${Object.keys(process.env).filter((k) => /^(PG|DATABASE|POSTGRES)/.test(k)).join(", ") || "ninguna"}`,
    );
  }
  return "postgres://postgres@127.0.0.1:5432/autoreca";
}

// En producción la clave de cifrado es obligatoria: sin ella no se podrían descifrar
// las credenciales de integraciones tras un reinicio.
const encryptionKey = isProd
  ? env("APP_ENCRYPTION_KEY")
  : process.env.APP_ENCRYPTION_KEY || randomBytes(32).toString("hex");

export const config = {
  isProd,
  port: Number(env("PORT", "3000")),
  databaseUrl: resolveDatabaseUrl(),
  encryptionKey,
  // Render define RENDER_EXTERNAL_URL automáticamente
  // Railway define RAILWAY_PUBLIC_DOMAIN
  publicUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:3000"),
  uploadsDir: env("UPLOADS_DIR", "./data/uploads"),
  sessionDays: Number(env("SESSION_DAYS", "7")),
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || "587"),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "AUTORECA IA <no-reply@localhost>",
  },
  anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  aiModel: process.env.AI_MODEL || "claude-opus-5-5",
  webDist: env("WEB_DIST", "../web/dist"),
  trustProxy: process.env.TRUST_PROXY === "1",
};
