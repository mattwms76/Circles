import { Image } from "expo-image";

/**
 * Expo Image exposes global native caches rather than account namespaces.
 * Clearing both at the local account boundary prevents a later account from
 * rendering an already-cached private image while authorization is rechecked.
 */
export async function clearPrivateImageCaches(): Promise<void> {
  await Promise.allSettled([
    Image.clearMemoryCache(),
    Image.clearDiskCache(),
  ]);
}
