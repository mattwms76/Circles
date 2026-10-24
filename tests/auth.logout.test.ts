import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_SESSION_TTL_MS } from "../shared/const";
import { registerOAuthRoutes } from "../server/_core/oauth";
import { SDKServer, sdk } from "../server/_core/sdk";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import {
  APPLICATION_SESSION_COOKIE_NAME,
  getSessionCookieName,
} from "../server/_core/cookies";

const memory = vi.hoisted(() => {
  // Synthetic test-only values are set before the immutable ENV module imports.
  process.env.MANUS_PROJECT_ID = "circles-test-app";
  process.env.MANUS_JWT_SECRET =
    "synthetic-session-signing-secret-for-auth-logout-tests";
  process.env.MANUS_OAUTH_API_URL = "https://oauth.synthetic.invalid";
  process.env.FRONTEND_ORIGIN = "https://web.synthetic.invalid";

  type Stored = {
    sessionId: string;
    openId: string;
    appId: string;
    expiresAt: Date;
    revokedAt: Date | null;
  };

  const records = new Map<string, Stored>();
  let failReads = false;
  let failWrites = false;
  const fingerprint = (sessionId: string) =>
    createHash("sha256").update(sessionId, "utf8").digest("hex");

  return {
    records,
    fingerprint,
    reset() {
      records.clear();
      failReads = false;
      failWrites = false;
    },
    failReads(value: boolean) {
      failReads = value;
    },
    failWrites(value: boolean) {
      failWrites = value;
    },
    store: {
      async create(session: Omit<Stored, "revokedAt">) {
        if (failWrites)
          throw new Error("synthetic session store write failure");
        records.set(fingerprint(session.sessionId), {
          ...session,
          revokedAt: null,
        });
      },
      async findActive(
        binding: Pick<Stored, "sessionId" | "openId" | "appId">,
        now: Date,
      ) {
        if (failReads) throw new Error("synthetic session store read failure");
        const row = records.get(fingerprint(binding.sessionId));
        if (
          !row ||
          row.revokedAt ||
          row.expiresAt <= now ||
          row.openId !== binding.openId ||
          row.appId !== binding.appId
        ) {
          return null;
        }
        return { ...row };
      },
      async revoke(
        binding: Pick<Stored, "sessionId" | "openId" | "appId">,
        revokedAt: Date,
      ) {
        if (failWrites)
          throw new Error("synthetic session store write failure");
        const row = records.get(fingerprint(binding.sessionId));
        if (
          row &&
          row.openId === binding.openId &&
          row.appId === binding.appId
        ) {
          row.revokedAt = revokedAt;
        }
      },
    },
  };
});

