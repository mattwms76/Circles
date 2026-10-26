import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailAuthAsyncGuard } from "../lib/email-auth-ui";

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

describe("email authentication cancellation", () => {
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

  it("does not commit a native token when a dialog is canceled before its deferred response", async () => {
    const response = deferred<unknown>();
    const controller = new AbortController();
    mocks.apiCall.mockReturnValueOnce(response.promise);

    const signIn = client.signInWithEmailPassword(
      "closed@example.test",
      "password",
      {
        signal: controller.signal,
        isCurrent: () => !controller.signal.aborted,
      },
    );
    controller.abort();
    response.resolve({ success: true, sessionToken: "old-modal-token" });

    await expect(signIn).resolves.toBeUndefined();
    expect(mocks.setSessionToken).not.toHaveBeenCalled();
  });

  it("drains a native write already in progress before a caller may purge credentials", async () => {
    const tokenStored = deferred<void>();
    const writeStarted = deferred<void>();
    mocks.apiCall.mockResolvedValueOnce({
      success: true,
      sessionToken: "inflight-token",
    });
    mocks.setSessionToken.mockImplementationOnce(() => {
      writeStarted.resolve();
      return tokenStored.promise;
    });

    const signIn = client.signInWithEmailPassword(
      "drain@example.test",
      "password",
    );
    await writeStarted.promise;

    let drained = false;
    const draining = client.cancelAndDrainEmailAuthRequests().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    tokenStored.resolve();
    await Promise.all([signIn, draining]);
    expect(drained).toBe(true);
  });

  it("rejects a deferred older scope across an A-to-B-to-A transition", async () => {
    const guard = createEmailAuthAsyncGuard(81);
    guard.activate();
    const firstSignIn = guard.begin("signIn");
    const oldResponse = deferred<unknown>();
    mocks.apiCall.mockReturnValueOnce(oldResponse.promise);

    const oldSignIn = client.signInWithEmailPassword(
      "first@example.test",
      "password",
      { isCurrent: () => guard.isCurrent(firstSignIn, "signIn") },
    );

    guard.invalidate();
    guard.begin("connect");
    guard.invalidate();
    const secondSignIn = guard.begin("signIn");
    const newResponse = deferred<unknown>();
    mocks.apiCall.mockReturnValueOnce(newResponse.promise);
    const newSignIn = client.signInWithEmailPassword(
      "second@example.test",
      "password",
      { isCurrent: () => guard.isCurrent(secondSignIn, "signIn") },
    );

    oldResponse.resolve({ success: true, sessionToken: "old-token" });
    newResponse.resolve({ success: true, sessionToken: "new-token" });
    await Promise.all([oldSignIn, newSignIn]);

    expect(mocks.setSessionToken).toHaveBeenCalledTimes(1);
    expect(mocks.setSessionToken).toHaveBeenCalledWith("new-token");
  });

  it("rejects a deferred strict-mode replay scope after cleanup", async () => {
    const guard = createEmailAuthAsyncGuard(82);
    guard.activate();
    const first = guard.begin("signIn");
    const oldResponse = deferred<unknown>();
    mocks.apiCall.mockReturnValueOnce(oldResponse.promise);
    const oldSignIn = client.signInWithEmailPassword(
      "strict-old@example.test",
      "password",
      { isCurrent: () => guard.isCurrent(first, "signIn") },
    );

    guard.deactivate();
    guard.activate();
    const replay = guard.begin("signIn");
    const newResponse = deferred<unknown>();
    mocks.apiCall.mockReturnValueOnce(newResponse.promise);
    const replaySignIn = client.signInWithEmailPassword(
      "strict-new@example.test",
      "password",
      { isCurrent: () => guard.isCurrent(replay, "signIn") },
    );

    oldResponse.resolve({ success: true, sessionToken: "strict-old-token" });
    newResponse.resolve({ success: true, sessionToken: "strict-new-token" });
    await Promise.all([oldSignIn, replaySignIn]);

    expect(mocks.setSessionToken).toHaveBeenCalledTimes(1);
    expect(mocks.setSessionToken).toHaveBeenCalledWith("strict-new-token");
  });
});
