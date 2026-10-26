import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNativeOAuthPendingFlowIfCurrent,
  getNativeOAuthPendingFlow,
  startOAuthLogin,
} from "../constants/oauth";
import {
  confirmNativeLoginAfterEmailAuthDrain,
  persistNativeBearerAfterEmailAuthDrain,
} from "../hooks/native-login-transition";
import { serializeNativeOAuthPendingFlow } from "../lib/a26-auth-oauth";
import { decodeOAuthState, registerOAuthRoutes } from "../server/_core/oauth";

const realFetch = globalThis.fetch;

const runtime = vi.hoisted(() => ({
  platform: "ios",
  canOpenURL: vi.fn(),
  openURL: vi.fn(),
  secureStore: new Map<string, string>(),
}));

const serverMocks = vi.hoisted(() => {
  process.env.MANUS_PROJECT_ID = "a26-auth-flow-test";
  process.env.MANUS_JWT_SECRET =
    "a26-auth-flow-cookie-signing-secret-for-isolated-tests";
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

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: { apiBaseUrl: "https://api.synthetic.invalid" },
    },
  },
}));
vi.mock("expo-linking", () => ({
  canOpenURL: runtime.canOpenURL,
  openURL: runtime.openURL,
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return runtime.platform;
    },
  },
}));
vi.mock("expo-secure-store", () => ({
  deleteItemAsync: async (key: string) => {
    runtime.secureStore.delete(key);
  },
  getItemAsync: async (key: string) => runtime.secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    runtime.secureStore.set(key, value);
  },
}));
vi.mock("../server/_core/oauth-pending-state", () => ({
  oauthPendingStateStore: {
    createWeb: serverMocks.createWeb,
    consumeWeb: serverMocks.consumeWeb,
    createNative: serverMocks.createNative,
    consumeNative: serverMocks.consumeNative,
  },
}));
vi.mock("../server/_core/sdk", () => ({
  sdk: {
    exchangeCodeForToken: serverMocks.exchangeCodeForToken,
    getUserInfo: serverMocks.getUserInfo,
    createSessionToken: serverMocks.createSessionToken,
    revokeRequestSessions: vi.fn(),
    authenticateRequest: vi.fn(),
  },
}));
vi.mock("../server/db", () => ({
  getUserByOpenId: serverMocks.getUserByOpenId,
  upsertUser: serverMocks.upsertUser,
}));

const nativeFlowToken = "native-flow-token-abcdefghijklmnopqrstuvwxyz";
const webRedirect = "https://web.synthetic.invalid/api/oauth/callback";

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

function responseCookies(response: Response): string {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return (
    headers.getSetCookie?.().join("; ") ??
    response.headers.get("set-cookie") ??
    ""
  );
}

