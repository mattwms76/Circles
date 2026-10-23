import { requiresNativeMediaAuthorization } from "../shared/media";

// Local redacted component identity only; not an authorization check or a
// cryptographic confidentiality/checksum mechanism. Raw signed URLs and headers
// must not become React keys or retained failure-state values.
function stableFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
const opaqueIdentities = new WeakMap<object, number>();
let nextOpaqueIdentity = 0;
function opaqueIdentity(source: object): string {
  let id = opaqueIdentities.get(source);
  if (id === undefined) {
    id = ++nextOpaqueIdentity;
    opaqueIdentities.set(source, id);
  }
  return `opaque-object:${id}`;
}
export function mediaSourceUri(source: unknown): string {
  if (typeof source === "string") return source;
  if (
    source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    "uri" in source &&
    typeof source.uri === "string"
  )
    return source.uri;
  return "";
}
function sourceFingerprint(
  source: unknown,
  seen = new WeakSet<object>(),
): string {
  if (typeof source === "string") return `uri:${stableFingerprint(source)}`;
  if (typeof source === "number") return `asset:${source}`;
  if (source && typeof source === "object") {
    if (seen.has(source)) return opaqueIdentity(source);
    seen.add(source);
    if (Array.isArray(source))
      return `sources:${source.map((item) => sourceFingerprint(item, seen)).join(",")}`;
    const uri = mediaSourceUri(source);
    return uri ? `uri:${stableFingerprint(uri)}` : opaqueIdentity(source);
  }
  return `opaque:${typeof source}`;
}
export function mediaArrayAuthorizationUri(
  source: readonly unknown[],
  isWeb: boolean,
): string {
  return (
    source
      .map(mediaSourceUri)
      .find((uri) => requiresNativeMediaAuthorization(uri, isWeb)) ?? ""
  );
}
type AuthorizedMedia = { uri: string; headers?: Record<string, string> } | null;
export function resolveMediaSourceArray(
  source: readonly unknown[],
  authorized: AuthorizedMedia,
  options: { isWeb: boolean; resolveUri: (uri: string) => string },
): unknown[] | null {
  const protectedUri = mediaArrayAuthorizationUri(source, options.isWeb);
  if (
    protectedUri &&
    (!authorized ||
      authorized.uri !== options.resolveUri(protectedUri) ||
      !authorized.headers?.Authorization?.startsWith("Bearer "))
  )
    return null;
  return source.map((candidate) => {
    const uri = mediaSourceUri(candidate);
    if (!uri) return candidate;
    const original =
      typeof candidate === "object" && candidate !== null ? candidate : {};
    if (requiresNativeMediaAuthorization(uri, options.isWeb)) {
      const headers =
        "headers" in original &&
        original.headers &&
        typeof original.headers === "object"
          ? original.headers
          : {};
      return {
        ...original,
        uri: options.resolveUri(uri),
        headers: { ...headers, ...authorized?.headers },
      };
    }
    return { ...original, uri: options.resolveUri(uri) };
  });
}
/** A failed image belongs to one source and account, never to a bearer/header. */
export function mediaFallbackIdentity(input: {
  accountId: number | null | undefined;
  source: unknown;
  resolvedUri: string;
}): string {
  const sourceKey = sourceFingerprint(input.source);
  const resolvedKey = input.resolvedUri
    ? `resolved:${stableFingerprint(input.resolvedUri)}`
    : "unresolved";
  return `account:${input.accountId ?? "guest"}\u0000${sourceKey}\u0000${resolvedKey}`;
}
