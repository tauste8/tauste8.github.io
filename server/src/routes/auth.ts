import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { one, query } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { HttpError, parse } from "../lib/http.js";
import { mailConfigured, sendMail } from "../lib/mailer.js";
import { createSession, destroySession, requireAuth } from "../middleware/auth.js";

export const router = Router();

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Demasiados intentos. Espere unos minutos." } });

export const passwordSchema = z.string().min(10, "La contraseña debe tener al menos 10 caracteres").max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "La contraseña debe contener letras y números");

router.get("/status", async (req, res) => {
  const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM users");
  res.json({ needsSetup: (n?.n ?? 0) === 0, user: req.user ?? null, mailConfigured: mailConfigured() });
});

router.post("/setup", limiter, async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(100), email: z.email().max(200), password: passwordSchema }), req.body);
  const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM users");
  if ((n?.n ?? 0) > 0) throw new HttpError(409, "La aplicación ya está configurada");
  const hash = await bcrypt.hash(b.password, 12);
  const u = await one(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'admin') RETURNING id`, [b.email.toLowerCase(), b.name, hash]);
  await createSession(res, req, u.id);
  await audit(req, "usuario.alta_inicial", "user", u.id, { email: b.email }, u.id);
  res.status(201).json({ ok: true });
});

router.post("/login", limiter, async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().max(200), password: z.string().max(200) }), req.body);
  const u = await one(`SELECT * FROM users WHERE email=$1`, [b.email.toLowerCase()]);
  const fail = () => new HttpError(401, "Correo o contraseña incorrectos");
  if (!u || !u.active) {
    await bcrypt.compare(b.password, "$2a$12$abcdefghijklmnopqrstuuMqVYyN/xbQ0E1wQX2Yp2xU7m3q8W4Kq"); // tiempo constante
    throw fail();
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, "Cuenta bloqueada temporalmente por intentos fallidos. Inténtelo en 15 minutos.");
  if (!(await bcrypt.compare(b.password, u.password_hash))) {
    const attempts = u.failed_logins + 1;
    await query(`UPDATE users SET failed_logins=$2, locked_until = CASE WHEN $2 >= 5 THEN now() + interval '15 minutes' ELSE NULL END WHERE id=$1`, [u.id, attempts >= 5 ? 0 : attempts]);
    await audit(req, "sesion.fallo", "user", u.id, null, u.id);
    throw fail();
  }
  await query(`UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=now() WHERE id=$1`, [u.id]);
  await createSession(res, req, u.id);
  await audit(req, "sesion.inicio", "user", u.id, null, u.id);
  res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } });
});

router.post("/logout", async (req, res) => {
  if (req.user) await audit(req, "sesion.cierre", "user", req.user.id);
  await destroySession(req, res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

router.post("/change-password", requireAuth, async (req, res) => {
  const b = parse(z.object({ current: z.string(), password: passwordSchema }), req.body);
  const u = await one(`SELECT password_hash FROM users WHERE id=$1`, [req.user!.id]);
  if (!(await bcrypt.compare(b.current, u.password_hash))) throw new HttpError(400, "La contraseña actual no es correcta");
  await query(`UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1`, [req.user!.id, await bcrypt.hash(b.password, 12)]);
  await query(`DELETE FROM sessions WHERE user_id=$1 AND id<>$2`, [req.user!.id, req.user!.sessionId]);
  await audit(req, "usuario.cambio_contrasena", "user", req.user!.id);
  res.json({ ok: true });
});

export async function createResetToken(userId: string) {
  const token = randomToken(32);
  await query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '1 hour')`, [sha256(token), userId]);
  return `${config.publicUrl.replace(/\/$/, "")}/restablecer?token=${token}`;
}

router.post("/forgot", limiter, async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().max(200) }), req.body);
  const u = await one(`SELECT id, email, name FROM users WHERE email=$1 AND active`, [b.email.toLowerCase()]);
  if (u && mailConfigured()) {
    const link = await createResetToken(u.id);
    try {
      await sendMail(u.email, "AUTORECA IA — Restablecer contraseña",
        `Hola ${u.name},\n\nPara crear una nueva contraseña abra este enlace (válido 1 hora):\n${link}\n\nSi no lo ha solicitado, ignore este mensaje.`);
      await audit(req, "usuario.solicitud_reset", "user", u.id, null, u.id);
    } catch (e) {
      console.error("[mail]", e);
    }
  }
  res.json({
    ok: true,
    message: mailConfigured()
      ? "Si el correo está registrado, recibirá un enlace para restablecer la contraseña."
      : "El envío de correo no está configurado. Pida a un administrador que genere un enlace de restablecimiento desde Configuración → Usuarios.",
  });
});

router.post("/reset", limiter, async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
  const r = await one(`SELECT * FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()`, [sha256(b.token)]);
  if (!r) throw new HttpError(400, "El enlace no es válido o ha caducado");
  await query(`UPDATE users SET password_hash=$2, failed_logins=0, locked_until=NULL, updated_at=now() WHERE id=$1`, [r.user_id, await bcrypt.hash(b.password, 12)]);
  await query(`UPDATE password_resets SET used_at=now() WHERE token_hash=$1`, [r.token_hash]);
  await query(`DELETE FROM sessions WHERE user_id=$1`, [r.user_id]);
  await audit(req, "usuario.reset_contrasena", "user", r.user_id, null, r.user_id);
  res.json({ ok: true });
});

router.get("/sessions", requireAuth, async (req, res) => {
  const r = await query(`SELECT id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id=$1 AND expires_at > now() ORDER BY last_seen_at DESC`, [req.user!.id]);
  res.json(r.rows.map((s) => ({ ...s, id: s.id.slice(0, 12), current: s.id === req.user!.sessionId })));
});

router.delete("/sessions/:prefix", requireAuth, async (req, res) => {
  const prefix = String(req.params.prefix);
  if (!/^[a-f0-9]{12}$/.test(prefix)) throw new HttpError(400, "Identificador no válido");
  await query(`DELETE FROM sessions WHERE user_id=$1 AND left(id,12)=$2 AND id<>$3`, [req.user!.id, prefix, req.user!.sessionId]);
  res.json({ ok: true });
});
