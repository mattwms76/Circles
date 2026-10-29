import { Image } from "expo-image";

export type NativeMediaTokenState = {
  requestKey: string;
  settled: boolean;
  token: string | null;
};

/** The identity and exact proxied URI both scope a native bearer header. */
export function nativeMediaRequestKey(
  userId: number | null | undefined,
  uri: string,
): string {
  return `${userId ?? "guest"}\u0000${uri}`;
}

/** Never reuse a prior account or URI's token while a new lookup is pending. */
export function nativeMediaTokenForRequest(
  state: NativeMediaTokenState,
  requestKey: string,
): string | null {
  if (!state.settled || state.requestKey !== requestKey) return null;
  return state.token;
}

/**
 * Expo Image exposes global native caches rather than account namespaces.
 * Clearing both at the local account boundary prevents a later account from
 * rendering an already-cached private image while authorization is rechecked.
 * A rejected clear must remain visible to the logout fence, which retains its
 * incomplete-logout marker until a retry can clear both caches.
 */
export async function clearPrivateImageCaches(): Promise<void> {
  const results = await Promise.allSettled([
    Image.clearMemoryCache(),
    Image.clearDiskCache(),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    throw failure.reason;
  }
}
