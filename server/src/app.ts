import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { errorHandler, HttpError } from "./lib/http.js";
import { csrfGuard, loadUser, requireAuth } from "./middleware/auth.js";
import { router as authRouter } from "./routes/auth.js";
import { router as catalogRouter } from "./routes/catalog.js";
import { customers, suppliers } from "./routes/crm.js";
import { router as integrationsRouter } from "./routes/integrations.js";
import { router as inventoryRouter } from "./routes/inventory.js";
import { files, history, settings, stats } from "./routes/misc.js";
import { orders, quotes } from "./routes/sales.js";
import { router as searchRouter } from "./routes/search.js";
import { router as usersRouter } from "./routes/users.js";
import { router as vehiclesRouter } from "./routes/vehicles.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(loadUser);

  const api = express.Router();
  api.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  });
  api.use(csrfGuard);
  api.use("/auth", authRouter);
  api.use(requireAuth);
  api.use("/users", usersRouter);
  api.use("/search", searchRouter);
  api.use("/vehicles", vehiclesRouter);
  api.use("/inventory", inventoryRouter);
  api.use("/catalog", catalogRouter);
  api.use("/customers", customers);
  api.use("/suppliers", suppliers);
  api.use("/quotes", quotes);
  api.use("/orders", orders);
  api.use("/history", history);
  api.use("/stats", stats);
  api.use("/integrations", integrationsRouter);
  api.use("/settings", settings);
  api.use("/files", files);
  api.use((_req, _res, next) => next(new HttpError(404, "Ruta de API no encontrada")));
  app.use("/api", api);

  // Frontend compilado (SPA)
  const dist = path.resolve(config.webDist);
  if (existsSync(dist)) {
    app.use(express.static(dist, {
      index: false,
      setHeaders: (res, file) => {
        if (file.endsWith("sw.js") || file.endsWith(".webmanifest") || file.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(dist, "index.html"));
    });
  }
  app.use(errorHandler);
  return app;
}
