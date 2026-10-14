import AsyncStorage from '@react-native-async-storage/async-storage';
import { Upload } from 'tus-js-client';
import { requireSupabase } from './supabase';
type StoredUpload = Parameters<
  NonNullable<ConstructorParameters<typeof Upload>[1]['urlStorage']>['addUpload']
>[1];
const prefix = 'circles:upload:';
export const uploadUrlStorage = {
  async findAllUploads(): Promise<StoredUpload[]> {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
    const entries = await AsyncStorage.multiGet(keys);
    return entries.flatMap(([key, value]) => {
      try {
        return value ? [{ ...JSON.parse(value), urlStorageKey: key }] : [];
      } catch {
        return [];
      }
    });
  },
  async findUploadsByFingerprint(fingerprint: string) {
    const key = prefix + fingerprint;
    const value = await AsyncStorage.getItem(key);
    if (!value) return [];
    try {
      const saved = JSON.parse(value);
      return Date.now() - Date.parse(saved.creationTime) < 23 * 3600000
        ? [{ ...saved, urlStorageKey: key }]
        : [];
    } catch {
      return [];
    }
  },
  async addUpload(fingerprint: string, upload: StoredUpload) {
    const key = prefix + fingerprint;
    await AsyncStorage.setItem(key, JSON.stringify(upload));
    return key;
  },
  async removeUpload(key: string) {
    await AsyncStorage.removeItem(key);
  },
};
export async function resumableUpload(
  bucket: string,
  path: string,
  uri: string,
  mimeType: string,
  size: number,
  onProgress?: (v: number) => void,
  signal?: AbortSignal,
) {
  const client = requireSupabase();
  const {
    data: { session },
    error,
  } = await client.auth.getSession();
  if (error || !session) throw error ?? new Error('Sign in to upload.');
  const endpoint = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL!);
  if (endpoint.hostname.endsWith('.supabase.co'))
    endpoint.hostname = endpoint.hostname.replace('.supabase.co', '.storage.supabase.co');
  endpoint.pathname = '/storage/v1/upload/resumable';
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      error ? reject(error) : resolve();
    };
    const upload = new Upload(
      { uri, name: path.split('/').pop(), type: mimeType } as unknown as File,
      {
        endpoint: endpoint.toString(),
        chunkSize: 6 * 1024 * 1024,
        uploadSize: size,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        removeFingerprintOnSuccess: true,
        urlStorage: uploadUrlStorage,
        fingerprint: async () => JSON.stringify([session.user.id, bucket, path, uri, size]),
        headers: { authorization: `Bearer ${session.access_token}`, 'x-upsert': 'false' },
        onBeforeRequest: async (req) => {
          const {
            data: { session: current },
          } = await client.auth.getSession();
          if (!current || current.user.id !== session.user.id)
            throw new Error('Your account changed. Sign in again to resume.');
          req.setHeader('authorization', `Bearer ${current.access_token}`);
        },
        metadata: {
          bucketName: bucket,
          objectName: path,
          contentType: mimeType,
          cacheControl: '3600',
        },
        onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
        onError: () =>
          finish(
            new Error('Upload paused. Check your connection and retry to resume your saved draft.'),
          ),
        onSuccess: () => {
          onProgress?.(1);
          finish();
        },
      },
    );
    const cancel = () => {
      void upload
        .abort(false)
        .finally(() => finish(new Error('Upload paused. Your draft is saved.')));
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    void upload
      .findPreviousUploads()
      .then((previous) => {
        if (signal?.aborted || settled) return;
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch((error) => finish(error));
  });
}
