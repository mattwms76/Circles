import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import { APPLICATION_SESSION_TTL_MS } from "../../shared/const.js";
import type { Express, Request, Response } from "express";
import { getUserByOpenId, upsertUser } from "../db";
import {
  APPLICATION_SESSION_COOKIE_NAME,
  clearAcceptedSessionCookies,
  getSessionCookieOptions,
} from "./cookies";
import { ENV } from "./env";
import {
  configuredFrontendOrigins,
  parseExactFrontendOrigin,
} from "./frontend-origins";
import { sdk } from "./sdk";

const OAUTH_STATE_COOKIE = "manus_oauth_state";
const OAUTH_CALLBACK_PATH = "/api/oauth/callback";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_NATIVE_FLOWS = 2_000;

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

const pendingNativeOAuthFlows = new Map<string, NativePendingOAuthState>();

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
export function encodeOAuthState(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
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

/** Allows only the app's fixed Manus deep-link callback, never arbitrary custom schemes. */
export function isSafeNativeRedirectUri(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri);
    if (
      !/^manus[0-9]{8,}:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return false;
    }
    return (
      (url.hostname === "oauth" && url.pathname === "/callback") ||
      (url.hostname === "" && url.pathname === "/oauth/callback")
    );
  } catch {
    return false;
  }
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

function signPendingState(pending: PendingOAuthState): string {
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

function readPendingState(req: Request): PendingOAuthState | null {
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
      typeof (value as Record<string, unknown>).redirectUri !== "string" ||
      typeof (value as Record<string, unknown>).nonce !== "string" ||
      typeof (value as Record<string, unknown>).frontendOrigin !== "string" ||
      typeof (value as Record<string, unknown>).expiresAt !== "number"
    ) {
      return null;
    }
    const pending = value as PendingOAuthState;
    if (
      !isTrustedFrontendOrigin(pending.frontendOrigin) ||
      !isTrustedWebCallbackRedirect(pending.redirectUri, pending.frontendOrigin)
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

function pruneNativeOAuthFlows(now = Date.now()) {
  for (const [flowToken, pending] of pendingNativeOAuthFlows) {
    if (pending.expiresAt <= now) pendingNativeOAuthFlows.delete(flowToken);
  }
  while (pendingNativeOAuthFlows.size >= MAX_PENDING_NATIVE_FLOWS) {
    const oldest = pendingNativeOAuthFlows.keys().next().value;
    if (!oldest) break;
    pendingNativeOAuthFlows.delete(oldest);
  }
}

function issueNativeOAuthFlow(redirectUri: string): {
  flowToken: string;
  state: string;
} {
  pruneNativeOAuthFlows();
  const issued = issueState(redirectUri);
  const flowToken = randomValue();
  pendingNativeOAuthFlows.set(flowToken, {
    ...issued,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });
  return { flowToken, state: issued.state };
}

function consumeNativeOAuthFlow(
  flowToken: string | undefined,
): NativePendingOAuthState | null {
  if (!flowToken || !/^[A-Za-z0-9_-]{32,128}$/.test(flowToken)) return null;
  const pending = pendingNativeOAuthFlows.get(flowToken) ?? null;
  // Consume before exchanging: a code/state/flow tuple can never be replayed, including after errors.
  pendingNativeOAuthFlows.delete(flowToken);
  if (!pending || pending.expiresAt <= Date.now()) return null;
  return pending;
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
  return (
    saved ?? {
      openId: userInfo.openId,
      name: userInfo.name,
      email: userInfo.email,
      loginMethod: userInfo.loginMethod ?? null,
      lastSignedIn,
    }
  );
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

async function completeOAuthLogin(code: string, state: string) {
  const tokenResponse = await sdk.exchangeCodeForToken(code, state);
  const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
  const user = await syncUser(userInfo);
  const sessionToken = await sdk.createSessionToken(userInfo.openId!, {
    name: userInfo.name || "",
    expiresInMs: APPLICATION_SESSION_TTL_MS,
  });
  return { sessionToken, user };
}

function setApplicationSession(
  req: Request,
  res: Response,
  sessionToken: string,
) {
  res.cookie(APPLICATION_SESSION_COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge: APPLICATION_SESSION_TTL_MS,
  });
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/start", (req: Request, res: Response) => {
    const redirectUri = getQueryParam(req, "redirectUri");
    const frontendOrigin = getQueryParam(req, "frontendOrigin");
    if (
      !redirectUri ||
      !frontendOrigin ||
      !isTrustedFrontendOrigin(frontendOrigin) ||
      !isTrustedWebCallbackRedirect(redirectUri, frontendOrigin)
    ) {
      res.status(400).json({ error: "Invalid OAuth redirect" });
      return;
    }

    try {
      const issued = issueState(redirectUri);
      const pending: PendingOAuthState = {
        ...issued,
        frontendOrigin,
        expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
      };
      res.cookie(OAUTH_STATE_COOKIE, signPendingState(pending), {
        ...oauthStateCookieOptions(req),
        maxAge: OAUTH_STATE_TTL_MS,
      });
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, buildAuthorizationUrl(redirectUri, issued.state));
    } catch {
      res.status(503).json({ error: "OAuth is temporarily unavailable" });
    }
  });

  app.get("/api/oauth/mobile/start", (req: Request, res: Response) => {
    const redirectUri = getQueryParam(req, "redirectUri");
    if (!redirectUri || !isSafeNativeRedirectUri(redirectUri)) {
      res.status(400).json({ error: "Invalid OAuth redirect" });
      return;
    }

    try {
      const { flowToken, state } = issueNativeOAuthFlow(redirectUri);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        authorizationUrl: buildAuthorizationUrl(redirectUri, state),
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
    const pending = readPendingState(req);
    clearOAuthStateCookie(req, res);

    if (!code || !state || !pending || !validateOAuthState(state, pending)) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    try {
      const { sessionToken } = await completeOAuthLogin(code, state);
      setApplicationSession(req, res, sessionToken);
      // The redirect target is the signed, configured origin and a fixed in-app path.
      res.redirect(302, new URL("/", pending.frontendOrigin).toString());
    } catch {
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  app.get("/api/oauth/mobile", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const pending = consumeNativeOAuthFlow(req.get("x-manus-oauth-flow"));

    if (!code || !state || !pending || !validateOAuthState(state, pending)) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    try {
      const { sessionToken, user } = await completeOAuthLogin(code, state);
      setApplicationSession(req, res, sessionToken);
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
