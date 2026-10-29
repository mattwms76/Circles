import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import { APPLICATION_SESSION_TTL_MS } from "../../shared/const.js";
import {
  CIRCLES_NATIVE_OAUTH_REDIRECT_URI,
  isCirclesNativeOAuthRedirectUri,
} from "../../shared/oauth-redirect-contract.js";
import type { Express, Request, Response } from "express";
import { getUserByOpenId, upsertUser } from "../db";
import {
  canIssueSessionCookie,
  clearAcceptedSessionCookies,
  getSessionCookieOptions,
  setSessionCookie,
} from "./cookies";
import { ENV } from "./env";
import {
  configuredFrontendOrigins,
  parseExactFrontendOrigin,
} from "./frontend-origins";
import { isLoopbackApiHost, trustedFrontendWebOrigins } from "./cors";
import {
  oauthPendingStateStore,
  type ConsumedWebOAuthPendingState,
} from "./oauth-pending-state";
import { sdk } from "./sdk";

const OAUTH_STATE_COOKIE = "manus_oauth_state";
const OAUTH_CONTINUATION_COOKIE = "manus_oauth_continuation";
const OAUTH_CALLBACK_PATH = "/api/oauth/callback";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ACCOUNT_EMAIL_CONTINUATION = "/account/email";

export type OAuthStatePayload = {
  redirectUri: string;
  nonce: string;
};

export type PendingOAuthState = OAuthStatePayload & {
  state: string;
  frontendOrigin: string;
  expiresAt: number;
};

type NativePendingOAuthState = OAuthStatePayload & {
  state: string;
  expiresAt: number;
};

type OAuthStateCookie = {
  state: string;
  cookieBinding: string;
  expiresAt: number;
};

type OAuthContinuationCookie = {
  state: string;
  continuation: typeof ACCOUNT_EMAIL_CONTINUATION;
  expiresAt: number;
};

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function randomValue(): string {
  return randomBytes(32).toString("base64url");
}

/** Encodes the Manus OAuth wire state: base64 JSON containing redirectUri and nonce. */
export function encodeOAuthState({
  redirectUri,
  nonce,
}: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify({ redirectUri, nonce }), "utf8").toString(
    "base64",
  );
}

/** Parses only canonical base64 Manus OAuth state values. */
export function decodeOAuthState(state: string): OAuthStatePayload | null {
  if (
    state.length === 0 ||
    state.length > 8_192 ||
    state.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(state)
  ) {
    return null;
  }

  try {
    const decoded = Buffer.from(state, "base64");
    if (decoded.toString("base64") !== state) return null;
    const value: unknown = JSON.parse(decoded.toString("utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as Record<string, unknown>).redirectUri !== "string" ||
      typeof (value as Record<string, unknown>).nonce !== "string"
    ) {
      return null;
    }

    const { redirectUri, nonce } = value as OAuthStatePayload;
    if (
      redirectUri.length === 0 ||
      redirectUri.length > 2_048 ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)
    ) {
      return null;
    }
    return { redirectUri, nonce };
  } catch {
    return null;
  }
}

/** Validates an exact, unexpired state/nonce binding before a code is exchanged. */
export function validateOAuthState(
  state: string,
  pending: PendingOAuthState | NativePendingOAuthState,
  now = Date.now(),
): boolean {
  if (pending.expiresAt <= now || !constantTimeEqual(state, pending.state))
    return false;
  const received = decodeOAuthState(state);
  return (
    received !== null &&
    constantTimeEqual(received.nonce, pending.nonce) &&
    constantTimeEqual(received.redirectUri, pending.redirectUri)
  );
}

