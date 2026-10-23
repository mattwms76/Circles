import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CIRCLES_NATIVE_OAUTH_REDIRECT_URI } from "../shared/oauth-redirect-contract";
import { encodeOAuthState, registerOAuthRoutes } from "../server/_core/oauth";

const mocks = vi.hoisted(() => {
  process.env.MANUS_PROJECT_ID = "circles-oauth-security-test";
  process.env.MANUS_JWT_SECRET =
    "synthetic-oauth-cookie-signing-secret-for-security-tests";
  process.env.MANUS_OAUTH_PORTAL_URL = "https://oauth.synthetic.invalid";
  process.env.FRONTEND_ORIGIN = "https://web.synthetic.invalid";

  return {
    createWeb: vi.fn(),
    consumeWeb: vi.fn(),
    createNative: vi.fn(),
    consumeNative: vi.fn(),
    exchangeCodeForToken: vi.fn(),
    getUserInfo: vi.fn(),
    createSessionToken: vi.fn(),
    getUserByOpenId: vi.fn(),
    upsertUser: vi.fn(),
  };
});

vi.mock("../server/_core/oauth-pending-state", () => ({
  oauthPendingStateStore: {
    createWeb: mocks.createWeb,
    consumeWeb: mocks.consumeWeb,
    createNative: mocks.createNative,
    consumeNative: mocks.consumeNative,
  },
}));

vi.mock("../server/_core/sdk", () => ({
  sdk: {
    exchangeCodeForToken: mocks.exchangeCodeForToken,
    getUserInfo: mocks.getUserInfo,
    createSessionToken: mocks.createSessionToken,
    revokeRequestSessions: vi.fn(),
    authenticateRequest: vi.fn(),
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

async function closeServer(server: ReturnType<express.Express["listen"]>) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function nativePending(
  redirectUri: string = CIRCLES_NATIVE_OAUTH_REDIRECT_URI,
) {
  return {
    redirectUri,
    nonce,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

describe("OAuth redirect route security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exchangeCodeForToken.mockResolvedValue({ accessToken: "synthetic" });
    mocks.getUserInfo.mockResolvedValue({ openId: "synthetic-user" });
    mocks.upsertUser.mockResolvedValue(undefined);
    mocks.getUserByOpenId.mockResolvedValue({
      id: 1,
      openId: "synthetic-user",
      name: "Synthetic User",
      email: null,
      loginMethod: "manus",
      lastSignedIn: new Date(),
    });
    mocks.createSessionToken.mockResolvedValue("synthetic-session");
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps the normal web callback flow bound to its configured frontend origin", async () => {
    const { server, url } = await startOAuthApp();
    try {
      const redirectUri = "https://web.synthetic.invalid/api/oauth/callback";
      const response = await fetch(
        `${url}/api/oauth/start?redirectUri=${encodeURIComponent(redirectUri)}&frontendOrigin=${encodeURIComponent("https://web.synthetic.invalid")}`,
        { redirect: "manual" },
      );

      expect(response.status).toBe(302);
      expect(mocks.createWeb).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUri,
          frontendOrigin: "https://web.synthetic.invalid",
          nonce: expect.any(String),
          state: expect.any(String),
          cookieBinding: expect.any(String),
        }),
      );
    } finally {
      await closeServer(server);
    }
  });

  it("ignores a caller-selected native redirect and creates only the fixed Circles flow", async () => {
    const { server, url } = await startOAuthApp();
    try {
      const response = await fetch(
        `${url}/api/oauth/mobile/start?redirectUri=${encodeURIComponent("manus999999999999999:///oauth/callback")}`,
      );
      const body = (await response.json()) as { authorizationUrl: string };

      expect(response.status).toBe(200);
      expect(mocks.createNative).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUri: CIRCLES_NATIVE_OAUTH_REDIRECT_URI,
          nonce: expect.any(String),
          state: expect.any(String),
          flowToken: expect.any(String),
        }),
      );
      expect(
        new URL(body.authorizationUrl).searchParams.get("redirectUri"),
      ).toBe(CIRCLES_NATIVE_OAUTH_REDIRECT_URI);
    } finally {
      await closeServer(server);
    }
  });

  it("accepts a matching pending native state only for the fixed redirect", async () => {
    const state = encodeOAuthState(nativePending());
    mocks.consumeNative.mockResolvedValueOnce(nativePending());
    const { server, url } = await startOAuthApp();
    try {
      const response = await fetch(
        `${url}/api/oauth/mobile?code=synthetic-code&state=${encodeURIComponent(state)}`,
        { headers: { "x-manus-oauth-flow": flowToken } },
      );

      expect(response.status).toBe(200);
      expect(mocks.exchangeCodeForToken).toHaveBeenCalledWith(
        "synthetic-code",
        state,
      );
    } finally {
      await closeServer(server);
    }
  });

  it("rejects forged state and a non-Circles redirect recovered from already-pending storage", async () => {
    const forgedState = encodeOAuthState({
      redirectUri: CIRCLES_NATIVE_OAUTH_REDIRECT_URI,
      nonce: "F4s1a7B9cD2eF5gH8jK0mN3pQ6rT9vW1yZ4_AbCdEfG",
    });
    const alternateRedirect = "manus999999999999999:///oauth/callback";
    mocks.consumeNative
      .mockResolvedValueOnce(nativePending())
      .mockResolvedValueOnce(nativePending(alternateRedirect));
    const { server, url } = await startOAuthApp();
    try {
      const forged = await fetch(
        `${url}/api/oauth/mobile?code=synthetic-code&state=${encodeURIComponent(forgedState)}`,
        { headers: { "x-manus-oauth-flow": flowToken } },
      );
      const alternateState = encodeOAuthState(nativePending(alternateRedirect));
      const alternate = await fetch(
        `${url}/api/oauth/mobile?code=synthetic-code&state=${encodeURIComponent(alternateState)}`,
        { headers: { "x-manus-oauth-flow": flowToken } },
      );

      expect(forged.status).toBe(400);
      expect(alternate.status).toBe(400);
      expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });
});
