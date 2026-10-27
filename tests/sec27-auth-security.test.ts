import type { AxiosInstance } from "axios";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.MANUS_PROJECT_ID = "sec27-auth-project";
  process.env.MANUS_JWT_SECRET =
    "sec27-auth-synthetic-session-signing-secret-with-no-real-credentials";
  process.env.MANUS_OAUTH_API_URL = "https://oauth.synthetic.invalid";

  type SyntheticUser = {
    id: number;
    openId: string;
    name: string | null;
    email: string | null;
    loginMethod: string | null;
    role: "user";
    createdAt: Date;
    updatedAt: Date;
    lastSignedIn: Date;
  };

  const users = new Map<string, SyntheticUser>();
  return {
    users,
    getUserByOpenId: vi.fn(async (openId: string) => users.get(openId)),
    upsertUser: vi.fn(async () => undefined),
  };
});

vi.mock("../server/db", () => ({
  getDb: vi.fn(),
  getUserByOpenId: state.getUserByOpenId,
  upsertUser: state.upsertUser,
}));

const { canonicalOAuthProviderOrigin, configuredOAuthProviderOrigin } =
  await import("../server/_core/env");
const { EmailAuthThrottle } = await import("../server/_core/email-auth");
const { createOAuthHttpClient, SDKServer } =
  await import("../server/_core/sdk");
const { issueOAuthSessionForActor } = await import("../server/_core/oauth");