function normalizeConfiguredCallbackOrigin(
  value: string | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** True only for the actual origin supplied by the app when it is configured for this project. */
export function isTrustedFrontendOrigin(
  frontendOrigin: string,
  configuredOrigins: Iterable<string> = configuredFrontendOrigins(),
): boolean {
  const origin = parseExactFrontendOrigin(frontendOrigin);
  return origin !== null && new Set(configuredOrigins).has(origin);
}

function configuredCallbackOrigins(): Set<string> {
  const explicit = [
    process.env.OAUTH_CALLBACK_ORIGIN,
    process.env.API_ORIGIN,
    process.env.API_BASE_URL,
    process.env.EXPO_PUBLIC_API_BASE_URL,
  ]
    .map(normalizeConfiguredCallbackOrigin)
    .filter((origin): origin is string => origin !== null);

  for (const frontendUrl of [
    process.env.EXPO_PACKAGER_PROXY_URL,
    process.env.EXPO_WEB_PREVIEW_URL,
  ]) {
    const origin = normalizeConfiguredCallbackOrigin(frontendUrl);
    if (!origin) continue;
    const url = new URL(origin);
    if (url.hostname.startsWith("8081-")) {
      url.hostname = url.hostname.replace(/^8081-/, "3000-");
      explicit.push(url.origin);
    } else if (
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.port === "8081"
    ) {
      url.port = "3000";
      explicit.push(url.origin);
    }
  }

  return new Set(explicit);
}

function isTrustedWebCallbackRedirect(
  redirectUri: string,
  frontendOrigin: string,
): boolean {
  try {
    const url = new URL(redirectUri);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.pathname !== OAUTH_CALLBACK_PATH ||
      url.search ||
      url.hash
    ) {
      return false;
    }
    return (
      url.origin === frontendOrigin ||
      configuredCallbackOrigins().has(url.origin)
    );
  } catch {
    return false;
  }
}

/** Allows only the deployment-owned Circles AuthSession callback. */
export function isSafeNativeRedirectUri(redirectUri: string): boolean {
  return isCirclesNativeOAuthRedirectUri(redirectUri);
}

function issueState(
  redirectUri: string,
): OAuthStatePayload & { state: string } {
  const nonce = randomValue();
  return {
    redirectUri,
    nonce,
    state: encodeOAuthState({ redirectUri, nonce }),
  };
}

function requireOAuthConfig(): { portalUrl: string; appId: string } {
  const portalUrl =
    process.env.MANUS_OAUTH_PORTAL_URL ?? process.env.OAUTH_PORTAL_URL ?? "";
  const appId = ENV.appId;
  const portal = new URL(portalUrl);
  if (portal.protocol !== "https:" || !appId) {
    throw new Error("OAuth configuration is unavailable");
  }
  return { portalUrl: portalUrl.replace(/\/$/, ""), appId };
}

