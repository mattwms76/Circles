import { describe, expect, it } from "vitest";
import {
  createMediaWorkAdmission,
  readBoundedEncryptedMediaBody,
} from "../server/_core/storageProxy";

function syntheticEncryptedBody(
  chunks: Uint8Array[],
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("MED-002 media work admission", () => {
  it("rejects a concurrent request before a synthetic signed-object fetch can start", () => {
    const admission = createMediaWorkAdmission({
      maxConcurrentDownloads: 1,
      maxConcurrentDownloadsPerClient: 1,
      budgetWindowMs: 60_000,
      maxBytesPerClientWindow: 1_000,
      maxTrackedClients: 4,
    });
    let signedObjectFetches = 0;

    const startSyntheticDownload = () => {
      const permit = admission.tryAcquire("ip:fixture", 100, 1_000);
      if (permit.kind !== "allowed") return permit;
      signedObjectFetches += 1;
      return permit;
    };

    const first = startSyntheticDownload();
    const second = startSyntheticDownload();

    expect(first.kind).toBe("allowed");
    expect(second).toMatchObject({ kind: "concurrency_limited" });
    expect(signedObjectFetches).toBe(1);
    if (first.kind === "allowed") first.release();
  });

  it("charges bytes=0-0 work as a full frame instead of one response byte", () => {
    const admission = createMediaWorkAdmission({
      maxConcurrentDownloads: 2,
      maxConcurrentDownloadsPerClient: 2,
      budgetWindowMs: 60_000,
      maxBytesPerClientWindow: 20,
      maxTrackedClients: 4,
    });
    const now = Date.now();

    const firstRangeRequest = admission.tryAcquire("ip:fixture", 20, now);
    expect(firstRangeRequest.kind).toBe("allowed");
    if (firstRangeRequest.kind === "allowed") firstRangeRequest.release();

    expect(admission.tryAcquire("ip:fixture", 20, now + 1)).toMatchObject({
      kind: "rate_limited",
    });
  });
});

describe("MED-002 bounded encrypted-body reader", () => {
  it("accepts an exact stream with no Content-Length metadata", async () => {
    const encrypted = await readBoundedEncryptedMediaBody(
      syntheticEncryptedBody([
        Uint8Array.from([1, 2]),
        Uint8Array.from([3, 4]),
      ]),
      4,
    );

    expect(encrypted).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("rejects an overlong stream before allocating beyond the frame budget", async () => {
    await expect(
      readBoundedEncryptedMediaBody(
        syntheticEncryptedBody([Uint8Array.from([1, 2, 3])]),
        2,
      ),
    ).rejects.toThrow("exceeded expected length");
  });
});
