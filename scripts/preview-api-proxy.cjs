const { Buffer } = require("node:buffer");
const crypto = require("node:crypto");
const http = require("node:http");

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const FORWARDING_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-manus-preview-limiter",
  "x-manus-preview-proxy",
]);
const PREVIEW_LIMITER_HEADER = "x-manus-preview-limiter";
const PREVIEW_PROXY_HEADER = "x-manus-preview-proxy";
const PREVIEW_LIMITER_TTL_SECONDS = 24 * 60 * 60;
const PREVIEW_LIMITER_COOKIE_NAME = "__Host-manus_preview_limiter";
const LOCAL_LIMITER_COOKIE_NAME = "manus_local_preview_limiter";
const LIMITER_TOKEN_PATTERN =
  /^v1\.([A-Za-z0-9_-]{16,64})\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

function endToEndHeaders(headers) {
  const excluded = new Set(HOP_BY_HOP);
  for (const token of String(headers.connection || "").split(",")) {
    excluded.add(token.trim().toLowerCase());
  }
  for (const header of FORWARDING_HEADERS) excluded.add(header);
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !excluded.has(name.toLowerCase()),
    ),
  );
}

function configuredPublicOrigin() {
  const origin =
    process.env.EXPO_WEB_PREVIEW_URL || process.env.EXPO_PACKAGER_PROXY_URL;
  try {
    const url = new URL(origin);
    return ["https:", "http:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function publicProtocolForOrigin(publicOrigin) {
  return publicOrigin && new URL(publicOrigin).protocol === "https:"
    ? "https"
    : "http";
}

function limiterSecret(explicitSecret) {
  return (
    explicitSecret ||
    process.env.MANUS_JWT_SECRET ||
    process.env.JWT_SECRET ||
    ""
  );
}

function signLimiterIdentity(identity, expiresAtSeconds, secret) {
  if (!secret || !/^[A-Za-z0-9_-]{16,64}$/.test(identity)) return null;
  const payload = `v1.${identity}.${expiresAtSeconds}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifyLimiterIdentity(token, secret, nowSeconds) {
  if (!token || !secret) return null;
  const match = LIMITER_TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const [, identity, expiryText, suppliedSignature] = match;
  const expiresAtSeconds = Number(expiryText);
  if (
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds <= nowSeconds ||
    expiresAtSeconds > nowSeconds + PREVIEW_LIMITER_TTL_SECONDS
  ) {
    return null;
  }
  const expected = signLimiterIdentity(identity, expiresAtSeconds, secret);
  if (!expected) return null;
  const expectedSignature = expected.slice(expected.lastIndexOf(".") + 1);
  const actual = Buffer.from(suppliedSignature, "base64url");
  const wanted = Buffer.from(expectedSignature, "base64url");
  return actual.length === wanted.length &&
    crypto.timingSafeEqual(actual, wanted)
    ? token
    : null;
}

function cookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const [cookieName, ...value] = part.trim().split("=");
    if (cookieName === name) return value.join("=");
  }
  return null;
}

function issueLimiterIdentity(req, secret, publicProtocol, nowSeconds) {
  if (!secret) return { token: null, setCookie: null };
  const secure = publicProtocol === "https";
  const cookieName = secure
    ? PREVIEW_LIMITER_COOKIE_NAME
    : LOCAL_LIMITER_COOKIE_NAME;
  const existing = verifyLimiterIdentity(
    cookieValue(req.headers.cookie, cookieName),
    secret,
    nowSeconds,
  );
  if (existing) return { token: existing, setCookie: null };

  const identity = crypto.randomBytes(24).toString("base64url");
  const token = signLimiterIdentity(
    identity,
    nowSeconds + PREVIEW_LIMITER_TTL_SECONDS,
    secret,
  );
  if (!token) return { token: null, setCookie: null };
  const attributes = [
    `${cookieName}=${token}`,
    "Path=/",
    `Max-Age=${PREVIEW_LIMITER_TTL_SECONDS}`,
    "HttpOnly",
    secure ? "Secure" : "",
    secure ? "SameSite=None" : "SameSite=Lax",
  ].filter(Boolean);
  return { token, setCookie: attributes.join("; ") };
}

/**
 * Web Preview requests stay on its own origin. This is not an open proxy:
 * only /api/ paths go to the fixed local API listener. Preserve Origin and
 * credentials so the API still performs its own CORS and resource checks.
 * Never buffer upload bodies or encrypted media responses in Metro.
 *
 * Anonymous media limiting is not authentication. The proxy gives each browser a signed,
 * HttpOnly, bounded-lifetime opaque bucket and removes all caller-provided forwarding/identity
 * headers. The API accepts that bucket only over this fixed loopback hop and only when the public
 * HTTP(S) context is configured there as well. Cookie clearing can create new buckets, so global
 * media capacity remains the backstop against deliberate anonymous edge abuse.
 */
function createPreviewApiProxy({
  port = 3000,
  timeoutMs = 30_000,
  publicOrigin = configuredPublicOrigin(),
  limiterSecret: explicitLimiterSecret,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  const publicProtocol = publicProtocolForOrigin(publicOrigin);
  const secret = limiterSecret(explicitLimiterSecret);

  return function previewApiProxy(req, res, next) {
    if (!req.url || !req.url.startsWith("/api/")) {
      next();
      return;
    }

    const limiter = issueLimiterIdentity(req, secret, publicProtocol, now());
    const headers = {
      ...endToEndHeaders(req.headers),
      host: `127.0.0.1:${port}`,
      "x-forwarded-proto": publicProtocol,
      [PREVIEW_PROXY_HEADER]: "1",
    };
    if (limiter.token) headers[PREVIEW_LIMITER_HEADER] = limiter.token;

    // The stable Preview gateway rebases both Host and its same-origin Origin
    // to the internal Metro listener. Restore only that exact paired value;
    // arbitrary origins still reach the API unchanged and are rejected there.
    if (
      publicOrigin &&
      req.headers.host === "127.0.0.1:8081" &&
      req.headers.origin === "http://127.0.0.1:8081"
    ) {
      headers.origin = publicOrigin;
    }

    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: req.method,
        path: req.url,
        headers,
      },
      (response) => {
        if (res.destroyed) {
          response.destroy();
          return;
        }
        const responseHeaders = endToEndHeaders(response.headers);
        if (limiter.setCookie) {
          const existing = responseHeaders["set-cookie"];
          responseHeaders["set-cookie"] = existing
            ? Array.isArray(existing)
              ? [...existing, limiter.setCookie]
              : [existing, limiter.setCookie]
            : limiter.setCookie;
        }
        res.writeHead(response.statusCode || 502, responseHeaders);
        response.on("error", () => res.destroy());
        response.pipe(res);
      },
    );

    upstream.setTimeout(timeoutMs, () => upstream.destroy());
    upstream.on("error", () => {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "1",
      });
      res.end(
        JSON.stringify({
          error: "The API is temporarily unavailable. Please reconnect.",
        }),
      );
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  };
}

module.exports = {
  PREVIEW_LIMITER_COOKIE_NAME,
  createPreviewApiProxy,
  signLimiterIdentity,
  verifyLimiterIdentity,
};
