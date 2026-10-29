import { parse as parseCookieHeader } from "cookie";
import type { CookieOptions, Request, RequestHandler, Response } from "express";
import {
  LEGACY_COOKIE_NAME,
  SESSION_COOKIE_SUFFIX,
} from "../../shared/const.js";
import { isLoopbackApiHost } from "./cors";
import {
  isTrustedPreviewProxyRequest,
  isTrustedExternalProxyRequest,
} from "./runtimeSecurity";

/**
 * Pre-cutover generic browser session name. It is only revoked/expired during
 * logout; it must never establish request identity after the host-cookie cutover.
 */
export const LEGACY_APPLICATION_SESSION_COOKIE_NAME = "webdev_app_session";

/** @deprecated Logout compatibility export; do not use for authentication or issuance. */
export const APPLICATION_SESSION_COOKIE_NAME =
  LEGACY_APPLICATION_SESSION_COOKIE_NAME;

export function isSecureRequest(req: Request) {
  // A direct TLS server reports https without a forwarding header. Once a forwarding header is
  // present, require one of the explicit trusted-hop contracts below instead of trusting it by
  // virtue of Express's derived req.protocol.
  if (req.protocol === "https" && !req.headers["x-forwarded-proto"])
    return true;
  return (
    isTrustedPreviewProxyRequest(req, "https") ||
    isTrustedExternalProxyRequest(req, "https")
  );
}

export function getSessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "httpOnly" | "path" | "sameSite" | "secure"> {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  };
}

function configuredApiHostname(): string | null {
  const packager = process.env.EXPO_PACKAGER_PROXY_URL;
  if (!packager) return null;
  try {
    const url = new URL(packager);
    const hostname = url.hostname.replace(/^8081-/, "3000-");
    return hostname === url.hostname ? null : hostname;
  } catch {
    return null;
  }
}

function legacyParentDomain(hostname: string): string | null {
  const normalized = hostname.toLowerCase();
  if (normalized !== configuredApiHostname()?.toLowerCase()) return null;
  if (!/^3000-[a-z0-9-]+(?:\.[a-z0-9-]+){2,}$/.test(normalized)) return null;
  return `.${normalized.split(".").slice(-2).join(".")}`;
}

function requestHostname(req: Request): string {
  return typeof req.hostname === "string" ? req.hostname : "";
}

export function getSessionCookieName(req: Request): string | undefined {
  if (isSecureRequest(req)) {
    return `__Host-manus_session_${SESSION_COOKIE_SUFFIX}`;
  }

  // A Secure __Host- cookie cannot exist on plain HTTP. Retain a separately
  // named cookie only for direct loopback development; never turn an arbitrary
  // insecure deployment into a non-host-prefixed identity surface.
  return isLoopbackApiHost(requestHostname(req))
    ? `manus_local_session_${SESSION_COOKIE_SUFFIX}`
    : undefined;
}

export function canIssueSessionCookie(req: Request): boolean {
  return getSessionCookieName(req) !== undefined;
}

/** Issues the sole browser identity cookie accepted for this request context. */
export function setSessionCookie(
  req: Request,
  res: Response,
  sessionToken: string,
  maxAge: number,
): boolean {
  const name = getSessionCookieName(req);
  if (!name) return false;
  res.cookie(name, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge,
  });
  return true;
}

/**
 * Expires every cookie name that authenticateRequest accepts for this request.
 *
 * Cookie attributes must match the original host-only secure Preview cookie or
 * the HTTP-local cookie for browsers to replace it. This deliberately leaves
 * non-session platform/access-gate cookies alone.
 */
export function clearAcceptedSessionCookies(req: Request, res: Response): void {
  const options = getSessionCookieOptions(req);

  // Clear the directly issued pre-cutover cookie, and, for a recognized
  // Preview API host, a possible historical parent-domain variant as well.
  res.clearCookie(LEGACY_APPLICATION_SESSION_COOKIE_NAME, options);
  const legacyOptions = getLegacySessionCookieOptions(req);
  if (legacyOptions.domain) {
    res.clearCookie(LEGACY_APPLICATION_SESSION_COOKIE_NAME, legacyOptions);
  }
  clearHistoricalLegacySessionCookie(req, res, options, legacyOptions);

  const currentName = getSessionCookieName(req);
  if (currentName) res.clearCookie(currentName, options);
}

export function getLegacySessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const secure = isSecureRequest(req);
  const domain = legacyParentDomain(requestHostname(req));
  return {
    ...(domain ? { domain } : {}),
    httpOnly: true,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  };
}

function clearHistoricalLegacySessionCookie(
  req: Request,
  res: Response,
  options = getSessionCookieOptions(req),
  legacyOptions = getLegacySessionCookieOptions(req),
): void {
  // app_session_id is logout compatibility only. Historical installations may
  // have set it host-only or, on a recognized Preview hostname, parent-domain.
  // Expire both distinct browser records without restoring it as identity.
  res.clearCookie(LEGACY_COOKIE_NAME, options);
  if (legacyOptions.domain) {
    res.clearCookie(LEGACY_COOKIE_NAME, legacyOptions);
  }
}

export function clearLegacySessionCookie(): RequestHandler {
  return (req, res, next) => {
    clearHistoricalLegacySessionCookie(req, res);
    next();
  };
}

export function currentSessionCookie(req: Request): string | undefined {
  const name = getSessionCookieName(req);
  if (!req.headers.cookie || !name) return undefined;
  return parseCookieHeader(req.headers.cookie)[name];
}
