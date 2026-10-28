import { pathToFileURL } from "node:url";
import express, {
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { createServer, type Server } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerEmailAuthRoutes } from "./email-auth";
import { EMAIL_AUTH_REQUEST_REJECTION } from "./email-auth-response";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createCorsMiddleware } from "./cors";
import { clearLegacySessionCookie, isSecureRequest } from "./cookies";
import { checkBackendReadiness } from "./readiness";
import { closePostgresPool } from "../db";
import { withOperationDeadline } from "./bounded-network";
import { assertCanonicalOAuthProviderConfiguration } from "./env";
import {
  configuredTrustedProxyPolicy,
  previewLimiterIdentityFromRequest,
} from "./runtimeSecurity";

export const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;
export const API_MAX_URI_BYTES = 8 * 1024;
export const API_MAX_HEADER_BYTES = 16 * 1024;
export const API_MAX_HEADER_COUNT = 100;
export const API_MAX_CREDENTIAL_HEADER_BYTES = 8 * 1024;
export const API_STANDARD_BODY_BYTES = 1 * 1024 * 1024;
export const API_URLENCODED_BODY_BYTES = 64 * 1024;
// The encrypted 20 MiB media payload is JSON/base64 encoded before it reaches this route.
export const API_SOCIAL_UPLOAD_BODY_BYTES = 30 * 1024 * 1024;
export const API_EMAIL_AUTH_BODY_BYTES = 4 * 1024;
export const API_HEADERS_TIMEOUT_MS = 15_000;
export const API_REQUEST_TIMEOUT_MS = 60_000;
export const API_SOCKET_IDLE_TIMEOUT_MS = 65_000;
export const API_KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const API_MAX_CONCURRENT_REQUESTS = 100;
export const API_MAX_CONCURRENT_PER_CLIENT = 12;
export const API_MAX_SOCIAL_UPLOADS = 4;
export const API_MAX_SOCIAL_UPLOADS_PER_CLIENT = 1;
export const API_REQUESTS_PER_MINUTE = 120;
export const API_SOCIAL_UPLOADS_PER_MINUTE = 6;
export const API_ADMISSION_WINDOW_MS = 60_000;
export const API_ADMISSION_CLIENTS = 2_048;
export const TRPC_MAX_BATCH_SIZE = 10;

const SOCIAL_UPLOAD_PATH = "/api/trpc/social.upload";
const EMAIL_AUTH_PATH = "/api/auth/email";

type AdmissionKind = "standard" | "socialUpload";

type AdmissionBucket = {
  active: number;
  openedAt: number;
  requests: number;
};

type AdmissionClient = {
  lastSeenAt: number;
  socialUpload: AdmissionBucket;
  standard: AdmissionBucket;
};

export type TransportAdmissionResult =
  | { kind: "allowed"; release: () => void }
  | { kind: "rejected"; retryAfterSeconds: number };

function freshAdmissionBucket(now: number): AdmissionBucket {
  return { active: 0, openedAt: now, requests: 0 };
}

function resetAdmissionWindow(bucket: AdmissionBucket, now: number): void {
  if (now - bucket.openedAt >= API_ADMISSION_WINDOW_MS) {
    bucket.openedAt = now;
    bucket.requests = 0;
  }
}

/**
 * This process-local admission gate deliberately bounds only one process. It is a defense in
 * depth layer, not proof of a distributed edge rate limit; proxy/WAF enforcement remains an
 * operator gate. It allocates no timers and caps remembered client identities.
 */
export class TransportAdmission {
  private active = 0;
  private activeSocialUploads = 0;
  private readonly clients = new Map<string, AdmissionClient>();

  private prune(now: number): void {
    for (const [key, client] of this.clients) {
      if (
        client.standard.active === 0 &&
        client.socialUpload.active === 0 &&
        now - client.lastSeenAt >= API_ADMISSION_WINDOW_MS
      ) {
        this.clients.delete(key);
      }
    }
  }

  private client(identity: string, now: number): AdmissionClient | null {
    const current = this.clients.get(identity);
    if (current) return current;
    this.prune(now);
    if (this.clients.size >= API_ADMISSION_CLIENTS) return null;
    const created = {
      lastSeenAt: now,
      standard: freshAdmissionBucket(now),
      socialUpload: freshAdmissionBucket(now),
    };
    this.clients.set(identity, created);
    return created;
  }

