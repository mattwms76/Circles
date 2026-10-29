import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPrivateImageCaches } from "../lib/media-cache";
import {
  ClientSessionLogoutIncompleteError,
  clientLogoutOutcomeFromError,
  describeClientLogoutOutcome,
  logoutAndPurgeClientSession,
} from "../lib/client-session";

const mocks = vi.hoisted(() => ({
  clearDiskCache: vi.fn(),
  clearMemoryCache: vi.fn(),
}));

vi.mock("expo-image", () => ({
  Image: {
    clearDiskCache: mocks.clearDiskCache,
    clearMemoryCache: mocks.clearMemoryCache,
  },
}));

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const rejectedCacheCases = [
  { name: "memory-only", rejectDisk: false, rejectMemory: true },
  { name: "disk-only", rejectDisk: true, rejectMemory: false },
  { name: "both caches", rejectDisk: true, rejectMemory: true },
] as const;

function rejectConfiguredCaches({
  name,
  rejectDisk,
  rejectMemory,
}: (typeof rejectedCacheCases)[number]): void {
  if (rejectMemory) {
    mocks.clearMemoryCache.mockRejectedValueOnce(
      new Error(`synthetic ${name} cache clear failure`),
    );
  }
  if (rejectDisk) {
    mocks.clearDiskCache.mockRejectedValueOnce(
      new Error(`synthetic ${name} cache clear failure`),
    );
  }
}

describe("CBA-05 private image cache cleanup", () => {
  beforeEach(() => {
    mocks.clearMemoryCache.mockReset();
    mocks.clearDiskCache.mockReset();
    mocks.clearMemoryCache.mockResolvedValue(undefined);
    mocks.clearDiskCache.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves only after both global image caches clear", async () => {
    await expect(clearPrivateImageCaches()).resolves.toBeUndefined();

    expect(mocks.clearMemoryCache).toHaveBeenCalledOnce();
    expect(mocks.clearDiskCache).toHaveBeenCalledOnce();
  });

  it.each(rejectedCacheCases)(
    "rejects when the $name clear rejects",
    async (cacheCase) => {
      rejectConfiguredCaches(cacheCase);

      await expect(clearPrivateImageCaches()).rejects.toThrow(
        `synthetic ${cacheCase.name} cache clear failure`,
      );
      expect(mocks.clearMemoryCache).toHaveBeenCalledOnce();
      expect(mocks.clearDiskCache).toHaveBeenCalledOnce();
    },
  );

  it.each(rejectedCacheCases)(
    "keeps credential admission closed after a $name clear rejection",
    async (cacheCase) => {
      rejectConfiguredCaches(cacheCase);
      const confirmPersisted = vi.fn(async () => true);
      const clearAfterConfirmedLogout = vi.fn(async () => true);
      const queryClient = makeQueryClient();
      queryClient.setQueryData(["trpc", "social.private"], ["private"]);

      const failure = await logoutAndPurgeClientSession(
        async () => undefined,
        queryClient,
        {
          clearLocalCredentials: async () => ({
            cachedUserInfo: "cleared" as const,
            httpOnlySessionCookie: "not_applicable" as const,
            nativeBearer: "cleared" as const,
            platform: "native" as const,
          }),
          clearPrivateImageCaches,
          resetProtectedNavigation: () => undefined,
        },
        { clearAfterConfirmedLogout, confirmPersisted },
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ClientSessionLogoutIncompleteError);
      const outcome = clientLogoutOutcomeFromError(failure);
      expect(outcome).not.toBeNull();
      expect(outcome?.remoteRevocation).toBe("confirmed");
      expect(outcome?.purge.privateImageCaches.status).toBe("failed");
      expect(outcome?.credentialAdmission.persistence.status).toBe("cleared");
      expect(outcome?.credentialAdmission.removal.status).toBe("not_requested");
      expect(clearAfterConfirmedLogout).not.toHaveBeenCalled();
      expect(
        queryClient.getQueryData(["trpc", "social.private"]),
      ).toBeUndefined();

      const recovery = describeClientLogoutOutcome(outcome!);
      expect(recovery.complete).toBe(false);
      expect(recovery.blocksAuthenticatedContinuation).toBe(true);
      expect(recovery.privateImageCacheStatus).toContain(
        "could not be completed",
      );
      expect(recovery.credentialAdmissionStatus).toContain("remains closed");
    },
  );
});
