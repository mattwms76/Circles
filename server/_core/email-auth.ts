import { createHash } from "node:crypto";
import type { Express, Request, Response as ExpressResponse } from "express";
import { APPLICATION_SESSION_TTL_MS } from "../../shared/const.js";
import {
  EmailIdentityLinkRequiredError,
  EmailIdentityUnavailableError,
  emailIdentityStore,
  type EmailIdentityStore,
  type LinkedEmailIdentity,
  type VerifiedEmailIdentity,
} from "./email-identity";
import { canIssueSessionCookie, setSessionCookie } from "./cookies";
import { isLoopbackApiHost, trustedFrontendWebOrigins } from "./cors";
import {
  configuredFrontendOrigins,
  parseExactFrontendOrigin,
} from "./frontend-origins";
import { sdk } from "./sdk";

/** Exact deployment-owned Supabase Auth origin; no configurable host aliases exist. */
export const SUPABASE_AUTH_URL = "https://vvclcsqletcxzoaayqzq.supabase.co";
export const EMAIL_AUTH_TIMEOUT_MS = 8_000;
export const EMAIL_AUTH_SETTINGS_CACHE_TTL_MS = 30_000;
export const MAX_EMAIL_LENGTH = 320;
export const MAX_PASSWORD_LENGTH = 1_024;
export const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1_024;
export const MAX_EMAIL_AUTH_BODY_BYTES = 4 * 1_024;
export const EMAIL_AUTH_JSON_BODY_LIMIT = "4kb";
export const EMAIL_AUTH_ACCOUNT_THROTTLE_LIMIT = 8;
export const EMAIL_AUTH_NETWORK_THROTTLE_LIMIT = 32;
export const EMAIL_AUTH_GLOBAL_THROTTLE_LIMIT = 256;
/** Historical export retained for focused callers; it is the account budget. */
export const EMAIL_AUTH_THROTTLE_LIMIT = EMAIL_AUTH_ACCOUNT_THROTTLE_LIMIT;
export const EMAIL_AUTH_THROTTLE_WINDOW_MS = 60_000;
export const EMAIL_AUTH_THROTTLE_MAX_ENTRIES = 4_096;

type EmailClient = "web" | "native";
type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type ProviderTokenResponse = {
  access_token?: unknown;
};

type ProviderUserResponse = {
  id?: unknown;
  email?: unknown;
  email_confirmed_at?: unknown;
  user_metadata?: unknown;
  identities?: unknown;
};

type ProviderSettingsResponse = {
  external?: { email?: unknown };
};

type EmailAuthConfig = {
  authUrl: string;
  publishableKey: string;
};

type EmailAuthFailureCode =
  | "INVALID_CREDENTIALS"
  | "REQUEST_NOT_ACCEPTED"
  | "RATE_LIMITED"
  | "LINK_REQUIRED"
  | "UNAVAILABLE"
  | "WEAK_PASSWORD"
  | "NOT_AUTHENTICATED";

export type EmailAuthStatus = {
  enabled: boolean;
  ready: boolean;
  emailEnabled: boolean;
  googleEnabled: false;
  confirmationRequired: true;
};

class EmailAuthRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: EmailAuthFailureCode,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "EmailAuthRouteError";
  }
}

class ProviderTransportError extends Error {
  constructor() {
    super("Provider transport unavailable");
    this.name = "ProviderTransportError";
  }
}

class ProviderCredentialError extends Error {
  constructor() {
    super("Provider credentials rejected");
    this.name = "ProviderCredentialError";
  }
}

type AuthenticatedActor = {
  id: number;
  openId: string;
  name: string | null;
  isCron?: boolean;
};

type EmailAuthSdk = {
  authenticateRequest(request: Request): Promise<AuthenticatedActor>;
  createSessionToken(
    openId: string,
    options?: { expiresInMs?: number; name?: string; userId?: number },
  ): Promise<string>;
};

type EmailAuthIdentityStore = Pick<
  EmailIdentityStore,
  "isReady" | "resolveForSignIn" | "linkToExistingUser"
