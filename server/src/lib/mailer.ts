import nodemailer from "nodemailer";
import { config } from "../config.js";

export function mailConfigured() {
  return Boolean(config.smtp.host);
}

export async function sendMail(to: string, subject: string, text: string) {
  if (!mailConfigured()) throw new Error("El correo saliente (SMTP) no está configurado");
  const t = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  await t.sendMail({ from: config.smtp.from, to, subject, text });
}
