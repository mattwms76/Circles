// Preconfigured storage helpers for Manus WebDev templates.
// All signer and signed-object transfers use explicit configured HTTPS origins and a fresh
// DNS-pinned TLS connection. A signed URL is not an authority to contact an arbitrary host.

import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { Agent, request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { ENV } from "./_core/env";
import {
  BoundedOperationTimeoutError,
  withOperationDeadline,
} from "./_core/bounded-network";
import { parseStorageObjectOrigins } from "./_core/sec27-security-configuration.mjs";
import {
  isPublicInternetHostname,
  OutboundRequestTimeoutError,
  readBoundedResponseBody,
} from "./_core/runtimeSecurity";

const STORAGE_REQUEST_TIMEOUT_MS = 15_000;
const MAX_PRESIGN_RESPONSE_BYTES = 64 * 1024;

export type StorageDnsAddress = {
  address: string;
  family: number;
};

export type StorageDnsResolver = (
  hostname: string,
) => Promise<StorageDnsAddress[]>;

type StorageDnsResolutionOptions = {
  /** Cancellation applies to the wait, although Node's DNS promise itself cannot be cancelled. */
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type PinnedStorageTarget = {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
};

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

function configuredOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      isIP(url.hostname) !== 0 ||
      !isPublicInternetHostname(url.hostname)
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Parses only deployment-owned object origins. This is deliberately not inferred from a signed
 * URL: missing or malformed configuration disables media transfer rather than guessing a host.
 */
export function configuredStorageObjectOrigins(
  configured = process.env.CIRCLES_STORAGE_OBJECT_ORIGINS ?? "",
): Set<string> | null {
  return parseStorageObjectOrigins(configured);
}

function getForgeConfig() {
  const forgeKey = ENV.forgeApiKey;
  const signerOrigin = configuredOrigin(ENV.forgeApiUrl);
  const objectOrigins = configuredStorageObjectOrigins();

  if (!forgeKey || !signerOrigin || !objectOrigins) {
    throw new StorageOperationError("Storage service is unavailable");
  }

  return { forgeUrl: signerOrigin, forgeKey, objectOrigins };
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

function requestAborted(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Storage request aborted");
}

function isSafeSignedObjectUrl(url: URL, allowedOrigins: Set<string>): boolean {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.hash &&
    isIP(url.hostname) === 0 &&
    isPublicInternetHostname(url.hostname) &&
    allowedOrigins.has(url.origin)
  );
}

/**
 * Resolves every configured target before connecting. Refusing mixed/private answers prevents an
 * allowed storage name from switching to an internal destination; the selected public answer is
 * then pinned into the TLS request below.
 */
export async function resolveConfiguredStorageTarget(
  value: string | URL,
  allowedOrigins: Set<string>,
  resolveAddresses: StorageDnsResolver = (hostname) =>
    lookup(hostname, { all: true, verbatim: true }),
  options: StorageDnsResolutionOptions = {},
): Promise<PinnedStorageTarget> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorageOperationError(
      "Storage service returned an invalid response",
    );
  }
  if (!isSafeSignedObjectUrl(url, allowedOrigins)) {
    throw new StorageOperationError(
      "Storage service returned an invalid response",
    );
  }

  let addresses: StorageDnsAddress[];
  try {
    // dns/promises has no AbortSignal interface. Bound the wait and keep the losing DNS promise
    // observed via withOperationDeadline; a late resolver failure therefore cannot leak as an
    // unhandled rejection after the caller has disconnected or the deadline has elapsed.
    addresses = await withOperationDeadline(
      Promise.resolve().then(() => resolveAddresses(url.hostname)),
      options.timeoutMs ?? STORAGE_REQUEST_TIMEOUT_MS,
      options.signal,
    );
  } catch (error) {
    if (error instanceof BoundedOperationTimeoutError) {
      throw new StorageOperationTimeoutError();
    }
    if (options.signal?.aborted) throw requestAborted(options.signal);
    throw new StorageOperationError("Storage service is unavailable");
  }
  if (
    !addresses.length ||
    addresses.some(
      ({ address, family }) =>
        (family !== 4 && family !== 6) ||
        isIP(address) !== family ||
        !isPublicInternetHostname(address),
    )
  ) {
    throw new StorageOperationError(
      "Storage service returned an invalid response",
    );
  }

  const [selected] = addresses;
  return {
    url,
    hostname: url.hostname,
    address: selected.address,
    family: selected.family as 4 | 6,
  };
}

