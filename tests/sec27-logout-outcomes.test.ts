import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearLocalSessionCredentials } from "../lib/_core/auth";
import {
  ClientSessionLogoutIncompleteError,
  clientLogoutOutcomeFromError,
  describeClientLogoutOutcome as describePurgeLogoutOutcome,
  logoutAndPurgeClientSession,
} from "../lib/client-session";

const mocks = vi.hoisted(() => ({
  platform: { OS: "ios" },
  deleteItemAsync: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: mocks.deleteItemAsync,
}));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("@/constants/oauth", () => ({
  SESSION_TOKEN_KEY: "sec27-session-token",
  USER_INFO_KEY: "sec27-user-info",
}));

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("SEC008 truthful logout outcomes", () => {
  beforeEach(() => {
    mocks.platform.OS = "ios";
    mocks.deleteItemAsync.mockReset();
    mocks.deleteItemAsync.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports native secure credential deletion failure without claiming the credential was cleared", async () => {
    mocks.deleteItemAsync.mockImplementation(async (key: string) => {
      if (key === "sec27-session-token") {
        throw new Error("synthetic SecureStore deletion rejection");
      }
    });

    const outcome = await clearLocalSessionCredentials();

    expect(outcome).toEqual({
      platform: "native",
      nativeBearer: "failed",
      cachedUserInfo: "cleared",
      httpOnlySessionCookie: "not_applicable",
    });
    expect(mocks.deleteItemAsync).toHaveBeenCalledWith("sec27-session-token");
    expect(mocks.deleteItemAsync).toHaveBeenCalledWith("sec27-user-info");
  });

  it("does not call a failed remote web logout locally complete when the HttpOnly cookie remains server-owned", async () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(["trpc", "social.private"], ["private value"]);

    const failure = await logoutAndPurgeClientSession(
      async () => Promise.reject(),
      queryClient,
      {
        clearLocalCredentials: async () => ({
          platform: "web",
          nativeBearer: "not_applicable",
          cachedUserInfo: "cleared",
          httpOnlySessionCookie: "server_required",
        }),
        clearPrivateImageCaches: async () => undefined,
        resetProtectedNavigation: () => undefined,
      },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ClientSessionLogoutIncompleteError);
    const outcome = clientLogoutOutcomeFromError(failure);
    expect(outcome).not.toBeNull();
    expect(outcome?.remoteRevocation).toBe("unconfirmed");
    expect(
      queryClient.getQueryData(["trpc", "social.private"]),
    ).toBeUndefined();

    const recovery = describePurgeLogoutOutcome(outcome!);
    expect(recovery.complete).toBe(false);
    expect(recovery.blocksAuthenticatedContinuation).toBe(true);
    expect(recovery.localCredentialStatus).toContain("HttpOnly session cookie");
    expect(recovery.message).toContain("cannot be cleared locally");
    expect(recovery.message).toContain("Retry secure sign-out");
  });

  it("keeps normal continuation blocked after combined remote and native failure, then clears the block after explicit retry", async () => {
    const firstQueryClient = makeQueryClient();
    const firstFailure = await logoutAndPurgeClientSession(
      async () => {
        throw new Error("synthetic remote outage");
      },
      firstQueryClient,
      {
        clearLocalCredentials: async () => ({
          platform: "native",
          nativeBearer: "failed",
          cachedUserInfo: "cleared",
          httpOnlySessionCookie: "not_applicable",
        }),
        clearPrivateImageCaches: async () => undefined,
        resetProtectedNavigation: () => undefined,
      },
    ).catch((error: unknown) => error);
    const firstOutcome = clientLogoutOutcomeFromError(firstFailure);
    const firstRecovery = describePurgeLogoutOutcome(firstOutcome!);

    expect(firstRecovery.complete).toBe(false);
    expect(firstRecovery.blocksAuthenticatedContinuation).toBe(true);
    expect(firstRecovery.message).toContain(
      "could not remove its secure credential",
    );
    expect(firstRecovery.remoteStatus).toContain("could not be confirmed");

    const retryOutcome = await logoutAndPurgeClientSession(
      async () => undefined,
      makeQueryClient(),
      {
        clearLocalCredentials: async () => ({
          platform: "native",
          nativeBearer: "cleared",
          cachedUserInfo: "cleared",
          httpOnlySessionCookie: "not_applicable",
        }),
        clearPrivateImageCaches: async () => undefined,
        resetProtectedNavigation: () => undefined,
      },
    );
    const retryRecovery = describePurgeLogoutOutcome(retryOutcome);

    expect(retryRecovery.complete).toBe(true);
    expect(retryRecovery.blocksAuthenticatedContinuation).toBe(false);
    expect(retryRecovery.remoteStatus).toContain("confirmed");
    expect(retryRecovery.localCredentialStatus).toContain(
      "removed its secure credential",
    );
  });
});