>;

export type EmailAuthStatusDependencies = {
  fetchImpl?: FetchImplementation;
  identityStore?: EmailAuthIdentityStore;
  now?: () => number;
  environment?: NodeJS.ProcessEnv;
};

export type EmailAuthRouteDependencies = EmailAuthStatusDependencies & {
  sdkServer?: EmailAuthSdk;
  throttle?: EmailAuthAdmission;
};

type ProviderAvailabilityCache = {
  checkedAt: number;
  available: boolean;
};

// Cache public /settings availability only in-process. The public key is never in
// a cache value or response, and each fetch implementation has its own test seam.
const providerAvailabilityCache = new Map<
  FetchImplementation,
  Map<string, ProviderAvailabilityCache>
>();

function configuredEmailAuth(
  environment: NodeJS.ProcessEnv = process.env,
): EmailAuthConfig | null {
  if (environment.CIRCLES_EMAIL_AUTH_ENABLED !== "true") return null;
  const authUrl = environment.SUPABASE_AUTH_URL;
  const publishableKey = environment.SUPABASE_AUTH_PUBLISHABLE_KEY;
  // The path-free canonical project origin is intentionally exact. No env default
  // exists for either URL or key, and a service-role/legacy JWT key is rejected.
  if (
    authUrl !== SUPABASE_AUTH_URL ||
    typeof publishableKey !== "string" ||
    !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(publishableKey)
  ) {
    return null;
  }
  return { authUrl, publishableKey };
}

/** Feature state alone; configuration/provider/storage readiness is checked separately. */
export function isEmailAuthEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.CIRCLES_EMAIL_AUTH_ENABLED === "true";
}

function emailError(code: EmailAuthFailureCode): EmailAuthRouteError {
  switch (code) {
    case "WEAK_PASSWORD":
      return new EmailAuthRouteError(
        400,
        code,
        "Use at least 8 characters for your password",
      );
    case "INVALID_CREDENTIALS":
      return new EmailAuthRouteError(401, code, "Invalid email or password");
    case "REQUEST_NOT_ACCEPTED":
      return new EmailAuthRouteError(
        403,
        code,
        "Email authentication request was not accepted",
      );
    case "RATE_LIMITED":
      return new EmailAuthRouteError(
        429,
        code,
        "Too many email authentication attempts",
      );
    case "LINK_REQUIRED":
      return new EmailAuthRouteError(
        409,
        code,
        "Email identity requires account linking",
      );
    case "NOT_AUTHENTICATED":
      return new EmailAuthRouteError(401, code, "Not authenticated");
    case "UNAVAILABLE":
      return new EmailAuthRouteError(
        503,
        code,
        "Email authentication is temporarily unavailable",
      );
  }
}

function requestHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function isAllowedEmailWebOrigin(req: Request, origin: string): boolean {
  const exact = parseExactFrontendOrigin(origin);
  if (!exact) return false;
  if (trustedFrontendWebOrigins().has(exact)) return true;
  return (
    isLoopbackApiHost(req.hostname) && configuredFrontendOrigins().has(exact)
  );
}

function enforceBrowserOrNativeRequest(
  req: Request,
  client: EmailClient,
): void {
  const origin = requestHeader(req, "origin");
  const secFetchSite = requestHeader(req, "sec-fetch-site");
  const secFetchMode = requestHeader(req, "sec-fetch-mode");
  const secFetchDest = requestHeader(req, "sec-fetch-dest");

  if (client === "native") {
    // Browser requests cannot opt into the origin-less native path. Real native
    // fetch has no Sec-Fetch metadata and must declare client:native explicitly.
    if (origin || secFetchSite || secFetchMode || secFetchDest) {
      throw emailError("REQUEST_NOT_ACCEPTED");
    }
    return;
  }

  if (!origin || !isAllowedEmailWebOrigin(req, origin)) {
    throw emailError("REQUEST_NOT_ACCEPTED");
  }
  if (
    secFetchSite &&
    secFetchSite !== "same-origin" &&
    secFetchSite !== "same-site"
  ) {
    throw emailError("REQUEST_NOT_ACCEPTED");
  }
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > MAX_EMAIL_LENGTH ||
    /\s/.test(email) ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
  ) {
    return null;
  }
  return email;
}

