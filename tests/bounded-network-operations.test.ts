import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notifyOwner } from "../server/_core/notification";
import { StorageOperationError, storageGetSignedUrl } from "../server/storage";

const runtime = vi.hoisted(() => {
  process.env.BUILT_IN_FORGE_API_URL = "https://forge.synthetic.invalid";
  process.env.BUILT_IN_FORGE_API_KEY = "synthetic-forge-key";
  return {};
});

function stalledFetchThatHonorsAbort() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
}

describe("bounded upstream operation contracts", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stalledFetchThatHonorsAbort());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes a caller disconnect signal through signed-download preparation", async () => {
    const controller = new AbortController();
    const operation = storageGetSignedUrl("synthetic/key", {
      signal: controller.signal,
    });
    controller.abort();

    await expect(operation).rejects.toBeInstanceOf(StorageOperationError);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.signal as AbortSignal | undefined)?.aborted).toBe(true);
  });

  it("returns generic failed delivery when a notification transport is aborted", async () => {
    const controller = new AbortController();
    const operation = notifyOwner(
      { title: "Synthetic", content: "No network delivery" },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(operation).resolves.toBe(false);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.signal as AbortSignal | undefined)?.aborted).toBe(true);
  });
});

void runtime;
