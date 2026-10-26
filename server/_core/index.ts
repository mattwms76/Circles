import express, { type ErrorRequestHandler } from "express";
import { createServer, type Server } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerEmailAuthRoutes } from "./email-auth";
import { EMAIL_AUTH_REQUEST_REJECTION } from "./email-auth-response";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createCorsMiddleware } from "./cors";
import { clearLegacySessionCookie } from "./cookies";
import { checkBackendReadiness } from "./readiness";
import { closePostgresPool } from "../db";
import { withOperationDeadline } from "./bounded-network";

export const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

function assertTrustedProductionRuntime(): void {
  if (process.env.NODE_ENV !== "production") return;
  const required = [
    "MANUS_PROJECT_ID",
    "MANUS_JWT_SECRET",
    "MANUS_OAUTH_API_URL",
    "MANUS_OAUTH_PORTAL_URL",
    "SUPABASE_DATABASE_URL",
  ];
  if (required.some((name) => !process.env[name]) || process.env.DATABASE_URL) {
    throw new Error("Trusted production runtime configuration is unavailable");
  }
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

export type GracefulShutdownOptions = {
  closePool?: () => Promise<void>;
  exit?: (code: number) => void;
  drainTimeoutMs?: number;
};

/** Stops acceptance first, then bounds HTTP drain and restricted-pool closure exactly once. */
export function createGracefulShutdown(
  server: Server,
  options: GracefulShutdownOptions = {},
): () => Promise<void> {
  let shutdown: Promise<void> | null = null;
  const timeoutMs = options.drainTimeoutMs ?? SHUTDOWN_DRAIN_TIMEOUT_MS;
  const closePool = options.closePool ?? closePostgresPool;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  return () => {
    if (shutdown) return shutdown;
    shutdown = (async () => {
      try {
        await withOperationDeadline(closeHttpServer(server), timeoutMs);
      } catch {
        server.closeAllConnections?.();
      }
      try {
        await withOperationDeadline(closePool(), timeoutMs);
      } catch {
        // The process exits after the bounded drain; no subsequent restart is attempted here.
      }
      exit(0);
    })();
    return shutdown;
  };
}

export function installGracefulShutdown(server: Server): () => void {
  const shutdown = createGracefulShutdown(server);
  const onSignal = () => {
    void shutdown();
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  return () => {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  };
}

export function createApiServer() {
  const app = express();
  const server = createServer(app);

  app.use(createCorsMiddleware());
  app.use(clearLegacySessionCookie());

  // The encrypted social upload is the only current JSON transport that needs more than a
  // small request body. Keeping its allowance route-scoped prevents unauthenticated callers
  // from making unrelated API endpoints pre-buffer 50 MiB before tRPC authentication.
  app.use("/api/trpc/social.upload", express.json({ limit: "30mb" }));
  app.use("/api/auth/email", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "POST" && !req.is("application/json")) {
      res.status(415).json(EMAIL_AUTH_REQUEST_REJECTION);
      return;
    }
    next();
  });
  app.use("/api/auth/email", express.json({ limit: "4kb" }));
  const emailBodyFailure: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    next,
  ) => {
    const kind =
      error !== null && typeof error === "object" && "type" in error
        ? error.type
        : undefined;
    if (
      typeof kind === "string" &&
      [
        "entity.parse.failed",
        "entity.too.large",
        "charset.unsupported",
        "encoding.unsupported",
        "request.size.invalid",
        "request.aborted",
      ].includes(kind)
    ) {
      res.setHeader("Cache-Control", "no-store");
      res
        .status(kind === "entity.too.large" ? 413 : 400)
        .json(EMAIL_AUTH_REQUEST_REJECTION);
      return;
    }
    next(error);
  };
  app.use("/api/auth/email", emailBodyFailure);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: false }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerEmailAuthRoutes(app);

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

  return { app, server };
}

export async function startServer() {
  assertTrustedProductionRuntime();
  const { server } = createApiServer();
  const port = parseInt(process.env.PORT || "3000", 10);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
  installGracefulShutdown(server);
  console.log("[api] server listening");
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  void startServer().catch(() => {
    console.error("[api] server failed to start");
    process.exitCode = 1;
  });
}
