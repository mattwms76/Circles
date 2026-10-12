import * as FileSystem from "expo-file-system/legacy";
import { requireSupabase } from "./supabase";
export async function uploadWithProgress(
  bucket: string,
  path: string,
  uri: string,
  mimeType: string,
  onProgress?: (value: number) => void,
  signal?: AbortSignal,
) {
  const client = requireSupabase();
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  if (error) throw error;
  if (signal?.aborted)
    throw new Error("Upload cancelled. Your draft is saved.");
  const task = FileSystem.createUploadTask(
    data.signedUrl,
    uri,
    {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": mimeType, "x-upsert": "false" },
    },
    (progress) =>
      onProgress?.(
        progress.totalBytesExpectedToSend > 0
          ? progress.totalBytesSent / progress.totalBytesExpectedToSend
          : 0,
      ),
  );
  const cancel = () => {
    void task.cancelAsync().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const response = await task.uploadAsync();
    if (!response || signal?.aborted)
      throw new Error("Upload cancelled. Your draft is saved.");
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        "Upload did not finish. Check your connection and retry.",
      );
    onProgress?.(1);
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
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
      .storage.from("post-media")
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