function passwordFrom(value: unknown): string | null {
  // Passwords are intentionally not trimmed or normalized. Leading/trailing
  // spaces are credentials, while length keeps body processing bounded.
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_PASSWORD_LENGTH
  ) {
    return null;
  }
  return value;
}

function exactBody(
  body: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const object = body as Record<string, unknown>;
  const received = Object.keys(object);
  if (
    received.length !== keys.length ||
    received.some((key) => !keys.includes(key))
  ) {
    return null;
  }
  return object;
}

function parseCredentialBody(
  body: unknown,
  needsClient: boolean,
): { email: string; password: string; client?: EmailClient } {
  const object = exactBody(
    body,
    needsClient ? ["email", "password", "client"] : ["email", "password"],
  );
  const email = object ? normalizeEmail(object.email) : null;
  const password = object ? passwordFrom(object.password) : null;
  const client = object?.client;
  if (
    !object ||
    !email ||
    !password ||
    (needsClient && client !== "web" && client !== "native")
  ) {
    throw emailError("INVALID_CREDENTIALS");
  }
  return {
    email,
    password,
    ...(needsClient ? { client: client as EmailClient } : {}),
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function optionalDisplayName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const fullName = (value as Record<string, unknown>).full_name;
  if (typeof fullName !== "string") return null;
  const name = fullName.trim();
  return name.length > 0 && Array.from(name).length <= 120 ? name : null;
}

function hasConfirmedEmailIdentity(response: ProviderUserResponse): boolean {
  if (
    typeof response.email_confirmed_at !== "string" ||
    !response.email_confirmed_at
  ) {
    return false;
  }
  // Current Supabase /user responses include identities. If it is returned, it
  // must actually contain the email provider; older compatible responses still
  // rely on password grant plus the confirmed-email timestamp.
  if (response.identities === undefined) return true;
  return (
    Array.isArray(response.identities) &&
    response.identities.some(
      (identity) =>
        identity &&
        typeof identity === "object" &&
        (identity as Record<string, unknown>).provider === "email",
    )
  );
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ProviderTransportError();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderTransportError();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ProviderTransportError();
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ProviderTransportError) throw error;
    throw new ProviderTransportError();
  }

  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    throw new ProviderTransportError();
  }
}