function buildAuthorizationUrl(redirectUri: string, state: string): string {
  const { portalUrl, appId } = requireOAuthConfig();
  const url = new URL(`${portalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("responseType", "code");
  return url.toString();
}

function isAllowedOAuthContinuation(
  value: string | undefined,
): value is typeof ACCOUNT_EMAIL_CONTINUATION {
  return value === ACCOUNT_EMAIL_CONTINUATION;
}

function signPendingState(pending: OAuthStateCookie): string {
  if (!ENV.cookieSecret)
    throw new Error("OAuth session signing is unavailable");
  const payload = Buffer.from(JSON.stringify(pending), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", ENV.cookieSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function readPendingState(req: Request): OAuthStateCookie | null {
  if (!ENV.cookieSecret || !req.headers.cookie) return null;
  const raw = parseCookieHeader(req.headers.cookie)[OAUTH_STATE_COOKIE];
  if (!raw) return null;
  const [payload, signature, ...extra] = raw.split(".");
  if (!payload || !signature || extra.length > 0) return null;
  const expected = createHmac("sha256", ENV.cookieSecret)
    .update(payload)
    .digest("base64url");
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as Record<string, unknown>).state !== "string" ||
      typeof (value as Record<string, unknown>).cookieBinding !== "string" ||
      typeof (value as Record<string, unknown>).expiresAt !== "number"
    ) {
      return null;
    }
    const pending = value as OAuthStateCookie;
    if (
      pending.expiresAt <= Date.now() ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(pending.cookieBinding) ||
      decodeOAuthState(pending.state) === null
    ) {
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

function oauthStateCookieOptions(req: Request) {
  const sessionOptions = getSessionCookieOptions(req);
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: sessionOptions.secure,
  };
}

function clearOAuthStateCookie(req: Request, res: Response) {
  res.clearCookie(OAUTH_STATE_COOKIE, oauthStateCookieOptions(req));
}

function signOAuthContinuation(pending: OAuthContinuationCookie): string {
  if (!ENV.cookieSecret)
    throw new Error("OAuth session signing is unavailable");
  const payload = Buffer.from(JSON.stringify(pending), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", ENV.cookieSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function readOAuthContinuation(req: Request): OAuthContinuationCookie | null {
  if (!ENV.cookieSecret || !req.headers.cookie) return null;
  const raw = parseCookieHeader(req.headers.cookie)[OAUTH_CONTINUATION_COOKIE];
  if (!raw) return null;
  const [payload, signature, ...extra] = raw.split(".");
  if (!payload || !signature || extra.length > 0) return null;
  const expected = createHmac("sha256", ENV.cookieSecret)
    .update(payload)
    .digest("base64url");
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as Record<string, unknown>).state !== "string" ||
      typeof (value as Record<string, unknown>).continuation !== "string" ||
      typeof (value as Record<string, unknown>).expiresAt !== "number"
    ) {
      return null;
    }
    const pending = value as OAuthContinuationCookie;
    if (
      pending.expiresAt <= Date.now() ||
      !isAllowedOAuthContinuation(pending.continuation)
    ) {
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

function clearOAuthContinuationCookie(req: Request, res: Response) {
  res.clearCookie(OAUTH_CONTINUATION_COOKIE, oauthStateCookieOptions(req));
}

async function issueNativeOAuthFlow(redirectUri: string): Promise<{
  flowToken: string;
  state: string;
}> {
  const issued = issueState(redirectUri);
  const flowToken = randomValue();
  await oauthPendingStateStore.createNative({
    ...issued,
    flowToken,
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });
  return { flowToken, state: issued.state };
}

async function consumeNativeOAuthFlow(
  flowToken: string | undefined,
  state: string,
): Promise<NativePendingOAuthState | null> {
  if (!flowToken || !/^[A-Za-z0-9_-]{32,128}$/.test(flowToken)) return null;
  // DELETE ... RETURNING consumes the valid code/state/flow tuple before exchange.
  const pending = await oauthPendingStateStore.consumeNative({
    state,
    flowToken,
  });
  if (!pending) return null;
  return {
    ...pending,
    state: encodeOAuthState(pending),
    expiresAt: pending.expiresAt.getTime(),
  };
}

async function syncUser(userInfo: {
  openId?: string | null;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  platform?: string | null;
}) {
  if (!userInfo.openId) {
    throw new Error("openId missing from user info");
  }

  const lastSignedIn = new Date();
  await upsertUser({
    openId: userInfo.openId,
    name: userInfo.name || null,
    email: userInfo.email ?? null,
    loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
    lastSignedIn,
  });
  const saved = await getUserByOpenId(userInfo.openId);
  // OAuth issuer identity alone is not enough for a Circles session. The
  // numeric user row is the source of authorization and must be observed after
  // the upsert; otherwise a new token could later attach to a replacement row.
  if (
    !saved ||
    saved.openId !== userInfo.openId ||
    !Number.isSafeInteger(saved.id) ||
    saved.id <= 0
  ) {
    throw new Error("OAuth identity did not map to a Circles actor");
  }
  return saved;
}

function buildUserResponse(
  user:
    | Awaited<ReturnType<typeof getUserByOpenId>>
    | {
        openId: string;
        name?: string | null;
        email?: string | null;
        loginMethod?: string | null;
        lastSignedIn?: Date | null;
      },
) {
  return {
    id: (user as any)?.id ?? null,
    openId: user?.openId ?? null,
    name: user?.name ?? null,
    email: user?.email ?? null,
    loginMethod: user?.loginMethod ?? null,
    lastSignedIn: (user?.lastSignedIn ?? new Date()).toISOString(),
  };
}

type OAuthSessionIssuer = {
  createSessionToken(
    openId: string,
    options: { expiresInMs: number; name: string; userId: number },
  ): Promise<string>;
};

type OAuthSessionActor = {
  id: number;
  openId: string;
};

/** Issues new OAuth sessions only for the just-observed numeric Circles actor. */
export async function issueOAuthSessionForActor(
  issuer: OAuthSessionIssuer,
  userInfo: { openId?: string | null; name?: string | null },
  actor: OAuthSessionActor,
): Promise<string> {
  if (
    !userInfo.openId ||
    actor.openId !== userInfo.openId ||
    !Number.isSafeInteger(actor.id) ||
    actor.id <= 0
  ) {
    throw new Error("OAuth identity did not map to a Circles actor");
  }
  return issuer.createSessionToken(actor.openId, {
    name: userInfo.name || "",
    userId: actor.id,
    expiresInMs: APPLICATION_SESSION_TTL_MS,
  });
}

async function completeOAuthLogin(code: string, state: string) {
  const tokenResponse = await sdk.exchangeCodeForToken(code, state);
  const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
  const user = await syncUser(userInfo);
  const sessionToken = await issueOAuthSessionForActor(sdk, userInfo, user);
  return { sessionToken, user };
}

function setApplicationSession(
  req: Request,
  res: Response,
  sessionToken: string,
) {
  if (!setSessionCookie(req, res, sessionToken, APPLICATION_SESSION_TTL_MS)) {
    throw new Error("Browser session cookie requires HTTPS or loopback HTTP");
  }
}

function requestHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function presentedBearer(req: Request): string | null {
  const authorization = requestHeader(req, "authorization");
  const match = authorization ? /^Bearer\s+(\S+)$/.exec(authorization) : null;
  return match?.[1] ?? null;
}

/**
 * Browser cookie logout needs an explicit origin check beyond CORS. Origin-less
 * traffic is reserved for native callers and must present a bearer that the
 * caller authenticates before durable revocation. REST and tRPC share this
 * exact gate so neither endpoint becomes the weaker logout route.
 */
export function isAllowedLogoutOrigin(req: Request, origin: string): boolean {
  if (trustedFrontendWebOrigins().has(origin)) return true;
  return (
    isLoopbackApiHost(req.hostname) && configuredFrontendOrigins().has(origin)
  );
}

export async function authorizeLogoutRequest(req: Request): Promise<void> {
  const origin = requestHeader(req, "origin");
  if (origin) {
    if (!isAllowedLogoutOrigin(req, origin)) {
      throw new Error("Logout origin is not allowed");
    }
    return;
  }

  const bearer = presentedBearer(req);
  if (!bearer) {
    throw new Error("Logout requires an origin or bearer credential");
  }

  // This validates the signed claim and matching active durable record without
  // loading/synchronizing a user row. It therefore cannot silently validate a
  // supplied bad bearer by falling back to any cookie on the request.
  if (!(await sdk.verifySession(bearer))) {
    throw new Error("Logout requires a valid bearer credential");
  }
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/start", async (req: Request, res: Response) => {
    const redirectUri = getQueryParam(req, "redirectUri");
    const frontendOrigin = getQueryParam(req, "frontendOrigin");
    const continuation = getQueryParam(req, "continuation");
    if (
      !redirectUri ||
      !frontendOrigin ||
      (continuation !== undefined &&
        !isAllowedOAuthContinuation(continuation)) ||
      !isTrustedFrontendOrigin(frontendOrigin) ||
      !isTrustedWebCallbackRedirect(redirectUri, frontendOrigin)
    ) {
      res.status(400).json({ error: "Invalid OAuth redirect" });
      return;
    }

    try {
      const issued = issueState(redirectUri);
      const cookieBinding = randomValue();
      const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
      await oauthPendingStateStore.createWeb({
        ...issued,
        frontendOrigin,
        cookieBinding,
        expiresAt: new Date(expiresAt),
      });
      const pending: OAuthStateCookie = {
        state: issued.state,
        cookieBinding,
        expiresAt,
      };
      res.cookie(OAUTH_STATE_COOKIE, signPendingState(pending), {
        ...oauthStateCookieOptions(req),
        maxAge: OAUTH_STATE_TTL_MS,
      });
      if (continuation) {
        res.cookie(
          OAUTH_CONTINUATION_COOKIE,
          signOAuthContinuation({
            state: issued.state,
            continuation,
            expiresAt,
          }),
          {
            ...oauthStateCookieOptions(req),
            maxAge: OAUTH_STATE_TTL_MS,
          },
        );
      }
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, buildAuthorizationUrl(redirectUri, issued.state));
    } catch {
      res.status(503).json({ error: "OAuth is temporarily unavailable" });
    }
  });

  app.get("/api/oauth/mobile/start", async (_req: Request, res: Response) => {
    try {
      // Never accept a callback receiver from the initiating request. The
      // provider is sent only the immutable URI owned by this Circles build.
      const { flowToken, state } = await issueNativeOAuthFlow(
        CIRCLES_NATIVE_OAUTH_REDIRECT_URI,
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({
        authorizationUrl: buildAuthorizationUrl(
          CIRCLES_NATIVE_OAUTH_REDIRECT_URI,
          state,
        ),
        flowToken,
        expiresIn: Math.floor(OAUTH_STATE_TTL_MS / 1000),
      });
    } catch {
      res.status(503).json({ error: "OAuth is temporarily unavailable" });
    }
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const cookie = readPendingState(req);
    const continuationCookie = readOAuthContinuation(req);
    clearOAuthStateCookie(req, res);
    clearOAuthContinuationCookie(req, res);

    if (!code || !state || !cookie || !constantTimeEqual(state, cookie.state)) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    let consumed: ConsumedWebOAuthPendingState | null;
    try {
      consumed = await oauthPendingStateStore.consumeWeb({
        state,
        cookieBinding: cookie.cookieBinding,
      });
    } catch {
      res.status(503).json({ error: "OAuth is temporarily unavailable" });
      return;
    }

    const pending: PendingOAuthState | null = consumed
      ? {
          ...consumed,
          state: encodeOAuthState(consumed),
          expiresAt: consumed.expiresAt.getTime(),
        }
      : null;
    if (
      !pending ||
      !isTrustedFrontendOrigin(pending.frontendOrigin) ||
      !isTrustedWebCallbackRedirect(
        pending.redirectUri,
        pending.frontendOrigin,
      ) ||
      !validateOAuthState(state, pending)
    ) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    if (!canIssueSessionCookie(req)) {
      res.status(400).json({ error: "Browser session requires HTTPS" });
      return;
    }

    try {
      const { sessionToken } = await completeOAuthLogin(code, state);
      setApplicationSession(req, res, sessionToken);
      const continuation =
        continuationCookie &&
        constantTimeEqual(continuationCookie.state, state) &&
        isAllowedOAuthContinuation(continuationCookie.continuation)
          ? continuationCookie.continuation
          : "/";
      // The redirect target remains the signed configured origin plus a single
      // allow-listed protected migration path, never caller-controlled URL text.
      res.redirect(
        302,
        new URL(continuation, pending.frontendOrigin).toString(),
      );
    } catch {
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  app.get("/api/oauth/mobile", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    let pending: NativePendingOAuthState | null;
    try {
      pending = await consumeNativeOAuthFlow(
        req.get("x-manus-oauth-flow"),
        state,
      );
    } catch {
      res.status(503).json({ error: "OAuth is temporarily unavailable" });
      return;
    }

    if (
      !pending ||
      !isSafeNativeRedirectUri(pending.redirectUri) ||
      !validateOAuthState(state, pending)
    ) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    try {
      const { sessionToken, user } = await completeOAuthLogin(code, state);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        app_session_id: sessionToken,
        user: buildUserResponse(user),
      });
    } catch {
      res.status(500).json({ error: "OAuth mobile exchange failed" });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      await authorizeLogoutRequest(req);
    } catch {
      clearAcceptedSessionCookies(req, res);
      res.status(403).json({ error: "Logout request was not accepted" });
      return;
    }

    try {
      await sdk.revokeRequestSessions(req);
      clearAcceptedSessionCookies(req, res);
      res.json({ success: true });
    } catch {
      // Clear this browser's accepted authorities even when durable revocation
      // fails, but never report success for a copied credential we could not revoke.
      clearAcceptedSessionCookies(req, res);
      res.status(503).json({ error: "Logout is temporarily unavailable" });
    }
  });

  // Get current authenticated user - works with web session cookies and native Bearer tokens.
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: buildUserResponse(user) });
    } catch {
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });

  // Establish a browser session from an already validated Bearer token.
  app.post("/api/auth/session", async (req: Request, res: Response) => {
    if (!canIssueSessionCookie(req)) {
      res.status(400).json({ error: "Browser session requires HTTPS" });
      return;
    }
    try {
      const user = await sdk.authenticateRequest(req);
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();
      setApplicationSession(req, res, token);
      res.json({ success: true, user: buildUserResponse(user) });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
