import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_AUTH_JSON_BODY_LIMIT,
  EmailAuthThrottle,
  getEmailAuthStatus,
  isEmailAuthEnabled,
  registerEmailAuthRoutes,
} from "../server/_core/email-auth";
import {
  EmailIdentityLinkRequiredError,
  type LinkedEmailIdentity,
  type VerifiedEmailIdentity,
} from "../server/_core/email-identity";

const syntheticPublishableKey = [
  "sb",
  "publishable",
  "synthetic",
  "email",
  "auth",
  "test",
  "key",
  "12345",
].join("_");

const environment = {
  CIRCLES_EMAIL_AUTH_ENABLED: "true",
  SUPABASE_AUTH_URL: "https://vvclcsqletcxzoaayqzq.supabase.co",
  SUPABASE_AUTH_PUBLISHABLE_KEY: syntheticPublishableKey,
  FRONTEND_ORIGIN: "https://web.synthetic.invalid",
} as unknown as NodeJS.ProcessEnv;

const verified: VerifiedEmailIdentity = {
  subject: "4a8b4821-a2bf-4a84-8dd7-e9f2723e5eb1",
  email: "member@example.test",
  name: "Member",
};
const linked: LinkedEmailIdentity = {
  userId: 19,
  openId: `supabase:${verified.subject}`,
  name: "Member",
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function providerFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/settings")) {
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      return response({ external: { email: true } });
    }
    if (url.includes("/auth/v1/token?grant_type=password")) {
      return response({
        access_token: "provider-access-token-never-returned-to-client",
      });
    }
    if (url.endsWith("/auth/v1/user")) {
      return response({
        id: verified.subject,
        email: verified.email,
        email_confirmed_at: "2026-10-26T00:00:00.000Z",
        identities: [{ provider: "email" }],
        user_metadata: { full_name: "Member" },
      });
    }
    if (url.endsWith("/auth/v1/signup")) {
      expect(init?.method).toBe("POST");
      return response({
        id: "must-not-reach-client",
        access_token: "must-not-reach-client",
      });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const identityStore = {
    isReady: vi.fn(async () => true),
    resolveForSignIn: vi.fn(async () => linked),
    linkToExistingUser: vi.fn(async () => linked),
  };
  const sdkServer = {
    authenticateRequest: vi.fn(async () => ({
      id: 19,
      openId: linked.openId,
      name: "Member",
    })),
    createSessionToken: vi.fn(async () => "circles-durable-session-token"),
  };
  return {
    fetchImpl: providerFetch(),
    identityStore,
    sdkServer,
    environment,
    throttle: new EmailAuthThrottle(),
    ...overrides,
  };
}

async function start(overrides: Record<string, unknown> = {}): Promise<{
  server: ReturnType<express.Express["listen"]>;
  baseUrl: string;
  dependencies: ReturnType<typeof dependencies>;
}> {
  const app = express();
  app.use(express.json({ limit: EMAIL_AUTH_JSON_BODY_LIMIT }));
  const routeDependencies = dependencies(overrides);
  registerEmailAuthRoutes(app, routeDependencies);
  const server = await new Promise<ReturnType<express.Express["listen"]>>(
    (resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    },
  );
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    dependencies: routeDependencies,
  };
}

async function close(server: ReturnType<express.Express["listen"]>) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function post(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const payload = JSON.stringify(body);
  return new Promise<Response>((resolve, reject) => {
    const request = httpRequest(
      new URL(path, baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload)),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode,
              headers: response.headers as HeadersInit,
            }),
          ),
        );
      },
    );
    request.once("error", reject);
    request.end(payload);
  });
}

