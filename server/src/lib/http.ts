import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = "Recurso") => new HttpError(404, `${what} no encontrado`);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(
      400,
      "Datos no válidos",
      r.error.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message })),
    );
  }
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Datos no válidos", details: err.issues });
    return;
  }
  const pgErr = err as { code?: string; detail?: string; constraint?: string };
  if (pgErr?.code === "23505") {
    res.status(409).json({ error: "Ya existe un registro con esos datos", details: pgErr.detail });
    return;
  }
  if (pgErr?.code === "23503") {
    res.status(409).json({ error: "El registro está relacionado con otros datos", details: pgErr.detail });
    return;
  }
  const multerErr = err as { name?: string; message?: string };
  if (multerErr?.name === "MulterError") {
    res.status(400).json({ error: `Archivo no válido: ${multerErr.message}` });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
}