function createPinnedStorageLookup(
  target: PinnedStorageTarget,
): LookupFunction {
  return (hostname, _options, callback) => {
    if (hostname !== target.hostname) {
      callback(
        Object.assign(new Error("Pinned storage hostname mismatch"), {
          code: "EAI_AGAIN",
        }),
        "",
        target.family,
      );
      return;
    }
    callback(null, target.address, target.family);
  };
}

/**
 * Opens one redirect-free HTTPS request using the verified DNS answer. The URL hostname remains
 * both the HTTP Host and TLS SNI value, so certificate validation still applies to the configured
 * deployment hostname instead of the pinned address literal.
 */
async function requestPinnedStorage(
  target: PinnedStorageTarget,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer;
    signal?: AbortSignal;
  },
  timeoutMs = STORAGE_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  if (init.signal?.aborted) throw requestAborted(init.signal);

  return new Promise((resolve, reject) => {
    const agent = new Agent({
      keepAlive: false,
      maxSockets: 1,
      lookup: createPinnedStorageLookup(target),
    });
    let request!: ReturnType<typeof httpsRequest>;
    let response: IncomingMessage | undefined;
    let headersSettled = false;
    let disposed = false;
    let timeout: NodeJS.Timeout | undefined;

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (timeout) clearTimeout(timeout);
      init.signal?.removeEventListener("abort", onAbort);
      agent.destroy();
    };
    const rejectBeforeHeaders = (error: Error) => {
      if (headersSettled) return;
      headersSettled = true;
      dispose();
      reject(error);
    };
    const destroyTransfer = (error: Error) => {
      // Destroying both sides is deliberate: a response body can stall after headers, while the
      // ClientRequest itself remains open until its agent is explicitly disposed.
      response?.destroy(error);
      if (!request.destroyed) request.destroy(error);
      rejectBeforeHeaders(error);
      dispose();
    };
    const onAbort = () => {
      const error = requestAborted(init.signal);
      destroyTransfer(error);
    };

    request = httpsRequest(
      target.url,
      {
        agent,
        method: init.method ?? "GET",
        headers: init.headers,
        family: target.family,
        servername: target.hostname,
        rejectUnauthorized: true,
      },
      (incoming: IncomingMessage) => {
        response = incoming;
        // This remains attached while the web stream consumes the response, including the path
        // where this module intentionally destroys an IncomingMessage after a deadline or abort.
        incoming.once("error", dispose);
        if (headersSettled || disposed) {
          incoming.destroy();
          return;
        }
        // Node's HTTPS client never follows redirects. Reject every redirect response before a
        // caller can reinterpret Location or read a body from a different configured origin.
        if (
          !incoming.statusCode ||
          incoming.statusCode < 200 ||
          incoming.statusCode > 599 ||
          (incoming.statusCode >= 300 && incoming.statusCode < 400)
        ) {
          const redirected =
            typeof incoming.statusCode === "number" &&
            incoming.statusCode >= 300 &&
            incoming.statusCode < 400;
          const error = new StorageOperationError(
            redirected
              ? "Storage transfer was redirected"
              : "Storage transfer returned an invalid response",
          );
          destroyTransfer(error);
          return;
        }

        headersSettled = true;
        incoming.once("close", dispose);
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue;
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }

        const sourceReader = (
          Readable.toWeb(incoming) as ReadableStream<Uint8Array>
        ).getReader();
        let bodyFinished = false;
        const finishBody = () => {
          if (bodyFinished) return;
          bodyFinished = true;
          dispose();
        };
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await sourceReader.read();
              if (done) {
                controller.close();
                finishBody();
                return;
              }
              controller.enqueue(value);
            } catch (error) {
              controller.error(error);
              finishBody();
            }
          },
          async cancel(reason) {
            try {
              await sourceReader.cancel(reason);
            } finally {
              const error =
                reason instanceof Error
                  ? reason
                  : new Error("Storage response body was cancelled");
              destroyTransfer(error);
              finishBody();
            }
          },
        });
        resolve(
          new Response(body, {
            status: incoming.statusCode,
            headers,
          }),
        );
      },
    );
    request.once("error", (error) => destroyTransfer(error));
    timeout = setTimeout(() => {
      const error = new OutboundRequestTimeoutError();
      destroyTransfer(error);
    }, timeoutMs);
    init.signal?.addEventListener("abort", onAbort, { once: true });
    if (init.body) request.write(init.body);
    request.end();
  });
}