type StoredSession = {
  sessionId: string;
  openId: string;
  appId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

function createMemorySessionStore() {
  const sessions = new Map<string, StoredSession>();
  return {
    store: {
      async create(session: Omit<StoredSession, "revokedAt">) {
        sessions.set(session.sessionId, { ...session, revokedAt: null });
      },
      async findActive(
        binding: Pick<StoredSession, "sessionId" | "openId" | "appId">,
        now: Date,
      ) {
        const stored = sessions.get(binding.sessionId);
        if (
          !stored ||
          stored.revokedAt !== null ||
          stored.expiresAt <= now ||
          stored.openId !== binding.openId ||
          stored.appId !== binding.appId
        ) {
          return null;
        }
        return { ...stored };
      },
      async revoke(
        binding: Pick<StoredSession, "sessionId" | "openId" | "appId">,
        revokedAt: Date,
      ) {
        const stored = sessions.get(binding.sessionId);
        if (
          stored &&
          stored.openId === binding.openId &&
          stored.appId === binding.appId
        ) {
          stored.revokedAt = revokedAt;
        }
      },
    },
  };
}

function syntheticUser(id: number, openId: string) {
  const now = new Date();
  return {
    id,
    openId,
    name: "SEC-27 synthetic actor",
    email: "sec27@example.test",
    loginMethod: "manus",
    role: "user" as const,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

function bearerRequest(token: string): Request {
  return { headers: { authorization: `Bearer ${token}` } } as Request;
}

function providerClient(responses: unknown[]): AxiosInstance {
  return {
    post: vi.fn(async () => ({ data: responses.shift() })),
  } as unknown as AxiosInstance;
}

describe("SEC-002 OAuth back-channel origin and response boundaries", () => {
  it("accepts only a canonical HTTPS provider origin and leaves production legacy-only configuration unavailable", () => {
    expect(
      canonicalOAuthProviderOrigin("https://oauth.synthetic.invalid/"),
    ).toBe("https://oauth.synthetic.invalid");
    for (const value of [
      "http://oauth.synthetic.invalid",
      "https://operator@oauth.synthetic.invalid",
      "https://oauth.synthetic.invalid/api",
      "https://oauth.synthetic.invalid?next=attacker",
      "https://oauth.synthetic.invalid#fragment",
    ]) {
      expect(canonicalOAuthProviderOrigin(value)).toBeNull();
    }
    expect(
      configuredOAuthProviderOrigin({
        NODE_ENV: "production",
        OAUTH_SERVER_URL: "https://oauth.synthetic.invalid",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("uses a no-redirect bounded transport and strips opaque token response fields", async () => {
    const client = createOAuthHttpClient();
    expect(client.defaults.baseURL).toBe("https://oauth.synthetic.invalid");
    expect(client.defaults.maxRedirects).toBe(0);
    expect(client.defaults.maxContentLength).toBe(64 * 1024);
    expect(client.defaults.validateStatus?.(302)).toBe(false);

    const provider = providerClient([
      {
        accessToken: "a".repeat(32),
        idToken: "opaque-not-a-signed-oidc-artifact",
        unexpected: "not forwarded",
      },
      {
        openId: "provider-subject-27",
        projectId: "sec27-auth-project",
        name: "Provider subject",
        email: "provider@example.test",
        platforms: ["REGISTERED_PLATFORM_EMAIL"],
      },
    ]);
    const sdk = new SDKServer(provider, createMemorySessionStore().store);

    await expect(sdk.exchangeCodeForToken("code", "state")).resolves.toEqual({
      accessToken: "a".repeat(32),
    });
    await expect(sdk.getUserInfo("a".repeat(32))).resolves.toMatchObject({
      openId: "provider-subject-27",
      projectId: "sec27-auth-project",
      loginMethod: "email",
    });
  });

  it("rejects a malformed provider identity before any local synchronization", async () => {
    const provider = providerClient([
      { accessToken: "a".repeat(32) },
      {
        openId: "provider-subject-27\u0000bad",
        projectId: "sec27-auth-project",
        name: "Provider subject",
      },
    ]);
    const sdk = new SDKServer(provider, createMemorySessionStore().store);

    await expect(sdk.exchangeCodeForToken("code", "state")).resolves.toEqual({
      accessToken: "a".repeat(32),
    });
    await expect(sdk.getUserInfo("a".repeat(32))).rejects.toThrow(
      "OAuth provider response was not accepted",
    );
  });
});

describe("SEC-011 OAuth numeric actor binding", () => {
  beforeEach(() => {
    state.users.clear();
    state.getUserByOpenId.mockClear();
    state.upsertUser.mockClear();
  });

  it("passes the observed positive numeric actor to every newly issued OAuth session", async () => {
    const issuer = { createSessionToken: vi.fn(async () => "issued-session") };
    await expect(
      issueOAuthSessionForActor(
        issuer,
        { openId: "provider-subject-27", name: "Provider subject" },
        { id: 271, openId: "provider-subject-27" },
      ),
    ).resolves.toBe("issued-session");
    expect(issuer.createSessionToken).toHaveBeenCalledWith(
      "provider-subject-27",
      expect.objectContaining({ userId: 271 }),
    );

    await expect(
      issueOAuthSessionForActor(
        issuer,
        { openId: "provider-subject-27" },
        { id: 0, openId: "provider-subject-27" },
      ),
    ).rejects.toThrow("OAuth identity did not map to a Circles actor");
  });

  it("denies a minted actor-bound session after local actor deletion or recreation", async () => {
    const sessions = createMemorySessionStore();
    const sdk = new SDKServer(undefined, sessions.store);
    const openId = "provider-subject-delete-recreate-27";
    state.users.set(openId, syntheticUser(272, openId));
    const token = await sdk.createSessionToken(openId, {
      name: "Provider subject",
      userId: 272,
    });

    await expect(
      sdk.authenticateRequest(bearerRequest(token)),
    ).resolves.toMatchObject({
      id: 272,
      openId,
    });
    state.users.delete(openId);
    await expect(sdk.authenticateRequest(bearerRequest(token))).rejects.toThrow(
      "Session actor binding is no longer valid",
    );

    state.users.set(openId, syntheticUser(273, openId));
    await expect(sdk.authenticateRequest(bearerRequest(token))).rejects.toThrow(
      "Session actor binding is no longer valid",
    );
    expect(state.upsertUser).toHaveBeenCalledTimes(1);
  });
});

describe("SEC-023 finite email account, network, and global admission", () => {
  it("keeps independent account, network, and global budgets without evicting a live key", () => {
    const throttle = new EmailAuthThrottle({
      accountLimit: 2,
      networkLimit: 2,
      globalLimit: 4,
      maxEntries: 2,
    });
    const admit = (accountKey: string, networkKey: string) =>
      throttle.checkAndRecordAdmission({ accountKey, networkKey }, 100);

    expect(admit("account-a", "network-a")).toBe(true);
    expect(admit("account-a", "network-b")).toBe(true);
    expect(admit("account-a", "network-c")).toBe(false);
    expect(admit("account-b", "network-a")).toBe(true);
    expect(admit("account-c", "network-a")).toBe(false);

    const capacity = new EmailAuthThrottle({
      accountLimit: 8,
      networkLimit: 8,
      globalLimit: 8,
      maxEntries: 1,
    });
    expect(
      capacity.checkAndRecordAdmission(
        { accountKey: "protected-account", networkKey: "protected-network" },
        100,
      ),
    ).toBe(true);
    expect(
      capacity.checkAndRecordAdmission(
        { accountKey: "new-account", networkKey: "new-network" },
        100,
      ),
    ).toBe(false);
    expect(
      capacity.checkAndRecordAdmission(
        { accountKey: "protected-account", networkKey: "protected-network" },
        100,
      ),
    ).toBe(true);

    const global = new EmailAuthThrottle({
      accountLimit: 8,
      networkLimit: 8,
      globalLimit: 2,
      maxEntries: 8,
    });
    expect(
      global.checkAndRecordAdmission(
        { accountKey: "global-a", networkKey: "global-network-a" },
        100,
      ),
    ).toBe(true);
    expect(
      global.checkAndRecordAdmission(
        { accountKey: "global-b", networkKey: "global-network-b" },
        100,
      ),
    ).toBe(true);
    expect(
      global.checkAndRecordAdmission(
        { accountKey: "global-c", networkKey: "global-network-c" },
        100,
      ),
    ).toBe(false);
  });
});