describe("email/password REST server contract", () => {
  const priorEnvironment = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.FRONTEND_ORIGIN = "https://web.synthetic.invalid";
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, priorEnvironment);
  });

  it("returns the exact disabled/unready status shape without guessing provider availability", async () => {
    const disabled = { ...environment, CIRCLES_EMAIL_AUTH_ENABLED: "false" };
    const { server, baseUrl } = await start({ environment: disabled });
    try {
      const result = await fetch(`${baseUrl}/api/auth/email/status`);
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({
        enabled: false,
        ready: false,
        emailEnabled: false,
        googleEnabled: false,
        confirmationRequired: true,
      });
    } finally {
      await close(server);
    }
  });

  it("fails closed when the private mapping store is absent", async () => {
    const identityStore = {
      isReady: vi.fn(async () => false),
      resolveForSignIn: vi.fn(),
      linkToExistingUser: vi.fn(),
    };
    const { server, baseUrl } = await start({ identityStore });
    try {
      const result = await fetch(`${baseUrl}/api/auth/email/status`);
      expect(await result.json()).toEqual({
        enabled: true,
        ready: false,
        emailEnabled: false,
        googleEnabled: false,
        confirmationRequired: true,
      });
    } finally {
      await close(server);
    }
  });

  it("exports disabled-safe readiness helpers and caches the bounded provider settings probe", async () => {
    const fetchImpl = providerFetch();
    const identityStore = {
      isReady: vi.fn(async () => true),
      resolveForSignIn: vi.fn(async () => linked),
      linkToExistingUser: vi.fn(async () => linked),
    };
    const disabled = {
      ...environment,
      CIRCLES_EMAIL_AUTH_ENABLED: "false",
    } as NodeJS.ProcessEnv;
    expect(isEmailAuthEnabled(disabled)).toBe(false);
    await expect(
      getEmailAuthStatus({
        environment: disabled,
        fetchImpl,
        identityStore,
      }),
    ).resolves.toEqual({
      enabled: false,
      ready: false,
      emailEnabled: false,
      googleEnabled: false,
      confirmationRequired: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      getEmailAuthStatus({
        environment,
        fetchImpl,
        identityStore,
        now: () => 10,
      }),
    ).resolves.toMatchObject({
      enabled: true,
      ready: true,
      emailEnabled: true,
    });
    await expect(
      getEmailAuthStatus({
        environment,
        fetchImpl,
        identityStore,
        now: () => 11,
      }),
    ).resolves.toMatchObject({
      enabled: true,
      ready: true,
      emailEnabled: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects browser CSRF/origin and native Sec-Fetch metadata before the provider", async () => {
    const { server, baseUrl, dependencies: wired } = await start();
    try {
      const browser = await post(
        baseUrl,
        "/api/auth/email/sign-in",
        { email: verified.email, password: " correct horse ", client: "web" },
        { Origin: "https://evil.invalid" },
      );
      expect(browser.status).toBe(403);
      expect(await browser.json()).toEqual({
        error: "Email authentication request was not accepted",
        code: "REQUEST_NOT_ACCEPTED",
      });

      const forgedNative = await post(
        baseUrl,
        "/api/auth/email/sign-in",
        { email: verified.email, password: "correct horse", client: "native" },
        { "Sec-Fetch-Site": "cross-site" },
      );
      expect(forgedNative.status).toBe(403);
      expect(wired.fetchImpl).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it("validates a provider /user identity, preserves password spaces, and returns only an own native session", async () => {
    const { server, baseUrl, dependencies: wired } = await start();
    try {
      const result = await post(baseUrl, "/api/auth/email/sign-in", {
        email: "Member@Example.Test",
        password: " secret with surrounding spaces ",
        client: "native",
      });
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({
        success: true,
        sessionToken: "circles-durable-session-token",
      });
      expect(result.headers.get("set-cookie")).toBeNull();
      expect(wired.identityStore.resolveForSignIn).toHaveBeenCalledWith(
        verified,
      );
      expect(wired.sdkServer.createSessionToken).toHaveBeenCalledWith(
        linked.openId,
        expect.any(Object),
      );
      const tokenCall = wired.fetchImpl.mock.calls[0];
      expect(JSON.parse(String(tokenCall[1]?.body))).toEqual({
        email: verified.email,
        password: " secret with surrounding spaces ",
      });
      expect(String(tokenCall[0])).toBe(
        "https://vvclcsqletcxzoaayqzq.supabase.co/auth/v1/token?grant_type=password",
      );
      expect(wired.fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({
        authorization: "Bearer provider-access-token-never-returned-to-client",
      });
    } finally {
      await close(server);
    }
  });

  it("uses an HttpOnly browser cookie and never includes the own session token in web JSON", async () => {
    const { server, baseUrl } = await start();
    try {
      const result = await post(
        baseUrl,
        "/api/auth/email/sign-in",
        { email: verified.email, password: "password", client: "web" },
        {
          Origin: "https://web.synthetic.invalid",
          "Sec-Fetch-Site": "same-site",
        },
      );
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ success: true });
      const cookie = result.headers.get("set-cookie") ?? "";
      expect(cookie).toContain(
        "webdev_app_session=circles-durable-session-token",
      );
      expect(cookie).toContain("HttpOnly");
      expect(cookie).not.toContain("provider-access-token");
    } finally {
      await close(server);
    }
  });

  it("keeps sign-up generic and confirmation-only even when the provider returns a duplicate-like error", async () => {
    const fetchImpl = providerFetch();
    fetchImpl.mockImplementation(async (input) => {
      if (String(input).endsWith("/auth/v1/signup")) {
        return response(
          { message: "User already registered", id: "leak" },
          400,
        );
      }
      throw new Error("unexpected provider call");
    });
    const { server, baseUrl } = await start({ fetchImpl });
    try {
      const result = await post(
        baseUrl,
        "/api/auth/email/sign-up",
        { email: verified.email, password: "password" },
        {
          Origin: "https://web.synthetic.invalid",
          "Sec-Fetch-Site": "same-site",
        },
      );
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({
        success: true,
        confirmationRequired: true,
      });
      expect(result.headers.get("set-cookie")).toBeNull();
    } finally {
      await close(server);
    }
  });

  it("names an undeliverable sign-up address without returning the provider body", async () => {
    const fetchImpl = providerFetch();
    fetchImpl.mockImplementation(async (input) => {
      if (String(input).endsWith("/auth/v1/signup")) {
        return response(
          {
            error_code: "email_address_invalid",
            msg: "Email address circles-preview-auth@example.test is invalid",
            access_token: "must-not-reach-client",
          },
          400,
        );
      }
      throw new Error("unexpected provider call");
    });
    const { server, baseUrl } = await start({ fetchImpl });
    try {
      const result = await post(
        baseUrl,
        "/api/auth/email/sign-up",
        { email: verified.email, password: "password" },
        {
          Origin: "https://web.synthetic.invalid",
          "Sec-Fetch-Site": "same-site",
        },
      );
      expect(result.status).toBe(400);
      expect(await result.json()).toEqual({
        error: "Enter a valid email address.",
        code: "INVALID_EMAIL",
      });
      expect(result.headers.get("set-cookie")).toBeNull();
    } finally {
      await close(server);
    }
  });

  it("derives connect authority from sdk.authenticateRequest and refuses cross-account provider links", async () => {
    const identityStore = {
      isReady: vi.fn(async () => true),
      resolveForSignIn: vi.fn(async () => linked),
      linkToExistingUser: vi.fn(async () => {
        throw new EmailIdentityLinkRequiredError();
      }),
    };
    const {
      server,
      baseUrl,
      dependencies: wired,
    } = await start({ identityStore });
    try {
      const result = await post(baseUrl, "/api/auth/email/connect", {
        email: verified.email,
        password: "password",
        client: "native",
        userId: 999,
      });
      // Extra caller identity fields are rejected before provider access.
      expect(result.status).toBe(401);
      expect(await result.json()).toEqual({
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
      expect(wired.sdkServer.authenticateRequest).not.toHaveBeenCalled();

      const conflict = await post(baseUrl, "/api/auth/email/connect", {
        email: verified.email,
        password: "password",
        client: "native",
      });
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({
        error: "Email identity requires account linking",
        code: "LINK_REQUIRED",
      });
      expect(wired.sdkServer.authenticateRequest).toHaveBeenCalledOnce();
      expect(identityStore.linkToExistingUser).toHaveBeenCalledWith(
        verified,
        19,
      );
    } finally {
      await close(server);
    }
  });

  it("sends a generic password reset and does not mint a session", async () => {
    const fetchImpl = providerFetch();
    fetchImpl.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/recover")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "missing@example.test",
        });
        return response(
          { access_token: "must-not-reach-client", message: "user not found" },
          400,
        );
      }
      throw new Error(`Unexpected provider request: ${url}`);
    });
    const {
      server,
      baseUrl,
      dependencies: wired,
    } = await start({
      fetchImpl,
    });
    try {
      const unknown = await post(baseUrl, "/api/auth/email/password-reset", {
        email: "missing@example.test",
        client: "native",
      });
      expect(unknown.status).toBe(200);
      expect(await unknown.json()).toEqual({ success: true });
      expect(unknown.headers.get("set-cookie")).toBeNull();
      expect(wired.sdkServer.createSessionToken).not.toHaveBeenCalled();

      fetchImpl.mockImplementation(async (input) => {
        if (String(input).endsWith("/auth/v1/recover")) {
          return response({ message: "slow down" }, 429);
        }
        throw new Error(`Unexpected provider request: ${String(input)}`);
      });
      const limited = await post(baseUrl, "/api/auth/email/password-reset", {
        email: "other@example.test",
        client: "native",
      });
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({
        error: "Too many email authentication attempts",
        code: "RATE_LIMITED",
      });

      fetchImpl.mockImplementation(async (input) => {
        if (String(input).endsWith("/auth/v1/recover")) {
          return response({ message: "upstream" }, 503);
        }
        throw new Error(`Unexpected provider request: ${String(input)}`);
      });
      const unavailable = await post(
        baseUrl,
        "/api/auth/email/password-reset",
        { email: "third@example.test", client: "native" },
      );
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({
        error: "Email authentication is temporarily unavailable",
        code: "UNAVAILABLE",
      });

      const extra = await post(baseUrl, "/api/auth/email/password-reset", {
        email: "third@example.test",
        client: "native",
        password: "must-not-be-accepted",
      });
      expect(extra.status).toBe(401);
      expect(wired.sdkServer.createSessionToken).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it("bounds attempts by IP plus hashed email rather than retaining email addresses", () => {
    const throttle = new EmailAuthThrottle();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(throttle.checkAndRecord("127.0.0.1:hashed", 1)).toBe(true);
    }
    expect(throttle.checkAndRecord("127.0.0.1:hashed", 1)).toBe(false);
    expect(throttle.size()).toBe(1);
  });
});