async function providerRequest(
  fetchImpl: FetchImplementation,
  config: EmailAuthConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_AUTH_TIMEOUT_MS);
  try {
    return await fetchImpl(new URL(path, config.authUrl), {
      ...init,
      redirect: "error",
      signal: controller.signal,
      headers: {
        apikey: config.publishableKey,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ProviderTransportError();
  } finally {
    clearTimeout(timer);
  }
}

async function providerEmailAvailability(
  fetchImpl: FetchImplementation,
  config: EmailAuthConfig,
  now: number,
): Promise<boolean> {
  const fingerprint = `${config.authUrl}\u0000${config.publishableKey}`;
  let entries = providerAvailabilityCache.get(fetchImpl);
  if (!entries) {
    entries = new Map();
    providerAvailabilityCache.set(fetchImpl, entries);
  }
  const cached = entries.get(fingerprint);
  if (cached && now - cached.checkedAt < EMAIL_AUTH_SETTINGS_CACHE_TTL_MS) {
    return cached.available;
  }

  let available = false;
  try {
    // Public, safe availability probe only: no end-user credential, password,
    // session, auth.users data, or provider token is supplied or returned.
    const response = await providerRequest(
      fetchImpl,
      config,
      "/auth/v1/settings",
      {
        method: "GET",
        headers: { accept: "application/json" },
      },
    );
    if (response.ok) {
      const settings = (await boundedJson(
        response,
      )) as ProviderSettingsResponse;
      available = settings?.external?.email === true;
    } else if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
  } catch {
    available = false;
  }
  entries.set(fingerprint, { checkedAt: now, available });
  return available;
}

/** Checks only the private mapping table through the restricted runtime role. */
export async function checkEmailIdentityReadiness(
  identityStore: EmailAuthIdentityStore = emailIdentityStore,
): Promise<boolean> {
  try {
    return await identityStore.isReady();
  } catch {
    return false;
  }
}

/**
 * Exact public status DTO used by both the REST route and parent readiness code.
 * When disabled it performs no store/provider work, so existing readiness behavior
 * remains unchanged. When enabled every unavailable/misconfigured dependency is
 * fail-closed; the safe provider settings GET is bounded and short-TTL cached.
 */
export async function getEmailAuthStatus(
  dependencies: EmailAuthStatusDependencies = {},
): Promise<EmailAuthStatus> {
  const environment = dependencies.environment ?? process.env;
  const enabled = isEmailAuthEnabled(environment);
  if (!enabled) {
    return {
      enabled: false,
      ready: false,
      emailEnabled: false,
      googleEnabled: false,
      confirmationRequired: true,
    };
  }

  const config = configuredEmailAuth(environment);
  if (!config) {
    return {
      enabled: true,
      ready: false,
      emailEnabled: false,
      googleEnabled: false,
      confirmationRequired: true,
    };
  }

  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const now = (dependencies.now ?? Date.now)();
  const [mappingReady, providerReady] = await Promise.all([
    checkEmailIdentityReadiness(
      dependencies.identityStore ?? emailIdentityStore,
    ),
    providerEmailAvailability(fetchImpl, config, now),
  ]);
  const ready = mappingReady && providerReady;
  return {
    enabled: true,
    ready,
    emailEnabled: ready,
    googleEnabled: false,
    confirmationRequired: true,
  };
}

async function authenticateSupabasePassword(
  fetchImpl: FetchImplementation,
  config: EmailAuthConfig,
  email: string,
  password: string,
): Promise<VerifiedEmailIdentity> {
  const tokenResponse = await providerRequest(
    fetchImpl,
    config,
    "/auth/v1/token?grant_type=password",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!tokenResponse.ok) throw new ProviderCredentialError();
  const token = (await boundedJson(tokenResponse)) as ProviderTokenResponse;
  const accessToken = token?.access_token;
  if (
    typeof accessToken !== "string" ||
    accessToken.length < 16 ||
    accessToken.length > 8_192
  ) {
    throw new ProviderCredentialError();
  }

  const userResponse = await providerRequest(
    fetchImpl,
    config,
    "/auth/v1/user",
    {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
  if (!userResponse.ok) throw new ProviderCredentialError();
  const user = (await boundedJson(userResponse)) as ProviderUserResponse;
  const subject = typeof user?.id === "string" ? user.id.toLowerCase() : "";
  const confirmedEmail = normalizeEmail(user?.email);
  if (!isUuid(subject) || !confirmedEmail || !hasConfirmedEmailIdentity(user)) {
    throw new ProviderCredentialError();
  }
  return {
    subject,
    email: confirmedEmail,
    name: optionalDisplayName(user.user_metadata),
  };
}

async function requestSupabaseSignup(
  fetchImpl: FetchImplementation,
  config: EmailAuthConfig,
  email: string,
  password: string,
): Promise<void> {
  // Successful registration remains confirmation-only. Provider credentials,
  // identities and sessions are never returned to the caller.
  if (password.length < 8) throw emailError("WEAK_PASSWORD");
  const response = await providerRequest(fetchImpl, config, "/auth/v1/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    if (response.status === 429) throw emailError("RATE_LIMITED");
    if (response.status >= 500) throw new ProviderTransportError();
    const failure = (await boundedJson(response)) as {
      code?: unknown;
      message?: unknown;
      msg?: unknown;
    };
    const duplicate =
      failure.code === "user_already_exists" ||
      failure.code === "email_exists" ||
      failure.message === "User already registered" ||
      failure.msg === "User already registered";
    if (duplicate) return;
    if (failure.code === "weak_password") throw emailError("WEAK_PASSWORD");
    // Do not claim an email was sent when registration or delivery was rejected.
    throw emailError("UNAVAILABLE");
  }
  if (response.body) await response.body.cancel().catch(() => undefined);
}

function clientAddress(req: Request): string {
  const address = req.ip || req.socket.remoteAddress || "unknown";
  return address.slice(0, 128);
}

export type EmailAuthAdmissionKeys = {
  accountKey: string;
  networkKey: string;
};

function digestAdmissionValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function emailAdmissionKeys(
  req: Request,
  email: string,
): EmailAuthAdmissionKeys {
  return {
    // Do not retain an email address or source address as a map key. Account
    // and network budgets are intentionally independent so address rotation
    // cannot bypass an account limit, and email rotation cannot bypass an
    // abusive network limit.
    accountKey: digestAdmissionValue(email),
    networkKey: digestAdmissionValue(clientAddress(req)),
  };
}

/** Legacy single-key helper retained for direct test callers. */
function throttleKey(req: Request, email: string): string {
  const keys = emailAdmissionKeys(req, email);
  return `${keys.networkKey}:${keys.accountKey}`;
}

type ThrottleEntry = { startedAt: number; attempts: number };

export type EmailAuthAdmission = {
  checkAndRecordAdmission(keys: EmailAuthAdmissionKeys, now: number): boolean;
};

export type EmailAuthThrottleLimits = {
  accountLimit: number;
  networkLimit: number;
  globalLimit: number;
  maxEntries: number;
};

const defaultThrottleLimits: EmailAuthThrottleLimits = {
  accountLimit: EMAIL_AUTH_ACCOUNT_THROTTLE_LIMIT,
  networkLimit: EMAIL_AUTH_NETWORK_THROTTLE_LIMIT,
  globalLimit: EMAIL_AUTH_GLOBAL_THROTTLE_LIMIT,
  maxEntries: EMAIL_AUTH_THROTTLE_MAX_ENTRIES,
};

/**
 * Finite process-local admission control. It never evicts an active budget to
 * make room for a new key: capacity is a fail-closed rejection. This is a
 * defense-in-depth gate only; enabled multi-instance deployments still require
 * independently configured provider/edge and shared distributed controls.
 */
export class EmailAuthThrottle {
  private readonly accountEntries = new Map<string, ThrottleEntry>();
  private readonly networkEntries = new Map<string, ThrottleEntry>();
  private globalStartedAt = 0;
  private globalAttempts = 0;
  private readonly limits: EmailAuthThrottleLimits;

  constructor(limits: Partial<EmailAuthThrottleLimits> = {}) {
    this.limits = { ...defaultThrottleLimits, ...limits };
  }

  private pruneExpired(entries: Map<string, ThrottleEntry>, now: number): void {
    for (const [storedKey, entry] of entries) {
      if (now - entry.startedAt >= EMAIL_AUTH_THROTTLE_WINDOW_MS) {
        entries.delete(storedKey);
      }
    }
  }

  private resetExpiredGlobalBudget(now: number): void {
    if (
      this.globalAttempts > 0 &&
      now - this.globalStartedAt >= EMAIL_AUTH_THROTTLE_WINDOW_MS
    ) {
      this.globalStartedAt = 0;
      this.globalAttempts = 0;
    }
  }

  checkAndRecordAdmission(keys: EmailAuthAdmissionKeys, now: number): boolean {
    if (
      !Number.isFinite(now) ||
      !keys.accountKey ||
      !keys.networkKey ||
      this.limits.accountLimit < 1 ||
      this.limits.networkLimit < 1 ||
      this.limits.globalLimit < 1 ||
      this.limits.maxEntries < 1
    ) {
      return false;
    }
    this.pruneExpired(this.accountEntries, now);
    this.pruneExpired(this.networkEntries, now);
    this.resetExpiredGlobalBudget(now);

    const account = this.accountEntries.get(keys.accountKey);
    const network = this.networkEntries.get(keys.networkKey);
    const requiresAccountEntry = !account;
    const requiresNetworkEntry = !network;
    if (
      (account?.attempts ?? 0) >= this.limits.accountLimit ||
      (network?.attempts ?? 0) >= this.limits.networkLimit ||
      this.globalAttempts >= this.limits.globalLimit ||
      (requiresAccountEntry &&
        this.accountEntries.size >= this.limits.maxEntries) ||
      (requiresNetworkEntry &&
        this.networkEntries.size >= this.limits.maxEntries)
    ) {
      return false;
    }

    if (requiresAccountEntry) {
      this.accountEntries.set(keys.accountKey, { startedAt: now, attempts: 0 });
    }
    if (requiresNetworkEntry) {
      this.networkEntries.set(keys.networkKey, { startedAt: now, attempts: 0 });
    }
    this.accountEntries.get(keys.accountKey)!.attempts += 1;
    this.networkEntries.get(keys.networkKey)!.attempts += 1;
    if (this.globalAttempts === 0) this.globalStartedAt = now;
    this.globalAttempts += 1;
    return true;
  }

  /** Compatibility for callers that have only one test key. */
  checkAndRecord(key: string, now: number): boolean {
    return this.checkAndRecordAdmission(
      { accountKey: key, networkKey: key },
      now,
    );
  }

  size(): number {
    return Math.max(this.accountEntries.size, this.networkEntries.size);
  }
}

function sendFailure(res: ExpressResponse, error: unknown): void {
  const routeError =
    error instanceof EmailAuthRouteError
      ? error
      : error instanceof EmailIdentityLinkRequiredError
        ? emailError("LINK_REQUIRED")
        : error instanceof ProviderCredentialError
          ? emailError("INVALID_CREDENTIALS")
          : error instanceof EmailIdentityUnavailableError ||
              error instanceof ProviderTransportError
            ? emailError("UNAVAILABLE")
            : emailError("UNAVAILABLE");
  res
    .status(routeError.status)
    .setHeader("Cache-Control", "no-store")
    .json({ error: routeError.publicMessage, code: routeError.code });
}

function setOwnBrowserSession(
  req: Request,
  res: ExpressResponse,
  sessionToken: string,
): void {
  if (!setSessionCookie(req, res, sessionToken, APPLICATION_SESSION_TTL_MS)) {
    throw emailError("REQUEST_NOT_ACCEPTED");
  }
}

async function issueOwnSession(
  sdkServer: EmailAuthSdk,
  identity: LinkedEmailIdentity,
): Promise<string> {
  return sdkServer.createSessionToken(identity.openId, {
    name: identity.name ?? "",
    userId: identity.userId,
    expiresInMs: APPLICATION_SESSION_TTL_MS,
  });
}

/**
 * Registers only the additive email/password REST interface. Parent-owned index
 * wiring installs `express.json({ limit: EMAIL_AUTH_JSON_BODY_LIMIT })` before
 * the general parser, then invokes this function after its OAuth routes.
 */
export function registerEmailAuthRoutes(
  app: Express,
  dependencies: EmailAuthRouteDependencies = {},
): void {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const identityStore = dependencies.identityStore ?? emailIdentityStore;
  const sdkServer = dependencies.sdkServer ?? sdk;
  const now = dependencies.now ?? Date.now;
  const throttle = dependencies.throttle ?? new EmailAuthThrottle();
  const environment = dependencies.environment ?? process.env;

  app.get("/api/auth/email/status", async (_req, res) => {
    const status = await getEmailAuthStatus({
      fetchImpl,
      identityStore,
      now,
      environment,
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(status);
  });

  app.post("/api/auth/email/sign-in", async (req, res) => {
    try {
      const config = configuredEmailAuth(environment);
      if (!config) throw emailError("UNAVAILABLE");
      const credentials = parseCredentialBody(req.body, true);
      enforceBrowserOrNativeRequest(req, credentials.client!);
      if (credentials.client === "web" && !canIssueSessionCookie(req)) {
        throw emailError("REQUEST_NOT_ACCEPTED");
      }
      if (
        !throttle.checkAndRecordAdmission(
          emailAdmissionKeys(req, credentials.email),
          now(),
        )
      ) {
        throw emailError("RATE_LIMITED");
      }
      const verified = await authenticateSupabasePassword(
        fetchImpl,
        config,
        credentials.email,
        credentials.password,
      );
      const linked = await identityStore.resolveForSignIn(verified);
      const sessionToken = await issueOwnSession(sdkServer, linked);
      res.setHeader("Cache-Control", "no-store");
      if (credentials.client === "web") {
        setOwnBrowserSession(req, res, sessionToken);
        res.json({ success: true });
        return;
      }
      res.json({ success: true, sessionToken });
    } catch (error) {
      sendFailure(res, error);
    }
  });

  app.post("/api/auth/email/sign-up", async (req, res) => {
    try {
      const config = configuredEmailAuth(environment);
      if (!config) throw emailError("UNAVAILABLE");
      // Preserve the original browser contract while admitting explicit native
      // clients through the same metadata/origin checks used by sign-in.
      const hasClient =
        !!req.body && Object.prototype.hasOwnProperty.call(req.body, "client");
      const credentials = parseCredentialBody(req.body, hasClient);
      enforceBrowserOrNativeRequest(req, credentials.client ?? "web");
      if (
        !throttle.checkAndRecordAdmission(
          emailAdmissionKeys(req, credentials.email),
          now(),
        )
      ) {
        throw emailError("RATE_LIMITED");
      }
      await requestSupabaseSignup(
        fetchImpl,
        config,
        credentials.email,
        credentials.password,
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, confirmationRequired: true });
    } catch (error) {
      sendFailure(res, error);
    }
  });

  app.post("/api/auth/email/connect", async (req, res) => {
    try {
      const config = configuredEmailAuth(environment);
      if (!config) throw emailError("UNAVAILABLE");
      const credentials = parseCredentialBody(req.body, true);
      enforceBrowserOrNativeRequest(req, credentials.client!);
      if (credentials.client === "web" && !canIssueSessionCookie(req)) {
        throw emailError("REQUEST_NOT_ACCEPTED");
      }
      if (
        !throttle.checkAndRecordAdmission(
          emailAdmissionKeys(req, credentials.email),
          now(),
        )
      ) {
        throw emailError("RATE_LIMITED");
      }

      // The existing Circles actor is derived solely from the durable SDK session,
      // never a request-body user ID or a provider JWT presented by the caller.
      let actor: AuthenticatedActor;
      try {
        actor = await sdkServer.authenticateRequest(req);
      } catch {
        throw emailError("NOT_AUTHENTICATED");
      }
      if (!Number.isSafeInteger(actor.id) || actor.id < 1 || actor.isCron) {
        throw emailError("NOT_AUTHENTICATED");
      }

      const verified = await authenticateSupabasePassword(
        fetchImpl,
        config,
        credentials.email,
        credentials.password,
      );
      const linked = await identityStore.linkToExistingUser(verified, actor.id);
      if (linked.userId !== actor.id || linked.openId !== actor.openId) {
        throw new EmailIdentityLinkRequiredError();
      }
      const sessionToken = await issueOwnSession(sdkServer, linked);
      res.setHeader("Cache-Control", "no-store");
      if (credentials.client === "web") {
        setOwnBrowserSession(req, res, sessionToken);
        res.json({ success: true });
        return;
      }
      res.json({ success: true, sessionToken });
    } catch (error) {
      sendFailure(res, error);
    }
  });
}

export const emailAuthInternals = {
  configuredEmailAuth,
  enforceBrowserOrNativeRequest,
  normalizeEmail,
  passwordFrom,
  parseCredentialBody,
  authenticateSupabasePassword,
  requestSupabaseSignup,
  providerEmailAvailability,
  emailAdmissionKeys,
  throttleKey,
};
