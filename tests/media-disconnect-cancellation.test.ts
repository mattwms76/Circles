import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBoundedEncryptedMedia } from "../server/_core/storageProxy";
import { RequestAbortedError } from "../server/_core/bounded-network";

vi.mock("../server/db", () => ({ getDb: vi.fn() }));
const storageMocks = vi.hoisted(() => ({
  storageGetSignedUrl: vi.fn(),
  storageFetchSignedObject: vi.fn(),
  StorageOperationTimeoutError: class StorageOperationTimeoutError extends Error {},
}));
vi.mock("../server/storage", () => storageMocks);
vi.mock("../server/social-service", () => ({
  decryptSocialMedia: vi.fn(),
  SOCIAL_MEDIA_FRAME_OVERHEAD: 28,
}));
vi.mock("../server/_core/sdk", () => ({ sdk: {} }));

afterEach(() => vi.unstubAllGlobals());

describe("protected media download cancellation", () => {
  it("refuses an already disconnected request before remote work", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchBoundedEncryptedMedia(
        "https://storage.example.invalid/file",
        28,
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(RequestAbortedError);
    expect(storageMocks.storageFetchSignedObject).not.toHaveBeenCalled();
  });

  it("aborts a pending transport when the owning request disconnects", async () => {
    const controller = new AbortController();
    let transportSignal: AbortSignal | undefined;
    storageMocks.storageFetchSignedObject.mockImplementation(
      (_url: string, options: { signal?: AbortSignal }) => {
        transportSignal = options.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          transportSignal?.addEventListener(
            "abort",
            () => reject(new Error("synthetic aborted transport")),
            { once: true },
          );
        });
      },
    );
    const result = fetchBoundedEncryptedMedia(
      "https://storage.example.invalid/file",
      28,
      controller.signal,
    );
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(RequestAbortedError);
    expect(transportSignal?.aborted).toBe(true);
  });
});