  tryAcquire(
    identity: string,
    kind: AdmissionKind,
    now = Date.now(),
  ): TransportAdmissionResult {
    const client = this.client(identity, now);
    if (!client) return { kind: "rejected", retryAfterSeconds: 1 };

    const bucket =
      kind === "socialUpload" ? client.socialUpload : client.standard;
    const perMinuteLimit =
      kind === "socialUpload"
        ? API_SOCIAL_UPLOADS_PER_MINUTE
        : API_REQUESTS_PER_MINUTE;
    const perClientConcurrency =
      kind === "socialUpload"
        ? API_MAX_SOCIAL_UPLOADS_PER_CLIENT
        : API_MAX_CONCURRENT_PER_CLIENT;
    resetAdmissionWindow(bucket, now);
    client.lastSeenAt = now;

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.openedAt + API_ADMISSION_WINDOW_MS - now) / 1_000),
    );
    if (
      bucket.requests >= perMinuteLimit ||
      bucket.active >= perClientConcurrency ||
      this.active >= API_MAX_CONCURRENT_REQUESTS ||
      (kind === "socialUpload" &&
        this.activeSocialUploads >= API_MAX_SOCIAL_UPLOADS)
    ) {
      return { kind: "rejected", retryAfterSeconds };
    }

    bucket.requests += 1;
    bucket.active += 1;
    this.active += 1;
    if (kind === "socialUpload") this.activeSocialUploads += 1;
    let released = false;
    return {
      kind: "allowed",
      release: () => {
        if (released) return;
        released = true;
        bucket.active = Math.max(0, bucket.active - 1);
        this.active = Math.max(0, this.active - 1);
        if (kind === "socialUpload") {
          this.activeSocialUploads = Math.max(0, this.activeSocialUploads - 1);
        }
      },
    };
  }
}

function requestPath(req: Request): string {
  const raw = req.originalUrl || req.url || "";
  const query = raw.indexOf("?");
  return query === -1 ? raw : raw.slice(0, query);
}

export function apiBodyLimitForPath(path: string): number {
  if (path === SOCIAL_UPLOAD_PATH) return API_SOCIAL_UPLOAD_BODY_BYTES;
  if (path === EMAIL_AUTH_PATH || path.startsWith(`${EMAIL_AUTH_PATH}/`)) {
    return API_EMAIL_AUTH_BODY_BYTES;
  }
  return API_STANDARD_BODY_BYTES;
}

function requestHeaderBytes(req: Request): number {
  return Object.entries(req.headers).reduce((total, [name, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return (
      total +
      Buffer.byteLength(name) +
      values.reduce(
        (valueBytes, item) => valueBytes + Buffer.byteLength(item ?? ""),
        0,
      )
    );
  }, 0);
}

function hasBoundedCredentialHeaders(req: Request): boolean {
  for (const name of ["authorization", "cookie"] as const) {
    const value = req.headers[name];
    if (value === undefined) continue;
    if (
      typeof value !== "string" ||
      value.length > API_MAX_CREDENTIAL_HEADER_BYTES
    ) {
      return false;
    }
  }
  const authorization = req.headers.authorization;
  return (
    authorization === undefined ||
    (typeof authorization === "string" &&
      authorization.startsWith("Bearer ") &&
      authorization.length > "Bearer ".length)
  );
}

function declaredBodyWithinLimit(req: Request, path: string): boolean {
  const contentLength = req.headers["content-length"];
  if (contentLength === undefined) return true;
  if (typeof contentLength !== "string" || !/^\d+$/.test(contentLength)) {
    return false;
  }
  const declaredBytes = Number(contentLength);
  return (
    Number.isSafeInteger(declaredBytes) &&
    declaredBytes <= apiBodyLimitForPath(path)
  );
}

function admissionIdentity(req: Request): string {
  const previewIdentity = previewLimiterIdentityFromRequest(req);
  if (previewIdentity) return `preview:${previewIdentity}`;
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

function setRejectedRequestResponse(
  req: Request,
  res: Response,
  status: 400 | 413 | 414 | 431 | 429,
): void {
  if (requestPath(req).startsWith(EMAIL_AUTH_PATH)) {
    // Preserve the dedicated email route's generic, no-store error contract even when admission
    // rejects a declared body before its route-local JSON parser executes.
    res.setHeader("Cache-Control", "no-store");
    res.status(status).json(EMAIL_AUTH_REQUEST_REJECTION);
    return;
  }
  res.status(status).json({ error: "Request was not accepted" });
}

export function createTransportAdmissionMiddleware(
  admission = new TransportAdmission(),
): RequestHandler {
  return (req, res, next) => {
    const path = requestPath(req);
    if (req.originalUrl.length > API_MAX_URI_BYTES) {
      setRejectedRequestResponse(req, res, 414);
      return;
    }
    if (
      requestHeaderBytes(req) > API_MAX_HEADER_BYTES ||
      !hasBoundedCredentialHeaders(req)
    ) {
      setRejectedRequestResponse(req, res, 431);
      return;
    }
    if (!declaredBodyWithinLimit(req, path)) {
      setRejectedRequestResponse(req, res, 413);
      return;
    }

    const result = admission.tryAcquire(
      admissionIdentity(req),
      path === SOCIAL_UPLOAD_PATH ? "socialUpload" : "standard",
    );
    if (result.kind === "rejected") {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      setRejectedRequestResponse(req, res, 429);
      return;
    }

    let release = result.release;
    const cleanup = () => {
      release();
      release = () => undefined;
    };
    res.once("finish", cleanup);
    res.once("close", cleanup);
    req.once("aborted", cleanup);
    next();
  };
}

function apiResponseSecurityHeaders(
  req: Request,
  res: Response,
  next: () => void,
) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // tRPC and authentication responses may be account-specific even at public paths. No-store is
  // compatible with polling while preventing a shared cache from reusing a prior account response.
  res.setHeader("Cache-Control", "private, no-store");
  // HSTS is emitted only when the request has direct TLS or the explicit trusted-hop check accepts
  // the actual termination path. It is intentionally omitted for ordinary HTTP and untrusted XFP.
  if (isSecureRequest(req)) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
}

const apiBodyParserFailure: ErrorRequestHandler = (error, req, res, next) => {
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
    setRejectedRequestResponse(
      req,
      res,
      kind === "entity.too.large" ? 413 : 400,
    );
    return;
  }
  next(error);
};

