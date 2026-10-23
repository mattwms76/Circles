import { describe, expect, it, vi } from "vitest";
import {
  OutboundRequestTimeoutError,
  fetchWithDeadline,
  isPublicInternetHostname,
  isTrustedPreviewProxyRequest,
  PREVIEW_PROXY_HEADER,
  readBoundedResponseBody,
  signPreviewLimiterIdentity,
  verifyPreviewLimiterIdentity,
} from "../server/_core/runtimeSecurity";
import { canonicalManagedStorageKey } from "../server/_core/voiceTranscription";

function body(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("runtime security boundaries", () => {
  it("accepts only an unexpired HMAC-signed Preview limiter identity", () => {
    const now = 1_700_000_000;
    const identity = "browser_identity_123";
    const secret = "test-only-runtime-limiter-secret";
    const token = signPreviewLimiterIdentity(identity, now + 60, secret);

    expect(verifyPreviewLimiterIdentity(token ?? undefined, now, secret)).toBe(identity);
    expect(verifyPreviewLimiterIdentity(`${token}x`, now, secret)).toBeNull();
    expect(verifyPreviewLimiterIdentity(token ?? undefined, now + 61, secret)).toBeNull();
  });

  it("fails closed for request-like Preview inputs without a loopback socket", () => {
    const requestLike = {
      headers: {
        [PREVIEW_PROXY_HEADER]: "1",
        "x-forwarded-proto": "https",
      },
    };

    expect(() => isTrustedPreviewProxyRequest(requestLike as never, "https")).not.toThrow();
    expect(isTrustedPreviewProxyRequest(requestLike as never, "https")).toBe(false);
    expect(isTrustedPreviewProxyRequest({ headers: requestLike.headers, socket: {} } as never, "https")).toBe(false);
  });

  it("rejects private and reserved IPv4-mapped IPv6 after URL normalization", () => {
    for (const hostname of [
      "::ffff:a00:1", // 10.0.0.1
      "::ffff:ac10:1", // 172.16.0.1
      "::ffff:c0a8:109", // 192.168.1.9
      "::ffff:7f00:1", // 127.0.0.1
      "::ffff:a9fe:1", // 169.254.0.1
      "::ffff:6440:1", // 100.64.0.1
      "::ffff:0:1", // 0.0.0.1
      "::ffff:e000:1", // 224.0.0.1
    ]) {
      expect(isPublicInternetHostname(hostname), hostname).toBe(false);
    }
    expect(isPublicInternetHostname("::ffff:808:808")).toBe(true);
  });

  it("rejects general reserved IPv6 ranges while permitting global unicast", () => {
    for (const hostname of ["::", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2002::1"]) {
      expect(isPublicInternetHostname(hostname), hostname).toBe(false);
    }
    expect(isPublicInternetHostname("2606:4700:4700::1111")).toBe(true);
  });

  it("caps response streams before an oversized body is accumulated", async () => {
    await expect(
      readBoundedResponseBody(body([Uint8Array.from([1, 2]), Uint8Array.from([3])]), 2),
    ).rejects.toThrow("exceeded configured limit");
    await expect(readBoundedResponseBody(body([Uint8Array.from([1, 2])]), 2)).resolves.toEqual(
      Buffer.from([1, 2]),
    );
  });

  it("turns a stalled outbound request into a fixed timeout category", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    );
    try {
      await expect(fetchWithDeadline("https://example.test", {}, 5)).rejects.toBeInstanceOf(
        OutboundRequestTimeoutError,
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("accepts canonical managed-storage paths but rejects URL, traversal, and malformed input", () => {
    expect(canonicalManagedStorageKey("/manus-storage/audio/abc.webm")).toBe("audio/abc.webm");
    expect(canonicalManagedStorageKey("audio/abc.webm")).toBe("audio/abc.webm");
    for (const value of [
      "https://127.0.0.1/private.wav",
      "/manus-storage/../private.wav",
      "audio//double-slash.wav",
      "audio/file.wav?query=1",
    ]) {
      expect(canonicalManagedStorageKey(value)).toBeNull();
    }
  });
});
