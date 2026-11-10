import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { one, query } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound, parse } from "../lib/http.js";
import { requireAdmin } from "../middleware/auth.js";
import { createResetToken, passwordSchema } from "./auth.js";

export const router = Router();
router.use(requireAdmin);

router.get("/", async (_req, res) => {
  const r = await query(`SELECT id, email, name, role, active, last_login_at, created_at FROM users ORDER BY name`);
  res.json(r.rows);
});

router.post("/", async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(100), email: z.email().max(200), role: z.enum(["admin", "worker"]), password: passwordSchema }), req.body);
  const u = await one(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role, active`, [
    b.email.toLowerCase(), b.name, await bcrypt.hash(b.password, 12), b.role,
  ]);
  await audit(req, "usuario.alta", "user", u.id, { email: u.email, role: u.role });
  res.status(201).json(u);
});

router.patch("/:id", async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(100).optional(), role: z.enum(["admin", "worker"]).optional(), active: z.boolean().optional() }), req.body);
  const id = String(req.params.id);
  if (id === req.user!.id && (b.role === "worker" || b.active === false)) throw new HttpError(400, "No puede quitarse a sí mismo los permisos de administrador ni desactivarse");
  const u = await one(
    `UPDATE users SET name=COALESCE($2,name), role=COALESCE($3,role), active=COALESCE($4,active), updated_at=now() WHERE id=$1 RETURNING id, email, name, role, active`,
    [id, b.name ?? null, b.role ?? null, b.active ?? null],
  );
  if (!u) throw notFound("Usuario");
  if (b.active === false) await query(`DELETE FROM sessions WHERE user_id=$1`, [id]);
  await audit(req, "usuario.modificacion", "user", id, b);
  res.json(u);
});

router.post("/:id/reset-link", async (req, res) => {
  const u = await one(`SELECT id FROM users WHERE id=$1`, [String(req.params.id)]);
  if (!u) throw notFound("Usuario");
  const url = await createResetToken(u.id);
  await audit(req, "usuario.enlace_reset", "user", u.id);
  res.json({ url, expiresInMinutes: 60 });
});

router.get("/audit", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const r = await query(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.ip, a.created_at, u.name AS user_name
     FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT $1`, [limit]);
  res.json(r.rows);
});
