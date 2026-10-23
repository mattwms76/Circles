import { describe, expect, it, vi } from "vitest";
import {
  mediaArrayAuthorizationUri,
  mediaFallbackIdentity,
  resolveMediaSourceArray,
} from "../lib/media-fallback";
import {
  nativeMediaRequestKey,
  nativeMediaTokenForRequest,
} from "../lib/media-cache";
vi.mock("expo-image", () => ({
  Image: { clearMemoryCache: vi.fn(), clearDiskCache: vi.fn() },
}));
const protectedA =
    "/manus-storage/social-encrypted/1/00000000-0000-4000-8000-000000000001.jpg.enc",
  protectedB =
    "/manus-storage/social-encrypted/1/00000000-0000-4000-8000-000000000002.jpg.enc";
const publicUri = "https://images.example/public.png";
const resolveUri = (uri: string) =>
  uri.startsWith("/") ? `https://api.example${uri}` : uri;
const options = { isWeb: false, resolveUri };
describe("media array authorization and fallback reset", () => {
  it("keeps every protected native array idle until its selected current request bearer is available", () => {
    const sources = [
      { uri: publicUri },
      {
        uri: protectedA,
        headers: { Authorization: "Bearer caller-placeholder" },
      },
      { uri: protectedB },
    ];
    expect(mediaArrayAuthorizationUri(sources, false)).toBe(protectedA);
    expect(resolveMediaSourceArray(sources, null, options)).toBeNull();
    const prior = nativeMediaRequestKey(1, resolveUri(protectedA));
    const next = nativeMediaRequestKey(2, resolveUri(protectedA));
    const token = nativeMediaTokenForRequest(
      { requestKey: prior, settled: true, token: "synthetic-token" },
      next,
    );
    expect(token).toBeNull();
    const authorized = {
      uri: resolveUri(protectedA),
      headers: { Authorization: "Bearer synthetic-token" },
    };
    expect(resolveMediaSourceArray(sources, authorized, options)).toEqual([
      { uri: publicUri },
      {
        uri: resolveUri(protectedA),
        headers: { Authorization: "Bearer synthetic-token" },
      },
      {
        uri: resolveUri(protectedB),
        headers: { Authorization: "Bearer synthetic-token" },
      },
    ]);
    expect(
      resolveMediaSourceArray(
        sources,
        { ...authorized, uri: resolveUri(protectedB) },
        options,
      ),
    ).toBeNull();
  });
  it("retains numeric/public candidates and normalizes web candidates without injecting a native bearer", () => {
    const sources = [42, { uri: publicUri }, { uri: protectedA }];
    expect(
      resolveMediaSourceArray(sources, null, { ...options, isWeb: true }),
    ).toEqual([42, { uri: publicUri }, { uri: resolveUri(protectedA) }]);
    expect(
      resolveMediaSourceArray([42, { uri: publicUri }], null, options),
    ).toEqual([42, { uri: publicUri }]);
  });
  it("resets changed malformed sources and non-selected array candidates without retaining raw keys/headers", () => {
    const first = {
        asset: "invalid-first",
        headers: { Authorization: "private-value" },
      },
      second = { asset: "invalid-second" };
    const key = (source: unknown) =>
      mediaFallbackIdentity({
        accountId: 7,
        source,
        resolvedUri: resolveUri(protectedA),
      });
    expect(key([first])).toBe(key([first]));
    expect(key([first])).not.toBe(key([second]));
    expect(key([first])).not.toContain("private-value");
    expect(key([first])).not.toContain("invalid-first");
    expect(key([{ uri: protectedA }, { uri: publicUri }])).not.toBe(
      key([{ uri: protectedA }, { uri: "https://images.example/changed.png" }]),
    );
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => key(cycle)).not.toThrow();
  });
});