export function assertTrustedProductionRuntime(): void {
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
  assertCanonicalOAuthProviderConfiguration();
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
  app.disable("x-powered-by");

  const trustedProxy = configuredTrustedProxyPolicy();
  if (trustedProxy) {
    // One immediate network hop only. The policy parser rejects broad/default and loopback CIDRs.
    app.set(
      "trust proxy",
      (address: string, index: number) =>
        index === 0 && trustedProxy.trustsAddress(address),
    );
  }

  const server = createServer({ maxHeaderSize: API_MAX_HEADER_BYTES }, app);
  server.maxHeadersCount = API_MAX_HEADER_COUNT;
  server.headersTimeout = API_HEADERS_TIMEOUT_MS;
  server.requestTimeout = API_REQUEST_TIMEOUT_MS;
  server.timeout = API_SOCKET_IDLE_TIMEOUT_MS;
  server.keepAliveTimeout = API_KEEP_ALIVE_TIMEOUT_MS;

  // Admission and response safeguards intentionally run before every body parser. The narrow
  // social-upload exception is the sole route permitted to carry encrypted 20 MiB media JSON.
  app.use("/api", apiResponseSecurityHeaders);
  app.use("/api", createTransportAdmissionMiddleware());
  app.use(createCorsMiddleware());
  app.use(clearLegacySessionCookie());

  const socialUploadJson = express.json({
    limit: API_SOCIAL_UPLOAD_BODY_BYTES,
  });
  app.use(SOCIAL_UPLOAD_PATH, (req, res, next) => {
    if (requestPath(req) !== SOCIAL_UPLOAD_PATH) {
      next();
      return;
    }
    socialUploadJson(req, res, next);
  });
  app.use("/api/auth/email", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "POST" && !req.is("application/json")) {
      res.status(415).json(EMAIL_AUTH_REQUEST_REJECTION);
      return;
    }
    next();
  });
  app.use(
    "/api/auth/email",
    express.json({ limit: API_EMAIL_AUTH_BODY_BYTES }),
  );
  const emailBodyFailure: ErrorRequestHandler = (error, _req, res, next) => {
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
  app.use(express.json({ limit: API_STANDARD_BODY_BYTES }));
  app.use(
    express.urlencoded({ limit: API_URLENCODED_BODY_BYTES, extended: false }),
  );
  app.use("/api", apiBodyParserFailure);

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerEmailAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get("/api/ready", async (_req, res) => {
    const status = await checkBackendReadiness();
    // Detailed component evidence remains in the server-only readiness helper/operator surfaces.
    // The public endpoint exposes only the aggregate needed by a simple availability probe.
    res.status(status.ok ? 200 : 503).json({ ok: status.ok });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      maxBodySize: API_STANDARD_BODY_BYTES,
      maxBatchSize: TRPC_MAX_BATCH_SIZE,
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
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void startServer().catch(() => {
    console.error("[api] server failed to start");
    process.exitCode = 1;
  });
}
