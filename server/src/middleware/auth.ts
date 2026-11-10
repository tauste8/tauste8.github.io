import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { HttpError } from "../lib/http.js";

export interface AuthUser { id: string; email: string; name: string; role: "admin" | "worker"; sessionId: string }

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export const COOKIE = "ar_session";

export async function createSession(res: Response, req: Request, userId: string) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  await query(`INSERT INTO sessions (id, user_id, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)`, [
    sha256(token), userId, req.ip ?? null, (req.headers["user-agent"] ?? "").slice(0, 300), expires,
  ]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.isProd, expires, path: "/" });
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE];
  if (token) await query("DELETE FROM sessions WHERE id=$1", [sha256(token)]);
  res.clearCookie(COOKIE, { path: "/" });
}

/** Carga el usuario de la sesión (si existe). */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const id = sha256(token);
    const r = await query(
      `SELECT s.id AS sid, s.last_seen_at, u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.expires_at > now() AND u.active`,
      [id],
    );
    const row = r.rows[0];
    if (row) {
      req.user = { id: row.id, email: row.email, name: row.name, role: row.role, sessionId: row.sid };
      if (Date.now() - new Date(row.last_seen_at).getTime() > 3600_000) {
        await query(`UPDATE sessions SET last_seen_at=now(), expires_at=now() + ($2 || ' days')::interval WHERE id=$1`, [id, String(config.sessionDays)]);
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Sesión no iniciada o caducada"));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Sesión no iniciada o caducada"));
  if (req.user.role !== "admin") return next(new HttpError(403, "Esta acción requiere permisos de administrador"));
  next();
}

/**
 * Protección CSRF: toda petición que modifica datos debe llevar la cabecera X-Requested-With.
 * Un formulario de otro sitio no puede añadirla sin una petición CORS previa, que el servidor no permite.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.headers["x-requested-with"] !== "autoreca") return next(new HttpError(403, "Petición rechazada (CSRF)"));
  next();
}
