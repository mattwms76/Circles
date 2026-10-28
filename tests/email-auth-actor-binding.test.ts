import type { Request } from "express";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  // These synthetic values are set before immutable ENV imports in sdk.ts.
  process.env.MANUS_PROJECT_ID = "circles-email-actor-binding-test";
  process.env.MANUS_JWT_SECRET =
    "synthetic-session-signing-secret-for-email-actor-binding-tests";
  process.env.MANUS_OAUTH_API_URL = "https://oauth.synthetic.invalid";

  type SyntheticUser = {
    id: number;
    openId: string;
    name: string | null;
    email: string | null;
    loginMethod: string | null;
    role: "user" | "admin";
    createdAt: Date;
    updatedAt: Date;
    lastSignedIn: Date;
  };

  const users = new Map<string, SyntheticUser>();
  const getUserByOpenId = vi.fn(async (openId: string) => users.get(openId));
  const upsertUser = vi.fn(async () => undefined);

  return { users, getUserByOpenId, upsertUser };
});

vi.mock("../server/db", () => ({
  getDb: vi.fn(),
  getUserByOpenId: state.getUserByOpenId,
  upsertUser: state.upsertUser,
  withTrustedSystemDatabaseTransaction: async (
    _operation: string,
    work: () => Promise<unknown>,
  ) => work(),
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
    sessions,
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
    name: "Synthetic account",
    email: "synthetic@example.test",
    loginMethod: "email",
    role: "user" as const,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

function bearerRequest(token: string): Request {
  return {
    headers: { authorization: `Bearer ${token}` },
  } as Request;
}

describe("email session numeric actor binding", () => {
  beforeEach(() => {
    state.users.clear();
    state.getUserByOpenId.mockClear();
    state.upsertUser.mockClear();
  });

  it("accepts a signed, persisted email session when its numeric actor still matches", async () => {
    const memory = createMemorySessionStore();
    const sdk = new SDKServer(undefined, memory.store);
    const openId = "supabase:1d18a1d5-7648-4dca-8674-11da27cf9e4f";
    const currentActor = syntheticUser(71, openId);
    state.users.set(openId, currentActor);

    const token = await sdk.createSessionToken(openId, {
      name: "Synthetic account",
      userId: currentActor.id,
    });

    await expect(sdk.verifySession(token)).resolves.toMatchObject({
      openId,
      userId: currentActor.id,
    });
    await expect(
      sdk.authenticateRequest(bearerRequest(token)),
    ).resolves.toEqual(currentActor);
  });

  it("denies a missing or recreated numeric actor before OAuth sync or upsert", async () => {
    const memory = createMemorySessionStore();
    const sdk = new SDKServer(undefined, memory.store);
    const openId = "supabase:a744060e-9b06-4f4f-9b2d-6e51fdbe8924";
    const token = await sdk.createSessionToken(openId, {
      name: "Synthetic account",
      userId: 72,
    });

    await expect(sdk.authenticateRequest(bearerRequest(token))).rejects.toThrow(
      "Session actor binding is no longer valid",
    );
    expect(state.upsertUser).not.toHaveBeenCalled();

    state.users.set(openId, syntheticUser(73, openId));
    await expect(sdk.authenticateRequest(bearerRequest(token))).rejects.toThrow(
      "Session actor binding is no longer valid",
    );
    expect(state.upsertUser).not.toHaveBeenCalled();
  });

  it("keeps a persisted legacy session without a numeric user claim compatible", async () => {
    const memory = createMemorySessionStore();
    const sdk = new SDKServer(undefined, memory.store);
    const openId = "legacy-circles-open-id";
    const currentActor = syntheticUser(74, openId);
    state.users.set(openId, currentActor);

    const token = await sdk.createSessionToken(openId, {
      name: "Legacy account",
    });

    await expect(sdk.verifySession(token)).resolves.toEqual({
      openId,
      appId: "circles-email-actor-binding-test",
      name: "Legacy account",
    });
    await expect(
      sdk.authenticateRequest(bearerRequest(token)),
    ).resolves.toEqual(currentActor);
  });

  it("rejects an invalid numeric claim even when a matching durable session exists", async () => {
    const memory = createMemorySessionStore();
    const sdk = new SDKServer(undefined, memory.store);
    const openId = "supabase:25f0fda7-8a9c-48f4-a4d4-5b9e42bb6a2a";
    const sessionId = "a".repeat(32);
    await memory.store.create({
      sessionId,
      openId,
      appId: "circles-email-actor-binding-test",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const token = await new SignJWT({
      openId,
      appId: "circles-email-actor-binding-test",
      name: "Malformed actor",
      userId: "not-a-number",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setJti(sessionId)
      .setExpirationTime("1m")
      .sign(
        new TextEncoder().encode(
          "synthetic-session-signing-secret-for-email-actor-binding-tests",
        ),
      );

    await expect(sdk.verifySession(token)).resolves.toBeNull();
    await expect(sdk.authenticateRequest(bearerRequest(token))).rejects.toThrow(
      "Invalid session cookie",
    );
    expect(state.getUserByOpenId).not.toHaveBeenCalled();
    expect(state.upsertUser).not.toHaveBeenCalled();
  });

  it("rejects a durable session after logout revokes its persisted binding", async () => {
    const memory = createMemorySessionStore();
    const sdk = new SDKServer(undefined, memory.store);
    const openId = "supabase:9fd3420a-93e1-465c-9f5b-fc22ea0fd2e8";
    state.users.set(openId, syntheticUser(75, openId));
    const token = await sdk.createSessionToken(openId, {
      name: "Revoked account",
      userId: 75,
    });

    await sdk.revokeRequestSessions(bearerRequest(token));

    await expect(sdk.verifySession(token)).resolves.toBeNull();
    await expect(sdk.authenticateRequest(bearerRequest(token))).rejects.toThrow(
      "Invalid session cookie",
    );
  });
});
