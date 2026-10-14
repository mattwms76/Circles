import { resumableUpload } from './resumableUpload';
import * as FileSystem from 'expo-file-system/legacy';
import { requireSupabase } from './supabase';
export async function uploadWithProgress(
  bucket: string,
  path: string,
  uri: string,
  mimeType: string,
  onProgress?: (value: number) => void,
  signal?: AbortSignal,
) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error('The attachment is no longer on this device. Choose it again.');
  await resumableUpload(bucket, path, uri, mimeType, info.size, onProgress, signal);
}

const signedCache = new Map<string, { url: string; expires: number }>();
export function clearMediaCache() {
  signedCache.clear();
}
export async function signedMediaUrls(
  paths: string[],
  userId: string,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const missing = unique.filter(
    (path) =>
      !signedCache.has(`${userId}:${path}`) ||
      signedCache.get(`${userId}:${path}`)!.expires <= Date.now(),
  );
  if (missing.length) {
    const { data, error } = await requireSupabase()
      .storage.from('post-media')
      .createSignedUrls(missing, 600);
    if (error) throw error;
    for (const item of data ?? []) {
      if (item.path && item.signedUrl && !item.error)
        signedCache.set(`${userId}:${item.path}`, {
          url: item.signedUrl,
          expires: Date.now() + 8 * 60_000,
        });
    }
  }
  // Bound the cache for long sessions.
  if (signedCache.size > 500)
    for (const key of [...signedCache.keys()].slice(0, signedCache.size - 500))
      signedCache.delete(key);
  return new Map(
    unique.flatMap((path) => {
      const item = signedCache.get(`${userId}:${path}`);
      return item ? [[path, item.url] as const] : [];
    }),
  );
}

export async function refreshMediaUrl(path: string): Promise<string> {
  const { data, error } = await requireSupabase()
    .storage.from('post-media')
    .createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
