import type { Request } from "express";
import { query } from "../db/pool.js";

export async function audit(
  req: Request | null,
  action: string,
  entity?: string,
  entityId?: string | null,
  details?: unknown,
  userId?: string | null,
) {
  await query(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId ?? req?.user?.id ?? null, action, entity ?? null, entityId ?? null, details ? JSON.stringify(details) : null, req?.ip ?? null],
  ).catch((e) => console.error("[audit]", e));
}
