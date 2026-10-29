import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CIRCLES_NATIVE_OAUTH_REDIRECT_URI } from "../shared/oauth-redirect-contract";
import { encodeOAuthState, registerOAuthRoutes } from "../server/_core/oauth";
import { SESSION_COOKIE_SUFFIX } from "../shared/const";

const mocks = vi.hoisted(() => {
  // Synthetic test-only settings; no deployment configuration is read.
  process.env.MANUS_PROJECT_ID = "cba15-oauth-cookie-issuance";
  process.env.MANUS_JWT_SECRET =
    "cba15-synthetic-oauth-cookie-issuance-signing-secret";
  process.env.MANUS_OAUTH_PORTAL_URL = "https://oauth.synthetic.invalid";
  process.env.FRONTEND_ORIGIN = "https://web.synthetic.invalid";

  return {
    authenticateRequest: vi.fn(),
    consumeNative: vi.fn(),
    createSessionToken: vi.fn(),
    exchangeCodeForToken: vi.fn(),
    getUserByOpenId: vi.fn(),
    getUserInfo: vi.fn(),
    upsertUser: vi.fn(),
  };
});

vi.mock("../server/_core/oauth-pending-state", () => ({
  oauthPendingStateStore: {
    consumeNative: mocks.consumeNative,
    consumeWeb: vi.fn(),
    createNative: vi.fn(),
    createWeb: vi.fn(),
  },
}));

vi.mock("../server/_core/sdk", () => ({
  sdk: {
    authenticateRequest: mocks.authenticateRequest,
    createSessionToken: mocks.createSessionToken,
    exchangeCodeForToken: mocks.exchangeCodeForToken,
    getUserInfo: mocks.getUserInfo,
    revokeRequestSessions: vi.fn(),
    verifySession: vi.fn(),
  },
}));

vi.mock("../server/db", () => ({
  getUserByOpenId: mocks.getUserByOpenId,
  upsertUser: mocks.upsertUser,
}));

const nonce = "N4s1a7B9cD2eF5gH8jK0mN3pQ6rT9vW1yZ4_AbCdEfG";
const flowToken = "native-flow-token-abcdefghijklmnopqrstuvwxyz";

async function startOAuthApp() {
  const app = express();
  registerOAuthRoutes(app);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

async function close(server: ReturnType<express.Express["listen"]>) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("CBA-15 OAuth session cookie issuance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({
      id: 9,
      openId: "cba15-user",
      name: "CBA-15 User",
      email: null,
      loginMethod: "manus",
      lastSignedIn: new Date("2026-10-29T00:00:00.000Z"),
    });
    mocks.exchangeCodeForToken.mockResolvedValue({ accessToken: "synthetic" });
    mocks.getUserInfo.mockResolvedValue({
      openId: "cba15-user",
      name: "CBA-15 User",
    });
    mocks.getUserByOpenId.mockResolvedValue({
      id: 9,
      openId: "cba15-user",
      name: "CBA-15 User",
      email: null,
      loginMethod: "manus",
      lastSignedIn: new Date("2026-10-29T00:00:00.000Z"),
    });
    mocks.createSessionToken.mockResolvedValue("native-bearer-token");
    mocks.upsertUser.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("issues only the distinct loopback browser cookie from the OAuth session bridge", async () => {
    const { server, url } = await startOAuthApp();
    try {
      const response = await fetch(`${url}/api/auth/session`, {
        method: "POST",
        headers: { authorization: "Bearer browser-bridge-token" },
      });

      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain(
        `manus_local_session_${SESSION_COOKIE_SUFFIX}=browser-bridge-token`,
      );
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).not.toContain("webdev_app_session=");
      expect(mocks.authenticateRequest).toHaveBeenCalledTimes(1);
    } finally {
      await close(server);
    }
  });

  it("returns the native durable bearer without also issuing a browser cookie", async () => {
    const state = encodeOAuthState({
      redirectUri: CIRCLES_NATIVE_OAUTH_REDIRECT_URI,
      nonce,
    });
    mocks.consumeNative.mockResolvedValueOnce({
      redirectUri: CIRCLES_NATIVE_OAUTH_REDIRECT_URI,
      nonce,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { server, url } = await startOAuthApp();
    try {
      const response = await fetch(
        `${url}/api/oauth/mobile?code=synthetic-code&state=${encodeURIComponent(state)}`,
        { headers: { "x-manus-oauth-flow": flowToken } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        app_session_id: "native-bearer-token",
        user: { id: 9, openId: "cba15-user" },
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    } finally {
      await close(server);
    }
  });
});