vi.mock("../server/_core/application-sessions", () => ({
  applicationSessionStore: memory.store,
  fingerprintApplicationSession: memory.fingerprint,
}));

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(
  protocol: "https" | "http" = "https",
  headers: Record<string, string> = {},
): {
  ctx: TrpcContext;
  clearedCookies: CookieCall[];
} {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol,
      headers: {
        origin: "https://web.synthetic.invalid",
        ...headers,
      },
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

async function signedLegacyToken(): Promise<string> {
  return new SignJWT({
    openId: "legacy-user",
    appId: "circles-test-app",
    name: "Legacy User",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime("1h")
    .sign(
      new TextEncoder().encode(
        "synthetic-session-signing-secret-for-auth-logout-tests",
      ),
    );
}

async function startLogoutApp() {
  const app = express();
  registerOAuthRoutes(app);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe("auth.logout", () => {
  beforeEach(() => memory.reset());

  afterEach(() => vi.restoreAllMocks());

  it("clears both secure session cookies and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies.map((cookie) => cookie.name)).toEqual([
      "webdev_app_session",
      getSessionCookieName(ctx.req),
    ]);
    for (const cookie of clearedCookies) {
      expect(cookie.options).toMatchObject({
        secure: true,
        sameSite: "none",
        httpOnly: true,
        path: "/",
      });
      expect(cookie.options).not.toHaveProperty("maxAge");
      expect(cookie.options).not.toHaveProperty("domain");
    }
  });

  it("keeps plain-HTTP local logout cookies compatible", async () => {
    const { ctx, clearedCookies } = createAuthContext("http");
    const result = await appRouter.createCaller(ctx).auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies.map((cookie) => cookie.name)).toEqual([
      "webdev_app_session",
      getSessionCookieName(ctx.req),
    ]);
    for (const cookie of clearedCookies) {
      expect(cookie.options).toMatchObject({
        secure: false,
        sameSite: "lax",
        httpOnly: true,
        path: "/",
      });
      expect(cookie.options).not.toHaveProperty("maxAge");
    }
  });

  it("persists capped, hash-addressed sessions and fails closed for inactive or legacy credentials", async () => {
    const instance = new SDKServer(undefined, memory.store);
    const secondInstance = new SDKServer(undefined, memory.store);
    const issuedAt = Date.now();
    const token = await instance.createSessionToken("oauth-user", {
      name: "OAuth User",
      expiresInMs: APPLICATION_SESSION_TTL_MS * 2,
    });
    const [fingerprint, stored] = [...memory.records.entries()][0]!;

    await expect(secondInstance.verifySession(token)).resolves.toMatchObject({
      openId: "oauth-user",
      appId: "circles-test-app",
    });
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(
      issuedAt + APPLICATION_SESSION_TTL_MS + 1_000,
    );
    expect(fingerprint).not.toBe(stored.sessionId);

    memory.records.delete(fingerprint);
    await expect(instance.verifySession(token)).resolves.toBeNull();

    const expired = await instance.createSessionToken("expired-user", {
      name: "Expired User",
    });
    const [, expiredStored] = [...memory.records.entries()].find(
      ([, row]) => row.openId === "expired-user",
    )!;
    expiredStored.expiresAt = new Date(Date.now() - 1_000);
    await expect(instance.verifySession(expired)).resolves.toBeNull();

    const active = await instance.createSessionToken("active-user", {
      name: "Active User",
    });
    const [, activeStored] = [...memory.records.entries()].find(
      ([, row]) => row.openId === "active-user",
    )!;
    activeStored.openId = "other-user";
    await expect(instance.verifySession(active)).resolves.toBeNull();
    activeStored.openId = "active-user";
    activeStored.appId = "other-app";
    await expect(instance.verifySession(active)).resolves.toBeNull();
    activeStored.appId = "circles-test-app";
    activeStored.revokedAt = new Date();
    await expect(instance.verifySession(active)).resolves.toBeNull();
    activeStored.revokedAt = null;
    memory.failReads(true);
    await expect(instance.verifySession(active)).resolves.toBeNull();
    memory.failReads(false);

    await expect(
      instance.verifySession(await signedLegacyToken()),
    ).resolves.toBeNull();
    memory.failWrites(true);
    await expect(
      instance.createSessionToken("write-failure", { name: "No Token" }),
    ).rejects.toThrow("synthetic session store write failure");
  });

  it("revokes every distinct bearer, application-cookie, and fallback-cookie credential through tRPC", async () => {
    const bearer = await sdk.createSessionToken("bearer-user", {
      name: "Bearer",
    });
    const applicationCookie = await sdk.createSessionToken("cookie-user", {
      name: "Application Cookie",
    });
    const fallbackCookie = await sdk.createSessionToken("fallback-user", {
      name: "Fallback Cookie",
    });
    const fallbackName = getSessionCookieName({
      protocol: "http",
      headers: {},
    } as TrpcContext["req"]);
    const { ctx, clearedCookies } = createAuthContext("http", {
      authorization: `Bearer ${bearer}`,
      cookie: `${APPLICATION_SESSION_COOKIE_NAME}=${applicationCookie}; ${fallbackName}=${fallbackCookie}`,
    });

    await expect(appRouter.createCaller(ctx).auth.logout()).resolves.toEqual({
      success: true,
    });
    await expect(sdk.verifySession(bearer)).resolves.toBeNull();
    await expect(sdk.verifySession(applicationCookie)).resolves.toBeNull();
    await expect(sdk.verifySession(fallbackCookie)).resolves.toBeNull();
    expect(clearedCookies.map((cookie) => cookie.name)).toEqual([
      APPLICATION_SESSION_COOKIE_NAME,
      fallbackName,
    ]);
  });

  it("revokes all REST-presented credentials and reports durable write failures while still clearing cookies", async () => {
    const bearer = await sdk.createSessionToken("rest-bearer", {
      name: "Bearer",
    });
    const applicationCookie = await sdk.createSessionToken("rest-cookie", {
      name: "Application Cookie",
    });
    const fallbackCookie = await sdk.createSessionToken("rest-fallback", {
      name: "Fallback Cookie",
    });
    const fallbackName = getSessionCookieName({
      protocol: "http",
      headers: {},
    } as TrpcContext["req"]);
    const { server, url } = await startLogoutApp();

    try {
      const response = await fetch(`${url}/api/auth/logout`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          cookie: `${APPLICATION_SESSION_COOKIE_NAME}=${applicationCookie}; ${fallbackName}=${fallbackCookie}`,
        },
      });
      expect(response.status).toBe(200);
      await expect(sdk.verifySession(bearer)).resolves.toBeNull();
      await expect(sdk.verifySession(applicationCookie)).resolves.toBeNull();
      await expect(sdk.verifySession(fallbackCookie)).resolves.toBeNull();

      const failure = await sdk.createSessionToken("rest-failure", {
        name: "Failure",
      });
      memory.failWrites(true);
      const failedResponse = await fetch(`${url}/api/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${failure}` },
      });
      expect(failedResponse.status).toBe(503);
      await expect(failedResponse.json()).resolves.toEqual({
        error: "Logout is temporarily unavailable",
      });
      const cleared = failedResponse.headers.get("set-cookie") ?? "";
      expect(cleared).toContain(`${APPLICATION_SESSION_COOKIE_NAME}=`);
      expect(cleared).toContain(`${fallbackName}=`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects origin-less cookie logout in REST and tRPC without revoking that browser session", async () => {
    const browserCookie = await sdk.createSessionToken("cookie-only", {
      name: "Cookie only",
    });
    const fallbackName = getSessionCookieName({
      protocol: "http",
      headers: {},
    } as TrpcContext["req"]);
    const { server, url } = await startLogoutApp();
    try {
      const response = await fetch(`${url}/api/auth/logout`, {
        method: "POST",
        headers: {
          cookie: `${APPLICATION_SESSION_COOKIE_NAME}=${browserCookie}; ${fallbackName}=${browserCookie}`,
        },
      });
      expect(response.status).toBe(403);
      await expect(sdk.verifySession(browserCookie)).resolves.not.toBeNull();

      const { ctx } = createAuthContext("http", {
        cookie: `${APPLICATION_SESSION_COOKIE_NAME}=${browserCookie}`,
      });
      delete ctx.req.headers.origin;
      await expect(
        appRouter.createCaller(ctx).auth.logout(),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(sdk.verifySession(browserCookie)).resolves.not.toBeNull();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("does not report tRPC logout success when durable revocation fails", async () => {
    const token = await sdk.createSessionToken("trpc-failure", {
      name: "Failure",
    });
    memory.failWrites(true);
    const { ctx, clearedCookies } = createAuthContext("http", {
      authorization: `Bearer ${token}`,
    });

    await expect(appRouter.createCaller(ctx).auth.logout()).rejects.toThrow(
      "synthetic session store write failure",
    );
    expect(clearedCookies.map((cookie) => cookie.name)).toEqual([
      APPLICATION_SESSION_COOKIE_NAME,
      getSessionCookieName(ctx.req),
    ]);
  });
});
