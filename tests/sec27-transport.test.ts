import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import {
  API_MAX_CREDENTIAL_HEADER_BYTES,
  API_MAX_URI_BYTES,
  API_SOCIAL_UPLOAD_BODY_BYTES,
  API_STANDARD_BODY_BYTES,
  TRPC_MAX_BATCH_SIZE,
  TransportAdmission,
  apiBodyLimitForPath,
  createApiServer,
} from "../server/_core/index";
import {
  isTrustedExternalProxyRequest,
  parseTrustedProxyPolicy,
  PREVIEW_PROXY_HEADER,
} from "../server/_core/runtimeSecurity";

let server: Server;
let origin: string;

beforeAll(async () => {
  const instance = createApiServer();
  server = instance.server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("isolated transport listener unavailable");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

afterEach(() => vi.unstubAllEnvs());

describe("SEC27 bounded transport boundary", () => {
  it("uses finite client/server batching and preserves the 20 MiB encrypted-upload envelope only at its exact path", async () => {
    const clientSource = await readFile(
      new URL("../lib/trpc.ts", import.meta.url),
      "utf8",
    );
    expect(clientSource).toContain(
      `TRPC_CLIENT_MAX_BATCH_ITEMS = ${TRPC_MAX_BATCH_SIZE}`,
    );
    expect(clientSource).toContain("TRPC_CLIENT_MAX_URL_LENGTH = 2_048");
    expect(clientSource).toContain("maxItems: TRPC_CLIENT_MAX_BATCH_ITEMS");
    expect(clientSource).toContain("maxURLLength: TRPC_CLIENT_MAX_URL_LENGTH");
    expect(apiBodyLimitForPath("/api/trpc/social.upload")).toBe(
      API_SOCIAL_UPLOAD_BODY_BYTES,
    );
    expect(apiBodyLimitForPath("/api/trpc/social.upload,platform.status")).toBe(
      API_STANDARD_BODY_BYTES,
    );
  });

  it("rejects a local tRPC batch above the server count before procedure admission", async () => {
    const paths = Array.from(
      { length: TRPC_MAX_BATCH_SIZE + 1 },
      () => "platform.status",
    ).join(",");
    const response = await fetch(
      `${origin}/api/trpc/${paths}?batch=1&input=%7B%7D`,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const payload = await response.json();
    expect(JSON.stringify(payload)).toContain(
      "Batch call exceeds maximum size",
    );
  });

  it("rejects an oversized target and overlong bearer header before a parser or route can run", async () => {
    const target = `${origin}/api/health?x=${"a".repeat(API_MAX_URI_BYTES)}`;
    const tooLongTarget = await fetch(target);
    expect(tooLongTarget.status).toBe(414);
    expect(await tooLongTarget.json()).toEqual({
      error: "Request was not accepted",
    });

    const overlongBearer = await fetch(`${origin}/api/health`, {
      headers: {
        Authorization: `Bearer ${"a".repeat(API_MAX_CREDENTIAL_HEADER_BYTES)}`,
      },
    });
    expect(overlongBearer.status).toBe(431);
    expect(await overlongBearer.json()).toEqual({
      error: "Request was not accepted",
    });
  });

  it("returns a fixed no-store parser rejection without reflecting malformed request bytes", async () => {
    const marker = "sec27-malformed-body-must-not-reflect";
    const response = await fetch(`${origin}/api/trpc/platform.status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: `{"marker":"${marker}",`,
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await response.text();
    expect(body).not.toContain(marker);
    expect(JSON.parse(body)).toEqual({ error: "Request was not accepted" });
  });

  it("sets API headers and public aggregate readiness without X-Frame-Options or frame-ancestors", async () => {
    const health = await fetch(`${origin}/api/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("x-powered-by")).toBeNull();
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("referrer-policy")).toBe("no-referrer");
    expect(health.headers.get("cache-control")).toBe("private, no-store");
    expect(health.headers.get("strict-transport-security")).toBeNull();
    expect(health.headers.get("x-frame-options")).toBeNull();
    expect(health.headers.get("content-security-policy")).toBeNull();

    const ready = await fetch(`${origin}/api/ready`);
    expect([200, 503]).toContain(ready.status);
    expect(await ready.json()).toEqual({
      ok: ready.status === 200,
      liveRelay: false,
      liveReady: false,
      mediaUploadBudget: false,
      mediaUploadReady: false,
    });
  });

  it("emits HSTS only for the owned verified Preview contract while retaining Preview iframe compatibility", async () => {
    vi.stubEnv("EXPO_WEB_PREVIEW_URL", "https://preview.example.test");
    const response = await fetch(`${origin}/api/health`, {
      headers: {
        [PREVIEW_PROXY_HEADER]: "1",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("requires an exact non-loopback CIDR, one trusted socket hop, and one forwarded client address", () => {
    const policy = parseTrustedProxyPolicy("10.24.8.0/24");
    expect(policy?.trustsAddress("10.24.8.42")).toBe(true);
    expect(policy?.trustsAddress("10.24.9.42")).toBe(false);
    const trustedRequest = {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": "198.51.100.23",
      },
      socket: { remoteAddress: "10.24.8.42" },
    };
    expect(
      isTrustedExternalProxyRequest(trustedRequest as never, "https", policy),
    ).toBe(true);
    expect(
      isTrustedExternalProxyRequest(
        {
          ...trustedRequest,
          headers: {
            ...trustedRequest.headers,
            "x-forwarded-for": "198.51.100.23, 198.51.100.24",
          },
        } as never,
        "https",
        policy,
      ),
    ).toBe(false);
    expect(() => parseTrustedProxyPolicy("0.0.0.0/0")).toThrow(
      "Trusted proxy policy is invalid",
    );
    expect(() => parseTrustedProxyPolicy("127.0.0.1/32")).toThrow(
      "Trusted proxy policy is invalid",
    );
    expect(() => parseTrustedProxyPolicy("::/64")).toThrow(
      "Trusted proxy policy is invalid",
    );
    expect(() => parseTrustedProxyPolicy("0:0:0:0:0:ffff:7f00:1/128")).toThrow(
      "Trusted proxy policy is invalid",
    );
  });

  it("bounds process-local rate and concurrent social-upload admission and releases exactly once on cleanup", () => {
    const admission = new TransportAdmission();
    const firstUpload = admission.tryAcquire(
      "ip:198.51.100.24",
      "socialUpload",
      1,
    );
    expect(firstUpload.kind).toBe("allowed");
    const blockedConcurrentUpload = admission.tryAcquire(
      "ip:198.51.100.24",
      "socialUpload",
      2,
    );
    expect(blockedConcurrentUpload).toMatchObject({ kind: "rejected" });
    if (firstUpload.kind === "allowed") {
      firstUpload.release();
      firstUpload.release();
    }
    expect(
      admission.tryAcquire("ip:198.51.100.24", "socialUpload", 3).kind,
    ).toBe("allowed");

    let last = admission.tryAcquire("ip:198.51.100.25", "standard", 10);
    for (let count = 1; count < 120; count += 1) {
      if (last.kind === "allowed") last.release();
      last = admission.tryAcquire("ip:198.51.100.25", "standard", 10 + count);
    }
    if (last.kind === "allowed") last.release();
    expect(
      admission.tryAcquire("ip:198.51.100.25", "standard", 200),
    ).toMatchObject({
      kind: "rejected",
      retryAfterSeconds: expect.any(Number),
    });
  });
});
