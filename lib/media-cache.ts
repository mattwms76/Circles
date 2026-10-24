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
 */
export async function clearPrivateImageCaches(): Promise<void> {
  await Promise.allSettled([Image.clearMemoryCache(), Image.clearDiskCache()]);
}
