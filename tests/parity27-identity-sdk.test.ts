import type { AxiosInstance } from "axios";
import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  // These synthetic values are set before immutable ENV imports in sdk.ts.
  process.env.MANUS_PROJECT_ID = "parity27-identity-test";
  process.env.MANUS_JWT_SECRET =
    "parity27-synthetic-session-signing-secret-with-no-real-credentials";
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

  type UpsertInput = {
    openId: string;
    name?: string | null;
    email?: string | null;
    loginMethod?: string | null;
    lastSignedIn?: Date;
  };

  const users = new Map<string, SyntheticUser>();
  const getUserByOpenId = vi.fn(async (openId: string) => users.get(openId));
  const upsertUser = vi.fn(async (input: UpsertInput) => {
    const now = new Date();
    const existing = users.get(input.openId);
    const user: SyntheticUser = existing
      ? {
          ...existing,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.loginMethod !== undefined
            ? { loginMethod: input.loginMethod }
            : {}),
          lastSignedIn: input.lastSignedIn ?? existing.lastSignedIn,
          updatedAt: now,
        }
      : {
          id: users.size + 100,
          openId: input.openId,
          name: input.name ?? null,
          email: input.email ?? null,
          loginMethod: input.loginMethod ?? null,
          role: "user",
          createdAt: now,
          updatedAt: now,
          lastSignedIn: input.lastSignedIn ?? now,
        };
    users.set(input.openId, user);
  });

  return { users, getUserByOpenId, upsertUser };
});

vi.mock("../server/db", () => ({
  getDb: vi.fn(),
  getUserByOpenId: state.getUserByOpenId,
  upsertUser: state.upsertUser,
}));

const { SDKServer } = await import("../server/_core/sdk");

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

function bearerRequest(token: string): Request {
  return {
    headers: { authorization: `Bearer ${token}` },
  } as Request;
}

function providerClient(userInfo: unknown): AxiosInstance {
  return {
    post: vi.fn(async () => ({ data: userInfo })),
  } as unknown as AxiosInstance;
}

function syntheticUser(id: number, openId: string) {
  const now = new Date();
  return {
    id,
    openId,
    name: "Synthetic account",
    email: "synthetic@example.test",
    loginMethod: "email",
    role: "user" as const,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

describe("parity27 identity signed-session fallback", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.users.clear();
    state.getUserByOpenId.mockClear();
    state.upsertUser.mockClear();
    consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("rehydrates a legacy session when the provider openId exactly matches", async () => {
    const signedOpenId = "legacy-signed-open-id";
    const provider = providerClient({
      openId: signedOpenId,
      name: "Provider account",
      email: "provider@example.test",
      loginMethod: "google",
    });
    const memory = createMemorySessionStore();
    const sdk = new SDKServer(provider, memory.store);
    const token = await sdk.createSessionToken(signedOpenId, {
      name: "Legacy account",
    });

    await expect(
      sdk.authenticateRequest(bearerRequest(token)),
    ).resolves.toMatchObject({
      openId: signedOpenId,
      name: "Provider account",
    });
    expect(state.getUserByOpenId).toHaveBeenLastCalledWith(signedOpenId);
    expect(state.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ openId: signedOpenId }),
    );
    expect([...state.users.keys()]).toEqual([signedOpenId]);
  });

  it.each([
    ["missing", undefined],
    ["mismatched", "different-provider-open-id"],
  ])(
    "rejects %s provider openId before any fallback upsert",
    async (_case, providerOpenId) => {
      const signedOpenId = "signed-session-open-id";
      const provider = providerClient({
        openId: providerOpenId,
        name: "Different provider account",
      });
      const memory = createMemorySessionStore();
      const sdk = new SDKServer(provider, memory.store);
      const token = await sdk.createSessionToken(signedOpenId, {
        name: "Legacy account",
      });

      await expect(
        sdk.authenticateRequest(bearerRequest(token)),
      ).rejects.toThrow("Failed to sync user info");
      expect(state.getUserByOpenId).toHaveBeenCalledTimes(1);
      expect(state.getUserByOpenId).toHaveBeenCalledWith(signedOpenId);
      expect(state.upsertUser).not.toHaveBeenCalled();
      expect(state.users).toEqual(new Map());
    },
  );

  it("retains signed numeric actor authentication without provider fallback", async () => {
    const signedOpenId = "numeric-actor-open-id";
    const currentActor = syntheticUser(401, signedOpenId);
    state.users.set(signedOpenId, currentActor);
    const provider = providerClient({ openId: "unexpected-provider-open-id" });
    const memory = createMemorySessionStore();
    const sdk = new SDKServer(provider, memory.store);
    const token = await sdk.createSessionToken(signedOpenId, {
      name: "Numeric actor",
      userId: currentActor.id,
    });

    await expect(
      sdk.authenticateRequest(bearerRequest(token)),
    ).resolves.toEqual(currentActor);
    expect(provider.post).not.toHaveBeenCalled();
  });
});
