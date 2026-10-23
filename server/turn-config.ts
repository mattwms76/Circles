import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/** coturn REST credentials remain useful for a short, bounded allocation window. */
export const TURN_CREDENTIAL_TTL_SECONDS = 10 * 60;
const MIN_TURN_CREDENTIAL_TTL_SECONDS = 60;
const MAX_TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;
const MAX_TURN_URLS = 4;
const MAX_TURN_URL_LENGTH = 256;
const MIN_SHARED_SECRET_BYTES = 32;

type TurnEnvironment = Readonly<{
  NODE_ENV?: string;
  TURN_SERVER_URLS?: string;
  TURN_SHARED_SECRET?: string;
}>;

export type TurnConfiguration = Readonly<{
  urls: readonly string[];
  sharedSecret: string;
}>;

export type TurnIceConfiguration = Readonly<{
  iceServers: readonly [
    Readonly<{
      urls: readonly string[];
      username: string;
      credential: string;
      credentialType: "password";
    }>,
  ];
  expiresAt: string;
}>;

/** Deliberately excludes the shared secret from every client-facing return type. */
export class TurnConfigurationError extends Error {
  constructor(message: string) {
    super(`TURN relay configuration error: ${message}`);
    this.name = "TurnConfigurationError";
  }
}

function isSafeTurnHost(host: string): boolean {
  if (host.startsWith("[") && host.endsWith("]")) {
    return isIP(host.slice(1, -1)) === 6;
  }
  if (isIP(host) === 4) return true;
  if (host.length === 0 || host.length > 253) return false;

  return host.split(".").every((label) => {
    return (
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
    );
  });
}

function validateTurnUrl(url: string): string {
  if (
    url.length === 0 ||
    url.length > MAX_TURN_URL_LENGTH ||
    /[\u0000-\u001F\u007F\s]/.test(url)
  ) {
    throw new TurnConfigurationError(
      "each TURN_SERVER_URLS entry must be a non-empty URL without whitespace or control characters.",
    );
  }

  const match = /^(turn|turns):([^/?#@]+)(?:\?transport=(udp|tcp))?$/.exec(url);
  if (!match) {
    throw new TurnConfigurationError(
      "TURN_SERVER_URLS entries must use turn: or turns:, an explicit host:port, and an optional ?transport=udp or ?transport=tcp query. Credentials, paths, fragments, and other queries are not allowed.",
    );
  }

  const authority = match[2];
  let host: string;
  let portText: string;
  if (authority.startsWith("[")) {
    const closeBracket = authority.indexOf("]");
    if (
      closeBracket === -1 ||
      authority.slice(closeBracket + 1, closeBracket + 2) !== ":"
    ) {
      throw new TurnConfigurationError(
        "TURN_SERVER_URLS IPv6 hosts must be bracketed and include an explicit port.",
      );
    }
    host = authority.slice(0, closeBracket + 1);
    portText = authority.slice(closeBracket + 2);
  } else {
    const portSeparator = authority.lastIndexOf(":");
    if (portSeparator <= 0 || authority.indexOf(":") !== portSeparator) {
      throw new TurnConfigurationError(
        "TURN_SERVER_URLS entries must include a DNS name or IP host and an explicit port.",
      );
    }
    host = authority.slice(0, portSeparator);
    portText = authority.slice(portSeparator + 1);
  }

  const port = Number(portText);
  if (
    !isSafeTurnHost(host) ||
    !/^\d{1,5}$/.test(portText) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new TurnConfigurationError(
      "TURN_SERVER_URLS entries must contain a valid host and port between 1 and 65535.",
    );
  }

  return url;
}

function parseTurnUrls(value: string): readonly string[] {
  if (value !== value.trim()) {
    throw new TurnConfigurationError(
      "TURN_SERVER_URLS must not start or end with whitespace.",
    );
  }
  const urls = value.split(",");
  if (urls.length === 0 || urls.length > MAX_TURN_URLS) {
    throw new TurnConfigurationError(
      `TURN_SERVER_URLS must contain between 1 and ${MAX_TURN_URLS} comma-separated URLs.`,
    );
  }

  const validated = urls.map(validateTurnUrl);
  if (new Set(validated).size !== validated.length) {
    throw new TurnConfigurationError(
      "TURN_SERVER_URLS must not repeat the same relay URL.",
    );
  }
  return Object.freeze(validated);
}

function validateSharedSecret(value: string): string {
  if (value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new TurnConfigurationError(
      "TURN_SHARED_SECRET must not contain leading/trailing whitespace or control characters.",
    );
  }
  if (Buffer.byteLength(value, "utf8") < MIN_SHARED_SECRET_BYTES) {
    throw new TurnConfigurationError(
      `TURN_SHARED_SECRET must be at least ${MIN_SHARED_SECRET_BYTES} bytes of provider-generated entropy.`,
    );
  }
  return value;
}

/**
 * Validates the server-only coturn configuration. Callers deliberately load
 * this only when serving a live operation: an absent relay must disable live
 * production operations, not prevent unrelated API routes from booting.
 */
export function loadTurnConfiguration(
  env: TurnEnvironment = process.env as TurnEnvironment,
): TurnConfiguration | null {
  const urls = env.TURN_SERVER_URLS;
  const sharedSecret = env.TURN_SHARED_SECRET;
  const production = env.NODE_ENV === "production";

  if (
    (urls === undefined || urls === "") &&
    (sharedSecret === undefined || sharedSecret === "")
  ) {
    if (production) {
      throw new TurnConfigurationError(
        "production live streaming requires TURN_SERVER_URLS and TURN_SHARED_SECRET. Configure a coturn REST relay before starting live operations.",
      );
    }
    return null;
  }

  if (!urls || !sharedSecret) {
    throw new TurnConfigurationError(
      "TURN_SERVER_URLS and TURN_SHARED_SECRET must be configured together; remove both only for non-production direct/STUN development.",
    );
  }

  return Object.freeze({
    urls: parseTurnUrls(urls),
    sharedSecret: validateSharedSecret(sharedSecret),
  });
}

function credentialTtlSeconds(): number {
  return Math.min(
    MAX_TURN_CREDENTIAL_TTL_SECONDS,
    Math.max(MIN_TURN_CREDENTIAL_TTL_SECONDS, TURN_CREDENTIAL_TTL_SECONDS),
  );
}

/**
 * Issues coturn REST credentials where `username` is `<unix-expiry>:user-<id>`
 * and `credential` is base64(HMAC-SHA1(sharedSecret, username)). This is the
 * shared-secret convention expected by coturn's use-auth-secret mode.
 */
export function createTurnIceConfiguration(
  userId: number,
  config: TurnConfiguration | null = loadTurnConfiguration(),
  now = Date.now(),
): TurnIceConfiguration | null {
  if (!config) return null;
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TurnConfigurationError(
      "a positive authenticated user id is required to issue relay credentials.",
    );
  }
  if (!Number.isFinite(now)) {
    throw new TurnConfigurationError(
      "a valid issue time is required to issue relay credentials.",
    );
  }

  const expiresAtSeconds = Math.floor(now / 1000) + credentialTtlSeconds();
  const username = `${expiresAtSeconds}:user-${userId}`;
  const credential = createHmac("sha1", config.sharedSecret)
    .update(username)
    .digest("base64");

  return Object.freeze({
    iceServers: Object.freeze([
      Object.freeze({
        urls: config.urls,
        username,
        credential,
        credentialType: "password" as const,
      }),
    ]) as TurnIceConfiguration["iceServers"],
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  });
}