describe("A26 auth OAuth flow fencing", () => {
  beforeEach(() => {
    runtime.platform = "ios";
    runtime.canOpenURL.mockReset().mockResolvedValue(true);
    runtime.openURL.mockReset().mockResolvedValue(true);
    runtime.secureStore.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("https://api.synthetic.invalid/")) {
          return {
            ok: true,
            json: async () => ({
              authorizationUrl: "https://oauth.synthetic.invalid/app-auth",
              expiresIn: 60,
              flowToken: nativeFlowToken,
            }),
          } as Response;
        }
        return realFetch(input, init);
      }),
    );
    vi.clearAllMocks();
    serverMocks.exchangeCodeForToken.mockResolvedValue({
      accessToken: "token",
    });
    serverMocks.getUserInfo.mockResolvedValue({ openId: "synthetic-user" });
    serverMocks.upsertUser.mockResolvedValue(undefined);
    serverMocks.getUserByOpenId.mockResolvedValue({
      id: 42,
      openId: "synthetic-user",
      name: "Synthetic User",
      email: null,
      loginMethod: "manus",
      lastSignedIn: new Date(),
    });
    serverMocks.createSessionToken.mockResolvedValue("synthetic-session");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps F1 pending and suppresses a second native initiation rather than overwriting its continuation", async () => {
    await expect(
      startOAuthLogin({ continuation: "/account/email" }),
    ).resolves.toBeNull();
    const first = await getNativeOAuthPendingFlow();
    expect(first).toMatchObject({
      continuation: "/account/email",
      flowToken: nativeFlowToken,
    });
    expect(runtime.openURL).toHaveBeenCalledTimes(1);

    await expect(startOAuthLogin()).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(runtime.openURL).toHaveBeenCalledTimes(1);
    expect(await getNativeOAuthPendingFlow()).toEqual(first);
  });

  it("compare-deletes only the captured native flow and leaves F2 intact", async () => {
    const first = {
      flowToken: nativeFlowToken,
      generation: 10,
      continuation: null,
      expiresAt: Date.now() + 60_000,
    } as const;
    const second = { ...first, generation: 11 };
    runtime.secureStore.set(
      "manus_oauth_pending_flow",
      serializeNativeOAuthPendingFlow(second),
    );

    await expect(clearNativeOAuthPendingFlowIfCurrent(first)).resolves.toBe(
      false,
    );
    expect(await getNativeOAuthPendingFlow()).toEqual(second);
  });

  it("skips bearer persistence when its exact callback flow is no longer current", async () => {
    const writes: string[] = [];
    await expect(
      persistNativeBearerAfterEmailAuthDrain({
        bearer: "F1-bearer",
        drainEmailAuthRequests: async () => undefined,
        isCurrent: () => false,
        setNativeBearer: async (value) => {
          writes.push(value);
        },
      }),
    ).resolves.toBe(false);
    expect(writes).toEqual([]);
  });

  it("uses one provider-owned failed-confirmation cleanup and one remote revocation", async () => {
    const clearLocalCredentials = vi.fn(async () => undefined);
    const remoteLogout = vi.fn(async () => undefined);
    const result = await confirmNativeLoginAfterEmailAuthDrain({
      drainEmailAuthRequests: async () => undefined,
      getNativeBearer: async () => "captured-bearer",
      completeTransition: async () => null,
      clearLocalCredentials,
      remoteLogout,
    });

    expect(result).toEqual({
      authenticatedUser: null,
      cleanup: { localCleanupFailed: false, remoteRevocationFailed: false },
    });
    expect(clearLocalCredentials).toHaveBeenCalledTimes(1);
    expect(remoteLogout).toHaveBeenCalledTimes(1);
    expect(remoteLogout).toHaveBeenCalledWith("captured-bearer");
  });

  it("redirects successful signed web OAuth continuation only to the allow-listed email route", async () => {
    let issuedState = "";
    serverMocks.createWeb.mockImplementation(async (input) => {
      issuedState = input.state;
    });
    const { server, url } = await startOAuthApp();
    try {
      const start = await fetch(
        `${url}/api/oauth/start?redirectUri=${encodeURIComponent(webRedirect)}&frontendOrigin=${encodeURIComponent("https://web.synthetic.invalid")}&continuation=${encodeURIComponent("/account/email")}`,
        { redirect: "manual" },
      );
      expect(start.status).toBe(302);
      expect(issuedState).toBeTruthy();
      const cookies = responseCookies(start);
      expect(cookies).toContain("manus_oauth_state=");
      expect(cookies).toContain("manus_oauth_continuation=");

      const issued = decodeOAuthState(issuedState);
      if (!issued) throw new Error("Expected a valid issued OAuth state.");
      // The consumed DB row preserves the server-issued nonce and callback receiver.
      serverMocks.consumeWeb.mockResolvedValueOnce({
        redirectUri: webRedirect,
        nonce: issued.nonce,
        frontendOrigin: "https://web.synthetic.invalid",
        expiresAt: new Date(Date.now() + 60_000),
      });
      const callback = await fetch(
        `${url}/api/oauth/callback?code=code&state=${encodeURIComponent(issuedState)}`,
        { headers: { cookie: cookies }, redirect: "manual" },
      );

      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe(
        "https://web.synthetic.invalid/account/email",
      );
    } finally {
      await closeServer(server);
    }
  });

  it("rejects arbitrary web continuation paths before creating a pending state", async () => {
    const { server, url } = await startOAuthApp();
    try {
      const response = await fetch(
        `${url}/api/oauth/start?redirectUri=${encodeURIComponent(webRedirect)}&frontendOrigin=${encodeURIComponent("https://web.synthetic.invalid")}&continuation=${encodeURIComponent("/account/email?next=https://evil.invalid")}`,
        { redirect: "manual" },
      );
      expect(response.status).toBe(400);
      expect(serverMocks.createWeb).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });
});
