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

function endToEndHeaders(headers) {
  const excluded = new Set(HOP_BY_HOP);
  for (const token of String(headers.connection || "").split(",")) {
    excluded.add(token.trim().toLowerCase());
  }
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !excluded.has(name.toLowerCase()),
    ),
  );
}

/**
 * Web Preview requests stay on its own origin. This is not an open proxy:
 * only /api/ paths go to the fixed local API listener. Preserve Origin and
 * credentials so the API still performs its own CORS and resource checks.
 * Never buffer upload bodies or encrypted media responses in Metro.
 */
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

function createPreviewApiProxy({
  port = 3000,
  timeoutMs = 30_000,
  publicOrigin = configuredPublicOrigin(),
  publicProtocol = publicOrigin?.startsWith("https:") ? "https" : "http",
} = {}) {
  return function previewApiProxy(req, res, next) {
    if (!req.url || !req.url.startsWith("/api/")) {
      next();
      return;
    }

    const headers = {
      ...endToEndHeaders(req.headers),
      host: `127.0.0.1:${port}`,
      "x-forwarded-proto": publicProtocol,
    };
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
        res.writeHead(
          response.statusCode || 502,
          endToEndHeaders(response.headers),
        );
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

module.exports = { createPreviewApiProxy };
