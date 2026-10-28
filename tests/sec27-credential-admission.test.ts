import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INCOMPLETE_LOGOUT_SENTINEL_KEY,
  createCredentialAdmissionController,
  credentialAdmission,
  type CredentialAdmissionStorage,
} from "../lib/sec27-credential-admission";
import { fetchWithCredentialAdmission } from "../lib/trpc";
import { logoutAndPurgeClientSession } from "../lib/client-session";

const mocks = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  platform: { OS: "ios" },
  setItemAsync: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: mocks.deleteItemAsync,
  getItemAsync: mocks.getItemAsync,
  setItemAsync: mocks.setItemAsync,
}));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("@/constants/oauth", () => ({
  SESSION_TOKEN_KEY: "sec27-session-token",
  USER_INFO_KEY: "sec27-user-info",
  getApiRequestUrl: (path: string) => `https://api.example.test${path}`,
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function memoryStorage(
  values = new Map<string, string>(),
): CredentialAdmissionStorage {
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("SEC-27 global credential admission", () => {
  beforeEach(() => {
    mocks.deleteItemAsync.mockReset().mockResolvedValue(undefined);
    mocks.getItemAsync.mockReset().mockResolvedValue(null);
    mocks.setItemAsync.mockReset().mockResolvedValue(undefined);
    mocks.platform.OS = "ios";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails closed while the persisted marker hydrates, then admits normal credentials only after a clean read", async () => {
    const markerRead = deferred<string | null>();
    const storage: CredentialAdmissionStorage = {
      ...memoryStorage(),
      getItem: () => markerRead.promise,
    };
    const admission = createCredentialAdmissionController();
    const hydration = admission.configureStorage(storage);

    expect(admission.getSnapshot()).toMatchObject({
      admitted: false,
      hydrated: false,
    });
    const beforeHydration = admission.prepareRequest({
      credentials: "include",
      headers: { Authorization: "Bearer stale-before-hydration" },
    });
    expect(beforeHydration.credentials).toBe("omit");
    expect(
      new Headers(beforeHydration.headers).get("Authorization"),
    ).toBeNull();

    markerRead.resolve(null);
    await hydration;

    const admitted = admission.prepareRequest({
      headers: { Authorization: "Bearer ordinary-request" },
    });
    expect(admission.getSnapshot()).toMatchObject({
      admitted: true,
      hydrated: true,
      persistence: "not_needed",
    });
    expect(admitted.credentials).toBe("include");
    expect(new Headers(admitted.headers).get("Authorization")).toBe(
      "Bearer ordinary-request",
    );
  });

  it("reloads a persisted incomplete marker fail-closed and retains only an in-memory recovery-only raw credential", async () => {
    const values = new Map([[INCOMPLETE_LOGOUT_SENTINEL_KEY, "v1"]]);
    const admission = createCredentialAdmissionController();
    await admission.configureStorage(memoryStorage(values));

    expect(admission.getSnapshot()).toMatchObject({
      admitted: false,
      hydrated: true,
      persistence: "persisted",
    });
    const request = admission.prepareRequest({
      credentials: "include",
      headers: { Authorization: "Bearer retained-native-bearer" },
    });
    expect(request.credentials).toBe("omit");
    expect(new Headers(request.headers).get("Authorization")).toBeNull();
    expect(
      admission.getCapturedCredentialForIncompleteLogoutRecovery(),
    ).toBeUndefined();
    expect(
      admission.captureCredentialForIncompleteLogoutRecovery(
        "captured-after-explicit-retry",
      ),
    ).toBe("captured-after-explicit-retry");
    expect(admission.getCapturedCredentialForIncompleteLogoutRecovery()).toBe(
      "captured-after-explicit-retry",
    );
    expect([...values.entries()]).toEqual([
      [INCOMPLETE_LOGOUT_SENTINEL_KEY, "v1"],
    ]);
  });

  it("fails closed when the marker cannot be read or later deleted", async () => {
    const unreadable = createCredentialAdmissionController();
    await unreadable.configureStorage({
      ...memoryStorage(),
      async getItem() {
        throw new Error("synthetic marker read failure");
      },
    });
    expect(unreadable.getSnapshot()).toMatchObject({
      admitted: false,
      hydrated: true,
      persistence: "failed",
    });

    const undeletable = createCredentialAdmissionController();
    await undeletable.configureStorage({
      ...memoryStorage(),
      async removeItem() {
        throw new Error("synthetic marker deletion failure");
      },
    });
    const attempt = undeletable.beginIncompleteLogout();
    expect(await attempt.confirmPersisted()).toBe(true);
    expect(await undeletable.clearAfterConfirmedLogout(attempt)).toBe(false);
    expect(undeletable.getSnapshot()).toMatchObject({
      admitted: false,
      persistence: "failed",
    });
  });

  it("keeps the barrier closed when marker persistence fails, then permits a successful explicit retry to remove it", async () => {
    const values = new Map<string, string>();
    let rejectWrite = true;
    const storage: CredentialAdmissionStorage = {
      ...memoryStorage(values),
      async setItem(key, value) {
        if (rejectWrite) throw new Error("synthetic marker write failure");
        values.set(key, value);
      },
    };
    const admission = createCredentialAdmissionController();
    await admission.configureStorage(storage);
    const attempt = admission.beginIncompleteLogout();

    expect(admission.getSnapshot().admitted).toBe(false);
    expect(await attempt.confirmPersisted()).toBe(false);
    expect(admission.getSnapshot().persistence).toBe("failed");

    rejectWrite = false;
    expect(await attempt.confirmPersisted()).toBe(true);
    expect(admission.getSnapshot().persistence).toBe("persisted");
    expect(await admission.clearAfterConfirmedLogout(attempt)).toBe(true);
    expect(admission.getSnapshot()).toMatchObject({
      admitted: true,
      persistence: "not_needed",
    });
    expect(values.has(INCOMPLETE_LOGOUT_SENTINEL_KEY)).toBe(false);
  });

  it("does not reopen admission when a stale removal races a newer synchronous logout generation", async () => {
    const removalStarted = deferred<void>();
    const values = new Map<string, string>();
    const storage: CredentialAdmissionStorage = {
      ...memoryStorage(values),
      removeItem: async (key) => {
        await removalStarted.promise;
        values.delete(key);
      },
    };
    const admission = createCredentialAdmissionController();
    await admission.configureStorage(storage);
    const first = admission.beginIncompleteLogout();
    expect(await first.confirmPersisted()).toBe(true);
    const staleRemoval = admission.clearAfterConfirmedLogout(first);
    // clearAfterConfirmedLogout awaits persistence before it enqueues storage
    // removal. Let that continuation run so the next start races the actual
    // delete rather than only its initial confirmation check.
    await Promise.resolve();
    const second = admission.beginIncompleteLogout();

    removalStarted.resolve();
    expect(await staleRemoval).toBe(false);
    expect(await second.confirmPersisted()).toBe(true);
    expect(admission.getSnapshot()).toMatchObject({
      admitted: false,
      generation: second.generation,
      persistence: "persisted",
    });
    expect(values.get(INCOMPLETE_LOGOUT_SENTINEL_KEY)).toBe("v1");
  });

  it("suppresses an async native bearer that resolves after logout generation changes and preserves it only for recovery", async () => {
    vi.resetModules();
    const tokenRead = deferred<string | null>();
    mocks.getItemAsync.mockImplementation((key: string) => {
      if (key === "sec27-session-token") return tokenRead.promise;
      return Promise.resolve(null);
    });
    const Auth = await import("../lib/_core/auth");
    await Auth.initializeCredentialAdmission();

    const ordinaryRead = Auth.getSessionToken();
    await Promise.resolve();
    const attempt = Auth.beginIncompleteLogoutCredentialAdmission();
    tokenRead.resolve("native-bearer-resolved-too-late");

    await expect(ordinaryRead).resolves.toBeNull();
    await expect(Auth.getSessionToken()).resolves.toBeNull();
    await expect(
      Auth.getSessionTokenForIncompleteLogoutRecovery(),
    ).resolves.toBe("native-bearer-resolved-too-late");
    await expect(
      Auth.setSessionToken("new-bearer-must-not-reset-admission"),
    ).rejects.toThrow("Secure sign-out recovery must finish");
    expect(await attempt.confirmPersisted()).toBe(true);
  });

  it("uses the actual tRPC header helper and removes native Authorization after a global barrier begins", async () => {
    vi.resetModules();
    mocks.getItemAsync.mockImplementation((key: string) =>
      Promise.resolve(
        key === "sec27-session-token" ? "ordinary-native-bearer" : null,
      ),
    );
    const { trpcCredentialAdmissionHeaders: headers } =
      await import("../lib/trpc");
    const Auth = await import("../lib/_core/auth");

    await expect(headers()).resolves.toEqual({
      Authorization: "Bearer ordinary-native-bearer",
    });
    Auth.beginIncompleteLogoutCredentialAdmission();
    await expect(headers()).resolves.toEqual({});
  });

  it("applies the final tRPC fetch fence to omit web cookies and a stale Authorization header after dispatch generation changes", async () => {
    await credentialAdmission.configureStorage(memoryStorage());
    const request = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", request);

    await fetchWithCredentialAdmission("https://api.example.test/api/trpc", {
      headers: { Authorization: "Bearer before-logout" },
      credentials: "include",
    });
    const dispatchedCalls = request.mock.calls as unknown as [
      unknown,
      RequestInit | undefined,
    ][];
    let dispatched = dispatchedCalls[0]?.[1] ?? {};
    expect(dispatched.credentials).toBe("include");
    expect(new Headers(dispatched.headers).get("Authorization")).toBe(
      "Bearer before-logout",
    );

    credentialAdmission.beginIncompleteLogout();
    await fetchWithCredentialAdmission("https://api.example.test/api/trpc", {
      headers: { Authorization: "Bearer stale-dispatch" },
      credentials: "include",
    });
    dispatched = dispatchedCalls[1]?.[1] ?? {};
    expect(dispatched.credentials).toBe("omit");
    expect(new Headers(dispatched.headers).get("Authorization")).toBeNull();
  });

  it("clears the marker only after confirmed remote, credential/cache/navigation cleanup, and marker removal", async () => {
    const admission = createCredentialAdmissionController();
    await admission.configureStorage(memoryStorage());
    const attempt = admission.beginIncompleteLogout();
    const calls: string[] = [];

    await expect(
      logoutAndPurgeClientSession(
        async () => {
          calls.push("remote");
        },
        queryClient(),
        {
          clearLocalCredentials: async () => {
            calls.push("credentials");
            return {
              platform: "native",
              nativeBearer: "cleared" as const,
              cachedUserInfo: "cleared" as const,
              httpOnlySessionCookie: "not_applicable" as const,
            };
          },
          clearPrivateImageCaches: async () => {
            calls.push("cache");
          },
          resetProtectedNavigation: () => {
            calls.push("navigation");
          },
        },
        {
          confirmPersisted: attempt.confirmPersisted,
          clearAfterConfirmedLogout: async () => {
            calls.push("marker-removal");
            return admission.clearAfterConfirmedLogout(attempt);
          },
        },
      ),
    ).resolves.toMatchObject({
      remoteRevocation: "confirmed",
      credentialAdmission: {
        persistence: { status: "cleared" },
        removal: { status: "cleared" },
      },
    });
    expect(calls).toContain("remote");
    expect(calls.indexOf("marker-removal")).toBeGreaterThan(
      calls.indexOf("navigation"),
    );
    expect(admission.getSnapshot().admitted).toBe(true);
  });
});
