import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApiServer } from "../server/_core/index";

let server: Server;
let origin: string;
beforeAll(async () => {
  const instance = createApiServer();
  server = instance.server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("isolated test listener unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("full API email credential ingress", () => {
  const marker = "synthetic-body-must-not-render";
  const scenarios: {
    name: string;
    headers: Record<string, string>;
    body: string;
    status: number;
  }[] = [
    {
      name: "foreign origin",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.example",
      },
      body: JSON.stringify({
        email: "synthetic@example.test",
        password: marker,
        client: "native",
      }),
      status: 403,
    },
    {
      name: "malformed JSON",
      headers: { "Content-Type": "application/json" },
      body: `{"password":"${marker}",`,
      status: 400,
    },
    {
      name: "oversized JSON",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: marker.repeat(200) }),
      status: 413,
    },
    {
      name: "non-JSON credentials",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${marker}`,
      status: 415,
    },
  ];
  for (const scenario of scenarios) {
    it(`rejects ${scenario.name} with the exact bounded no-store envelope`, async () => {
      const response = await fetch(`${origin}/api/auth/email/sign-in`, {
        method: "POST",
        headers: scenario.headers,
        body: scenario.body,
        redirect: "error",
      });
      expect(response.status).toBe(scenario.status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      const text = await response.text();
      expect(text).not.toContain(marker);
      expect(JSON.parse(text)).toEqual({
        error: "Email authentication request was not accepted",
        code: "REQUEST_NOT_ACCEPTED",
      });
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });
  }
});
