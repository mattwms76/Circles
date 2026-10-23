import { describe, expect, it, vi } from "vitest";
import {
  createPinnedManagedStorageLookup,
  resolveManagedStorageTarget,
} from "../server/_core/voiceTranscription";

describe("managed audio SSRF boundary", () => {
  it("pins the HTTPS connector to the validated DNS result without another resolution", async () => {
    const resolver = vi.fn(async (hostname: string) => {
      expect(hostname).toBe("storage.example.test");
      return [{ address: "8.8.8.8", family: 4 }];
    });

    const target = await resolveManagedStorageTarget(
      "https://storage.example.test/audio/object.webm?signature=test",
      resolver,
    );

    expect(target).toMatchObject({
      hostname: "storage.example.test",
      address: "8.8.8.8",
      family: 4,
    });
    expect(resolver).toHaveBeenCalledTimes(1);

    const connectorLookup = createPinnedManagedStorageLookup(target!);
    const connected = vi.fn();
    connectorLookup("storage.example.test", { family: 0 }, connected);

    expect(connected).toHaveBeenCalledExactlyOnceWith(null, "8.8.8.8", 4);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("rejects private DNS answers before a connector can be created", async () => {
    const resolver = vi.fn(async () => [{ address: "::ffff:a00:1", family: 6 }]);

    await expect(resolveManagedStorageTarget("https://storage.example.test/audio.webm", resolver)).resolves.toBeNull();
    expect(resolver).toHaveBeenCalledExactlyOnceWith("storage.example.test");
  });

  it("does not let a pinned connector switch hostnames", async () => {
    const target = await resolveManagedStorageTarget(
      "https://storage.example.test/audio.webm",
      async () => [{ address: "8.8.4.4", family: 4 }],
    );
    const connectorLookup = createPinnedManagedStorageLookup(target!);
    const connected = vi.fn();

    connectorLookup("rebound.example.test", { family: 0 }, connected);

    expect(connected.mock.calls[0]?.[0]).toMatchObject({ code: "EAI_AGAIN" });
    expect(connected.mock.calls[0]?.[1]).toBe("");
  });
});
