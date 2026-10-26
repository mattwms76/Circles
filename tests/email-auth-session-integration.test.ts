import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiCall: vi.fn(),
  platform: { OS: "ios" },
  setSessionToken: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("@/lib/_core/api", () => ({ apiCall: mocks.apiCall }));
vi.mock("@/lib/_core/auth", () => ({
  setSessionToken: mocks.setSessionToken,
}));

const client = await import("../lib/email-auth-client");
const transition = await import("../hooks/native-login-transition");

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("email authentication session integration", () => {
  beforeEach(async () => {
    await client.cancelAndDrainEmailAuthRequests();
    mocks.apiCall.mockReset();
    mocks.setSessionToken.mockReset();
    mocks.platform.OS = "ios";
  });

  afterEach(async () => {
    await client.cancelAndDrainEmailAuthRequests();
    vi.restoreAllMocks();
  });

  it("drains a deferred native email write before logout captures, removes, and revokes that exact bearer", async () => {
    const emailWriteStarted = deferred<void>();
    const allowEmailWrite = deferred<void>();
    let durableBearer: string | null = null;
    const cleanupSteps: string[] = [];
    const remoteLogout = vi.fn(async (bearer: string | null) => {
      cleanupSteps.push(`remote:${bearer}`);
    });

    mocks.apiCall.mockResolvedValueOnce({
      success: true,
      sessionToken: "email-bearer-issued-during-logout",
    });
    mocks.setSessionToken.mockImplementationOnce(async (bearer: string) => {
      emailWriteStarted.resolve();
      await allowEmailWrite.promise;
      durableBearer = bearer;
    });

    const signIn = client.signInWithEmailPassword(
      "logout-race@example.test",
      "synthetic-password",
    );
    await emailWriteStarted.promise;

    const logout = transition.logoutNativeSessionAfterEmailAuthDrain({
      drainEmailAuthRequests: client.cancelAndDrainEmailAuthRequests,
      getNativeBearer: async () => durableBearer,
      logoutAndPurge: async (capturedBearer) => {
        cleanupSteps.push(`local:${capturedBearer}`);
        durableBearer = null;
        await remoteLogout(capturedBearer);
      },
    });

    await Promise.resolve();
    expect(cleanupSteps).toEqual([]);

    allowEmailWrite.resolve();
    await Promise.all([signIn, logout]);

    expect(cleanupSteps).toEqual([
      "local:email-bearer-issued-during-logout",
      "remote:email-bearer-issued-during-logout",
    ]);
    expect(remoteLogout).toHaveBeenCalledWith(
      "email-bearer-issued-during-logout",
    );
    expect(durableBearer).toBeNull();
  });

  it("removes and revokes a newly persisted bearer when fresh auth.me remains guest", async () => {
    let durableBearer: string | null = "fresh-email-bearer";
    const calls: string[] = [];

    const result = await transition.confirmNativeLoginAfterEmailAuthDrain({
      drainEmailAuthRequests: async () => {
        calls.push("drain");
      },
      getNativeBearer: async () => durableBearer,
      completeTransition: async () => {
        calls.push("fresh-auth-me");
        return null;
      },
      clearLocalCredentials: async (capturedBearer) => {
        const cleared =
          await transition.clearCapturedNativeCredentialsIfCurrent({
            capturedBearer,
            getCurrentBearer: async () => durableBearer,
            clearLocalCredentials: async () => {
              calls.push("local-remove");
              durableBearer = null;
            },
          });
        expect(cleared).toBe(true);
      },
      remoteLogout: async (capturedBearer) => {
        calls.push(`remote-revoke:${capturedBearer}`);
      },
    });

    expect(result.authenticatedUser).toBeNull();
    expect(result.cleanup).toEqual({
      localCleanupFailed: false,
      remoteRevocationFailed: false,
    });
    expect(calls).toEqual([
      "drain",
      "fresh-auth-me",
      "local-remove",
      "remote-revoke:fresh-email-bearer",
    ]);
    expect(durableBearer).toBeNull();
  });

  it("preempts an in-flight email write with the newer OAuth bearer after draining it", async () => {
    const emailWriteStarted = deferred<void>();
    const allowEmailWrite = deferred<void>();
    const writes: string[] = [];
    let durableBearer: string | null = null;

    mocks.apiCall.mockResolvedValueOnce({
      success: true,
      sessionToken: "older-email-bearer",
    });
    mocks.setSessionToken.mockImplementation(async (bearer: string) => {
      writes.push(bearer);
      if (bearer === "older-email-bearer") {
        emailWriteStarted.resolve();
        await allowEmailWrite.promise;
      }
      durableBearer = bearer;
    });

    const emailSignIn = client.signInWithEmailPassword(
      "oauth-preemption@example.test",
      "synthetic-password",
    );
    await emailWriteStarted.promise;

    const oauthWrite = transition.persistNativeBearerAfterEmailAuthDrain({
      drainEmailAuthRequests: client.cancelAndDrainEmailAuthRequests,
      setNativeBearer: mocks.setSessionToken,
      bearer: "newer-oauth-bearer",
    });
    await Promise.resolve();
    expect(writes).toEqual(["older-email-bearer"]);

    allowEmailWrite.resolve();
    await Promise.all([emailSignIn, oauthWrite]);

    expect(writes).toEqual(["older-email-bearer", "newer-oauth-bearer"]);
    expect(durableBearer).toBe("newer-oauth-bearer");
  });

  it("does not clear an OAuth bearer already observed to have superseded the failed one", async () => {
    const clearLocalCredentials = vi.fn(async () => undefined);
    const cleared = await transition.clearCapturedNativeCredentialsIfCurrent({
      capturedBearer: "failed-email-bearer",
      getCurrentBearer: async () => "newer-oauth-bearer",
      clearLocalCredentials,
    });

    expect(cleared).toBe(false);
    expect(clearLocalCredentials).not.toHaveBeenCalled();
  });
});