async function storageFetch(
  input: string | URL,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer;
    signal?: AbortSignal;
  },
  allowedOrigins: Set<string>,
): Promise<Response> {
  const deadlineAt = Date.now() + STORAGE_REQUEST_TIMEOUT_MS;
  const remainingDeadlineMs = () => {
    const remaining = deadlineAt - Date.now();
    if (remaining < 1) throw new StorageOperationTimeoutError();
    return remaining;
  };
  try {
    if (init.signal?.aborted) throw requestAborted(init.signal);
    const target = await resolveConfiguredStorageTarget(
      input,
      allowedOrigins,
      undefined,
      { signal: init.signal, timeoutMs: remainingDeadlineMs() },
    );
    if (init.signal?.aborted) throw requestAborted(init.signal);
    return await requestPinnedStorage(target, init, remainingDeadlineMs());
  } catch (error) {
    if (init.signal?.aborted) throw requestAborted(init.signal);
    if (error instanceof StorageOperationError) throw error;
    if (error instanceof OutboundRequestTimeoutError)
      throw new StorageOperationTimeoutError();
    throw new StorageOperationError();
  }
}

async function discardErrorResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function parsePresignedUrl(
  response: Response,
  objectOrigins: Set<string>,
): Promise<string> {
  try {
    const responseBody = await readBoundedResponseBody(
      response.body,
      MAX_PRESIGN_RESPONSE_BYTES,
    );
    const body = JSON.parse(responseBody.toString("utf8")) as { url?: unknown };
    if (typeof body.url !== "string") throw new Error("missing url");
    const target = await resolveConfiguredStorageTarget(
      body.url,
      objectOrigins,
    );
    return target.url.toString();
  } catch (error) {
    if (error instanceof StorageOperationError) throw error;
    throw new StorageOperationError(
      "Storage service returned an invalid response",
    );
  }
}

/** Fetches a configured signed object with DNS pinning and redirect refusal for media consumers. */
export async function storageFetchSignedObject(
  signedUrl: string,
  options: StorageRequestOptions = {},
): Promise<Response> {
  const objectOrigins = configuredStorageObjectOrigins();
  if (!objectOrigins)
    throw new StorageOperationError("Storage service is unavailable");
  return storageFetch(
    signedUrl,
    {
      method: "GET",
      headers: { "Accept-Encoding": "identity" },
      signal: options.signal,
    },
    objectOrigins,
  );
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
  options: { stableKey?: boolean } & StorageRequestOptions = {},
): Promise<{ key: string; url: string }> {
  const { forgeUrl, forgeKey, objectOrigins } = getForgeConfig();
  const normalizedKey = normalizeKey(relKey);
  const key = options.stableKey
    ? normalizedKey
    : appendHashSuffix(normalizedKey);

  const presignUrl = new URL("v1/storage/presign/put", `${forgeUrl}/`);
  presignUrl.searchParams.set("path", key);

  const presignResp = await storageFetch(
    presignUrl,
    {
      headers: {
        Authorization: `Bearer ${forgeKey}`,
        "Accept-Encoding": "identity",
      },
      signal: options.signal,
    },
    new Set([forgeUrl]),
  );
  if (!presignResp.ok) {
    await discardErrorResponse(presignResp);
    throw new StorageOperationError("Storage upload could not be prepared");
  }
  const s3Url = await parsePresignedUrl(presignResp, objectOrigins);
  const body =
    typeof data === "string"
      ? Buffer.from(data)
      : Buffer.from(data as Uint8Array);

  const uploadResp = await storageFetch(
    s3Url,
    {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.length),
        "Accept-Encoding": "identity",
      },
      body,
      signal: options.signal,
    },
    objectOrigins,
  );
  if (!uploadResp.ok) {
    await discardErrorResponse(uploadResp);
    throw new StorageOperationError("Storage upload failed");
  }
  await uploadResp.body?.cancel().catch(() => undefined);

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(
  relKey: string,
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(
  relKey: string,
  options: StorageRequestOptions = {},
): Promise<string> {
  const { forgeUrl, forgeKey, objectOrigins } = getForgeConfig();
  const key = normalizeKey(relKey);
  const getUrl = new URL("v1/storage/presign/get", `${forgeUrl}/`);
  getUrl.searchParams.set("path", key);

  const response = await storageFetch(
    getUrl,
    {
      headers: {
        Authorization: `Bearer ${forgeKey}`,
        "Accept-Encoding": "identity",
      },
      signal: options.signal,
    },
    new Set([forgeUrl]),
  );
  if (!response.ok) {
    await discardErrorResponse(response);
    throw new StorageOperationError("Storage download could not be prepared");
  }
  return parsePresignedUrl(response, objectOrigins);
}
