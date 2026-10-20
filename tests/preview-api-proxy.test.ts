import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  createServer,
  request,
  type Server,
  type RequestListener,
} from "node:http";

const { createPreviewApiProxy } = createRequire(import.meta.url)(
  "../scripts/preview-api-proxy.cjs",
);
const servers: Server[] = [];

async function listen(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function proxyFor(port: number, publicProtocol = "https") {
  const proxy = createPreviewApiProxy({
    port,
    publicProtocol,
    publicOrigin: "https://preview.example.test",
    timeoutMs: 1000,
  });
  return listen((req, res) => {
    proxy(req, res, () => {
      res.writeHead(404);
      res.end("not an API path");
    });
  });
}

afterEach(async () => {
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

describe("same-origin Preview API proxy", () => {
  it("restores only the exact paired origin rewritten by the Preview gateway", async () => {
    const api = await listen((req, res) => res.end(String(req.headers.origin)));
    const proxy = await proxyFor(api.port);
    const readOrigin = (origin: string) =>
      new Promise<string>((resolve, reject) => {
        const req = request(
          `${proxy.url}/api/health`,
          {
            headers: { Host: "127.0.0.1:8081", Origin: origin },
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => resolve(body));
            res.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end();
      });
    expect(await readOrigin("http://127.0.0.1:8081")).toBe(
      "https://preview.example.test",
    );
    expect(await readOrigin("http://127.0.0.1:9090")).toBe(
      "http://127.0.0.1:9090",
    );
    const wrongHost = await fetch(`${proxy.url}/api/health`, {
      headers: { Origin: "http://127.0.0.1:8081" },
    });
    expect(await wrongHost.text()).toBe("http://127.0.0.1:8081");
  });

  it("preserves query, credentials, Origin, streaming body, status and host-only cookies", async () => {
    const api = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        res.writeHead(201, {
          "Content-Type": "application/json",
          "Set-Cookie": [
            "session=test-only; Path=/; HttpOnly; Secure; SameSite=None",
          ],
        });
        res.end(
          JSON.stringify({
            path: req.url,
            method: req.method,
            origin: req.headers.origin,
            cookie: req.headers.cookie,
            authorization: req.headers.authorization,
            protocol: req.headers["x-forwarded-proto"],
            host: req.headers.host,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      });
    });
    const proxy = await proxyFor(api.port);
    const response = await fetch(`${proxy.url}/api/test?batch=1&state=a%2Bb`, {
      method: "POST",
      headers: {
        Origin: "https://preview.example.test",
        Cookie: "session=test-only",
        Authorization: "Bearer test-only",
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "http",
      },
      body: JSON.stringify({ text: "unchanged" }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBe(
      "session=test-only; Path=/; HttpOnly; Secure; SameSite=None",
    );
    expect(await response.json()).toEqual({
      path: "/api/test?batch=1&state=a%2Bb",
      method: "POST",
      origin: "https://preview.example.test",
      cookie: "session=test-only",
      authorization: "Bearer test-only",
      protocol: "https",
      host: `127.0.0.1:${api.port}`,
      body: JSON.stringify({ text: "unchanged" }),
    });
  });

  it("streams protected range responses without losing range headers", async () => {
    const api = await listen((req, res) => {
      expect(req.headers.range).toBe("bytes=1-3");
      res.writeHead(206, {
        "Content-Type": "video/mp4",
        "Content-Range": "bytes 1-3/10",
        "Accept-Ranges": "bytes",
      });
      res.write("ab");
      res.end("c");
    });
    const proxy = await proxyFor(api.port);
    const response = await fetch(`${proxy.url}/api/media/test`, {
      headers: { Range: "bytes=1-3" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-3/10");
    expect(await response.text()).toBe("abc");
  });

  it("does not intercept non-API routes or proxy caller-selected destinations", async () => {
    let calls = 0;
    const api = await listen((_req, res) => {
      calls++;
      res.end("fixed API");
    });
    const proxy = await proxyFor(api.port);
    for (const path of [
      "/",
      "/api-other",
      "/https://evil.example.test",
      "//evil.example.test/",
    ]) {
      expect((await fetch(proxy.url + path)).status).toBe(404);
    }
    const response = await fetch(
      `${proxy.url}/api/test?target=https://evil.example.test`,
    );
    expect(await response.text()).toBe("fixed API");
    expect(calls).toBe(1);
  });

  it("keeps upstream origin rejection intact", async () => {
    const api = await listen((req, res) => {
      expect(req.headers.origin).toBe("https://evil.example.test");
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "origin_not_allowed" }));
    });
    const proxy = await proxyFor(api.port);
    const response = await fetch(`${proxy.url}/api/test`, {
      headers: { Origin: "https://evil.example.test" },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
  });

  it("uses plain HTTP only for an explicitly local runtime", async () => {
    const api = await listen((req, res) =>
      res.end(String(req.headers["x-forwarded-proto"])),
    );
    const proxy = await proxyFor(api.port, "http");
    const response = await fetch(`${proxy.url}/api/health`, {
      headers: { "X-Forwarded-Proto": "https" },
    });
    expect(await response.text()).toBe("http");
  });

  it("returns a retryable JSON error when the API listener is unavailable", async () => {
    const api = await listen((_req, res) => res.end("unused"));
    await new Promise<void>((resolve) => api.server.close(() => resolve()));
    const proxy = await proxyFor(api.port);
    const response = await fetch(`${proxy.url}/api/health`);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "The API is temporarily unavailable. Please reconnect.",
    });
  });
});
