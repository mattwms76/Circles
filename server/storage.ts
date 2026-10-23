// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import { ENV } from "./_core/env";
import {
  fetchWithDeadline,
  OutboundRequestTimeoutError,
  readBoundedResponseBody,
} from "./_core/runtimeSecurity";

export class StorageOperationError extends Error {
  constructor(message = "Storage service is unavailable") {
    super(message);
    this.name = "StorageOperationError";
  }
}

export class StorageOperationTimeoutError extends StorageOperationError {
  constructor() {
    super("Storage service timed out");
    this.name = "StorageOperationTimeoutError";
  }
}

export type StorageRequestOptions = {
  /** Handler-scoped cancellation signal; callers retain ownership of its lifecycle. */
  signal?: AbortSignal;
};

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new StorageOperationError("Storage service is unavailable");
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

async function storageFetch(input: Parameters<typeof fetch>[0], init: RequestInit): Promise<Response> {
  try {
    return await fetchWithDeadline(input, init);
  } catch (error) {
    if (error instanceof OutboundRequestTimeoutError) throw new StorageOperationTimeoutError();
    throw new StorageOperationError();
  }
}

async function discardErrorResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function parsePresignedUrl(response: Response): Promise<string> {
  try {
    const responseBody = await readBoundedResponseBody(response.body, 64 * 1024);
    const body = JSON.parse(responseBody.toString("utf8")) as { url?: unknown };
    if (typeof body.url !== "string") throw new Error("missing url");
    const url = new URL(body.url);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe url");
    return url.toString();
  } catch {
    throw new StorageOperationError("Storage service returned an invalid response");
  }
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
  options: { stableKey?: boolean } & StorageRequestOptions = {},
): Promise<{ key: string; url: string }> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const normalizedKey = normalizeKey(relKey);
  const key = options.stableKey ? normalizedKey : appendHashSuffix(normalizedKey);

  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await storageFetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
    signal: options.signal,
  });
  if (!presignResp.ok) {
    await discardErrorResponse(presignResp);
    throw new StorageOperationError("Storage upload could not be prepared");
  }
  const s3Url = await parsePresignedUrl(presignResp);

  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const uploadResp = await storageFetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
    signal: options.signal,
  });
  if (!uploadResp.ok) {
    await discardErrorResponse(uploadResp);
    throw new StorageOperationError("Storage upload failed");
  }
  await uploadResp.body?.cancel().catch(() => undefined);

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(
  relKey: string,
  options: StorageRequestOptions = {},
): Promise<string> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);
  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const response = await storageFetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
    signal: options.signal,
  });
  if (!response.ok) {
    await discardErrorResponse(response);
    throw new StorageOperationError("Storage download could not be prepared");
  }
  return parsePresignedUrl(response);
}
