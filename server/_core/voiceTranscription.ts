/**
 * Voice transcription helper using the internal Speech-to-Text service.
 *
 * This helper accepts only a canonical managed-storage key. It deliberately does not accept an
 * arbitrary audio URL: a future route must keep the existing authentication and media ownership
 * checks before passing a stored object key here.
 */
import { lookup } from "node:dns/promises";
import { Agent, request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { ENV } from "./env";
import {
  fetchWithDeadline,
  isPublicInternetHostname,
  OutboundRequestTimeoutError,
  readBoundedResponseBody,
} from "./runtimeSecurity";
import { storageGetSignedUrl } from "../storage";

const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_TRANSCRIPTION_RESPONSE_BYTES = 1024 * 1024;
const TRANSCRIPTION_FETCH_TIMEOUT_MS = 20_000;
const MANAGED_STORAGE_PATH = "/manus-storage/";
const MANAGED_STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;
const AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/mp3",
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/ogg",
  "audio/m4a",
  "audio/mp4",
]);

export type TranscribeOptions = {
  /** A canonical `/manus-storage/<key>` path or its storage key, never an arbitrary URL. */
  storageKey: string;
  language?: string;
  prompt?: string;
};

export type WhisperSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export type TranscriptionResponse = WhisperResponse;

export type TranscriptionError = {
  error: string;
  code:
    | "FILE_TOO_LARGE"
    | "INVALID_FORMAT"
    | "TRANSCRIPTION_FAILED"
    | "UPLOAD_FAILED"
    | "SERVICE_ERROR";
};

type ManagedStorageDnsAddress = {
  address: string;
  family: number;
};

type ManagedStorageDnsResolver = (
  hostname: string,
) => Promise<ManagedStorageDnsAddress[]>;

export type ValidatedManagedStorageTarget = {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
};

export function canonicalManagedStorageKey(value: string): string | null {
  const key = value.startsWith(MANAGED_STORAGE_PATH)
    ? value.slice(MANAGED_STORAGE_PATH.length)
    : value;
  if (
    !MANAGED_STORAGE_KEY_PATTERN.test(key) ||
    key.includes("//") ||
    key.split("/").some((part) => part === "." || part === "..")
  ) {
    return null;
  }
  return key;
}

/**
 * Resolves a signer URL once and retains the selected IP for the connection. Keeping this small
 * resolver seam explicit permits network-free regression tests without allowing a caller to choose
 * an outbound destination.
 */
export async function resolveManagedStorageTarget(
  value: string,
  resolveAddresses: ManagedStorageDnsResolver = (hostname) =>
    lookup(hostname, { all: true, verbatim: true }),
): Promise<ValidatedManagedStorageTarget | null> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !isPublicInternetHostname(url.hostname)
  ) {
    return null;
  }

  // The URL originates from the managed Forge signer, but resolve it before connecting as an
  // additional defense against a malformed signer response targeting a private literal/hostname.
  // Every candidate must be public; the selected candidate is then pinned by the HTTPS lookup.
  try {
    const addresses = await resolveAddresses(url.hostname);
    if (
      !addresses.length ||
      addresses.some(
        ({ address, family }) =>
          (family !== 4 && family !== 6) ||
          isIP(address) !== family ||
          !isPublicInternetHostname(address),
      )
    ) {
      return null;
    }
    const [selected] = addresses;
    return {
      url,
      hostname: url.hostname,
      address: selected.address,
      family: selected.family as 4 | 6,
    };
  } catch {
    return null;
  }
}

/**
 * Supplies a Node HTTPS agent with the already-validated answer, preventing the connection from
 * invoking DNS again. The URL hostname remains the request hostname and TLS servername, preserving
 * normal HTTPS Host/SNI and certificate validation semantics.
 */
export function createPinnedManagedStorageLookup(
  target: ValidatedManagedStorageTarget,
): LookupFunction {
  return (hostname, _options, callback) => {
    if (hostname !== target.hostname) {
      const error = Object.assign(
        new Error("Pinned managed-storage hostname mismatch"),
        { code: "EAI_AGAIN" },
      );
      callback(error, "", target.family);
      return;
    }
    callback(null, target.address, target.family);
  };
}

function requestPinnedManagedStorage(
  target: ValidatedManagedStorageTarget,
  timeoutMs: number,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const agent = new Agent({
      keepAlive: false,
      maxSockets: 1,
      lookup: createPinnedManagedStorageLookup(target),
    });
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      agent.destroy();
      reject(error);
    };

    const request = httpsRequest(
      target.url,
      {
        agent,
        method: "GET",
        headers: { "Accept-Encoding": "identity" },
        // Connect to target.address via the custom lookup, but verify TLS for the original signer host.
        family: target.family,
        servername: target.hostname,
        rejectUnauthorized: true,
      },
      (response) => {
        if (settled) {
          response.destroy();
          return;
        }
        settled = true;
        if (timeout) clearTimeout(timeout);
        response.once("close", () => agent.destroy());
        resolve(response);
      },
    );
    request.once("error", (error) => fail(error));
    timeout = setTimeout(() => {
      const error = new OutboundRequestTimeoutError();
      request.destroy(error);
      fail(error);
    }, timeoutMs);
    request.end();
  });
}

