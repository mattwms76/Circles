import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createCorsMiddleware } from "./cors";
import { clearLegacySessionCookie } from "./cookies";
import { checkBackendReadiness } from "./readiness";

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(createCorsMiddleware());
  app.use(clearLegacySessionCookie());

  // The encrypted social upload is the only current JSON transport that needs more than a
  // small request body. Keeping its allowance route-scoped prevents unauthenticated callers
  // from making unrelated API endpoints pre-buffer 50 MiB before tRPC authentication.
  app.use("/api/trpc/social.upload", express.json({ limit: "30mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: false }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get("/api/ready", async (_req, res) => {
    const status = await checkBackendReadiness();
    res.setHeader("Cache-Control", "no-store");
    res.status(status.ok ? 200 : 503).json(status);
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const port = parseInt(process.env.PORT || "3000");
  server.listen(port, () => {
    console.log("[api] server listening");
  });
}

startServer().catch(() => {
  console.error("[api] server failed to start");
  process.exitCode = 1;
});