function firstResponseHeader(
  response: IncomingMessage,
  name: string,
): string | undefined {
  const value = response.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readPinnedManagedStorageBody(
  response: IncomingMessage,
  timeoutMs: number,
): Promise<Buffer> {
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    response.destroy(new OutboundRequestTimeoutError());
  }, timeoutMs);
  try {
    return await readBoundedResponseBody(
      Readable.toWeb(response) as ReadableStream<Uint8Array>,
      MAX_AUDIO_BYTES,
    );
  } catch (error) {
    if (timedOut) throw new OutboundRequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadManagedAudio(
  storageKey: string,
): Promise<{ audioBuffer: Buffer; mimeType: string } | TranscriptionError> {
  let signedUrl: string;
  try {
    signedUrl = await storageGetSignedUrl(storageKey);
  } catch {
    return {
      error: "Audio storage is temporarily unavailable",
      code: "SERVICE_ERROR",
    };
  }

  const target = await resolveManagedStorageTarget(signedUrl);
  if (!target)
    return {
      error: "Audio storage location is invalid",
      code: "INVALID_FORMAT",
    };

  try {
    const deadlineAt = Date.now() + TRANSCRIPTION_FETCH_TIMEOUT_MS;
    const remainingTimeout = () => Math.max(1, deadlineAt - Date.now());
    const response = await requestPinnedManagedStorage(
      target,
      remainingTimeout(),
    );
    if (
      !response.statusCode ||
      response.statusCode < 200 ||
      response.statusCode >= 300
    ) {
      response.destroy();
      return {
        error: "Audio file could not be downloaded",
        code: "INVALID_FORMAT",
      };
    }

    const contentLength = firstResponseHeader(response, "content-length");
    if (
      contentLength !== undefined &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_AUDIO_BYTES)
    ) {
      response.destroy();
      return {
        error: "Audio file exceeds maximum size limit",
        code: "FILE_TOO_LARGE",
      };
    }

    const mimeType =
      firstResponseHeader(response, "content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase() || "";
    if (!AUDIO_MIME_TYPES.has(mimeType)) {
      response.destroy();
      return {
        error: "Audio file format is not supported",
        code: "INVALID_FORMAT",
      };
    }
    const audioBuffer = await readPinnedManagedStorageBody(
      response,
      remainingTimeout(),
    );
    if (!audioBuffer.length)
      return { error: "Audio file is empty", code: "INVALID_FORMAT" };
    return { audioBuffer, mimeType };
  } catch (error) {
    if (error instanceof OutboundRequestTimeoutError) {
      return { error: "Audio download timed out", code: "SERVICE_ERROR" };
    }
    // This includes redirect failures and a body exceeding the streaming cap; neither destination
    // details nor transport errors are returned to a future caller.
    return {
      error: "Audio file could not be downloaded",
      code: "INVALID_FORMAT",
    };
  }
}

/** Transcribes a managed audio object without ever fetching a caller-selected network location. */
export async function transcribeAudio(
  options: TranscribeOptions,
): Promise<TranscriptionResponse | TranscriptionError> {
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    return {
      error: "Voice transcription service is not configured",
      code: "SERVICE_ERROR",
    };
  }

  const storageKey = canonicalManagedStorageKey(options.storageKey);
  if (!storageKey)
    return {
      error: "Audio storage reference is invalid",
      code: "INVALID_FORMAT",
    };

  const downloaded = await downloadManagedAudio(storageKey);
  if ("error" in downloaded) return downloaded;

  try {
    const formData = new FormData();
    const filename = `audio.${getFileExtension(downloaded.mimeType)}`;
    const audioBlob = new Blob([new Uint8Array(downloaded.audioBuffer)], {
      type: downloaded.mimeType,
    });
    formData.append("file", audioBlob, filename);
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");

    const prompt =
      options.prompt?.trim().slice(0, 1_000) ||
      (options.language
        ? `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}`
        : "Transcribe the user's voice to text");
    formData.append("prompt", prompt);

    const baseUrl = ENV.forgeApiUrl.endsWith("/")
      ? ENV.forgeApiUrl
      : `${ENV.forgeApiUrl}/`;
    const response = await fetchWithDeadline(
      new URL("v1/audio/transcriptions", baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ENV.forgeApiKey}`,
          "Accept-Encoding": "identity",
        },
        body: formData,
        redirect: "error",
      },
      TRANSCRIPTION_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
      };
    }

    const responseBody = await readBoundedResponseBody(
      response.body,
      MAX_TRANSCRIPTION_RESPONSE_BYTES,
    );
    let whisperResponse: WhisperResponse;
    try {
      whisperResponse = JSON.parse(
        responseBody.toString("utf8"),
      ) as WhisperResponse;
    } catch {
      return { error: "Invalid transcription response", code: "SERVICE_ERROR" };
    }
    if (!whisperResponse.text || typeof whisperResponse.text !== "string") {
      return { error: "Invalid transcription response", code: "SERVICE_ERROR" };
    }
    return whisperResponse;
  } catch (error) {
    if (error instanceof OutboundRequestTimeoutError) {
      return {
        error: "Transcription service timed out",
        code: "SERVICE_ERROR",
      };
    }
    return { error: "Voice transcription failed", code: "SERVICE_ERROR" };
  }
}

function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
  };
  return mimeToExt[mimeType] || "audio";
}

function getLanguageName(langCode: string): string {
  const langMap: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ar: "Arabic",
    hi: "Hindi",
    nl: "Dutch",
    pl: "Polish",
    tr: "Turkish",
    sv: "Swedish",
    da: "Danish",
    no: "Norwegian",
    fi: "Finnish",
  };
  return langMap[langCode] || langCode;
}
