import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import { ENV } from "./env";
import { configuredFrontendOrigins } from "./frontend-origins";

export const PREVIEW_LIMITER_HEADER = "x-manus-preview-limiter";
export const PREVIEW_PROXY_HEADER = "x-manus-preview-proxy";
export const TRUSTED_PROXY_CIDRS_ENV = "CIRCLES_TRUSTED_PROXY_CIDRS";
export const PREVIEW_LIMITER_TTL_SECONDS = 24 * 60 * 60;
export const OUTBOUND_FETCH_TIMEOUT_MS = 15_000;
export const MAX_TRUSTED_PROXY_CIDRS = 4;

const LIMITER_TOKEN_PATTERN =
  /^v1\.([A-Za-z0-9_-]{16,64})\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

export class OutboundRequestTimeoutError extends Error {
  constructor() {
    super("Outbound request timed out");
    this.name = "OutboundRequestTimeoutError";
  }
}

/**
 * A Preview limiter token is deliberately not an account credential. Its only purpose is to give
 * an anonymous browser a short-lived, opaque media-work bucket after the local Preview proxy has
 * stripped caller-controlled forwarding headers. The API accepts it only from that loopback proxy.
 */
export function signPreviewLimiterIdentity(
  identity: string,
  expiresAtSeconds: number,
  secret = ENV.cookieSecret,
): string | null {
  if (
    !secret ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(identity) ||
    !Number.isSafeInteger(expiresAtSeconds)
  ) {
    return null;
  }
  const payload = `v1.${identity}.${expiresAtSeconds}`;
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyPreviewLimiterIdentity(
  token: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  secret = ENV.cookieSecret,
): string | null {
  if (!token || !secret) return null;
  const match = LIMITER_TOKEN_PATTERN.exec(token);
  if (!match) return null;

  const [, identity, expiryText, suppliedSignature] = match;
  const expiresAtSeconds = Number(expiryText);
  if (
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds <= nowSeconds ||
    expiresAtSeconds > nowSeconds + PREVIEW_LIMITER_TTL_SECONDS
  ) {
    return null;
  }

  const expected = signPreviewLimiterIdentity(
    identity,
    expiresAtSeconds,
    secret,
  );
  if (!expected) return null;
  const expectedSignature = expected.slice(expected.lastIndexOf(".") + 1);
  const supplied = Buffer.from(suppliedSignature, "base64url");
  const expectedBytes = Buffer.from(expectedSignature, "base64url");
  if (
    supplied.length !== expectedBytes.length ||
    !timingSafeEqual(supplied, expectedBytes)
  )
    return null;
  return identity;
}

function loopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  return (
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

type ParsedIpAddress = {
  address: bigint;
  bits: 32 | 128;
};

type TrustedProxyCidr = ParsedIpAddress & {
  prefix: number;
};

const IPV6_LOOPBACK: ParsedIpAddress = { address: 1n, bits: 128 };
const IPV4_MAPPED_LOOPBACK: ParsedIpAddress = {
  address: (0xffffn << 32n) + 0x7f00_0001n,
  bits: 128,
};

export type TrustedProxyPolicy = {
  /** Exact, normalized CIDRs intended for operator review; no proxy aliases are accepted. */
  cidrs: readonly string[];
  /** Express calls this with the socket peer at hop zero and forwarded peers after it. */
  trustsAddress(address: string | undefined): boolean;
};

function parseIpv4Address(value: string): number | null {
  const octets = value.split(".");
  if (octets.length !== 4) return null;

  let address = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const number = Number(octet);
    if (number > 255) return null;
    address = address * 256 + number;
  }
  return address;
}

function parseIpAddress(value: string): ParsedIpAddress | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, "");
  const family = isIP(normalized);
  if (family === 4) {
    const address = parseIpv4Address(normalized);
    return address === null ? null : { address: BigInt(address), bits: 32 };
  }
  if (family !== 6) return null;
  const address = parseIpv6Address(normalized);
  return address === null ? null : { address, bits: 128 };
}

function cidrMask(bits: 32 | 128, prefix: number): bigint {
  if (prefix === 0) return 0n;
  return ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
}

function addressMatchesCidr(address: ParsedIpAddress, cidr: TrustedProxyCidr) {
  if (address.bits !== cidr.bits) return false;
  const mask = cidrMask(cidr.bits, cidr.prefix);
  return (address.address & mask) === cidr.address;
}

function isLoopbackIpAddress(address: ParsedIpAddress): boolean {
  if (address.bits === 32) return Number(address.address >> 24n) === 127;
  if (address.address === IPV6_LOOPBACK.address) return true;
  return (
    address.address >> 32n === 0xffffn &&
    Number((address.address & 0xffff_ffffn) >> 24n) === 127
  );
}

/**
 * Parses a deliberately small proxy allowlist. The process does not infer a proxy from forwarded
 * headers: an operator must supply one to four canonical, non-loopback CIDRs no broader than /24
 * (IPv4) or /64 (IPv6). A caller cannot opt into broad trust with a hostname, alias, or /0 range.
 */
export function parseTrustedProxyPolicy(
  configuredCidrs: string | undefined,
): TrustedProxyPolicy | null {
  if (!configuredCidrs?.trim()) return null;

  const values = configuredCidrs.split(",").map((value) => value.trim());
  if (
    values.length === 0 ||
    values.length > MAX_TRUSTED_PROXY_CIDRS ||
    values.some((value) => !value)
  ) {
    throw new Error("Trusted proxy policy is invalid");
  }

  const cidrs = values.map((value) => {
    const match = /^([^/]+)\/(\d{1,3})$/.exec(value);
    if (!match) throw new Error("Trusted proxy policy is invalid");
    const parsed = parseIpAddress(match[1]);
    const prefix = Number(match[2]);
    if (!parsed || !Number.isSafeInteger(prefix) || prefix > parsed.bits) {
      throw new Error("Trusted proxy policy is invalid");
    }
    const narrowestAllowedPrefix = parsed.bits === 32 ? 24 : 64;
    const cidr = { ...parsed, prefix };
    const includesIpv6Loopback =
      parsed.bits === 128 &&
      (addressMatchesCidr(IPV6_LOOPBACK, cidr) ||
        addressMatchesCidr(IPV4_MAPPED_LOOPBACK, cidr));
    if (
      prefix < narrowestAllowedPrefix ||
      loopbackAddress(match[1]) ||
      isLoopbackIpAddress(parsed) ||
      includesIpv6Loopback
    ) {
      throw new Error("Trusted proxy policy is invalid");
    }
    const mask = cidrMask(parsed.bits, prefix);
    if ((parsed.address & mask) !== parsed.address) {
      throw new Error("Trusted proxy policy is invalid");
    }
    return cidr;
  });

  if (
    new Set(values.map((value) => value.toLowerCase())).size !== values.length
  ) {
    throw new Error("Trusted proxy policy is invalid");
  }

  return {
    cidrs: Object.freeze([...values]),
    trustsAddress(address) {
      const parsed = address ? parseIpAddress(address) : null;
      return (
        parsed !== null &&
        cidrs.some((cidr) => addressMatchesCidr(parsed, cidr))
      );
    },
  };
}

/**
 * Missing configuration means no generic proxy trust. Invalid configured values are a startup
 * failure rather than a fallback to forwarded headers.
 */
export function configuredTrustedProxyPolicy(): TrustedProxyPolicy | null {
  return parseTrustedProxyPolicy(process.env[TRUSTED_PROXY_CIDRS_ENV]);
}

function singleForwardedAddress(
  header: string | string[] | undefined,
): boolean {
  return (
    typeof header === "string" &&
    !header.includes(",") &&
    parseIpAddress(header) !== null
  );
}

function isPublicIpv4Address(address: number): boolean {
  const a = Math.floor(address / 0x1000000);
  const b = Math.floor(address / 0x10000) % 256;
  const c = Math.floor(address / 0x100) % 256;

  // RFC 1918, loopback, link-local, shared, benchmark, documentation, and all
  // multicast/reserved space are never legitimate managed-storage destinations.
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && b >= 18 && b <= 19) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function parseIpv6Address(value: string): bigint | null {
  let normalized = value;
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 =
      lastColon === -1
        ? null
        : parseIpv4Address(normalized.slice(lastColon + 1));
    if (ipv4 === null) return null;
    normalized = `${normalized.slice(0, lastColon + 1)}${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const doubleColon = normalized.indexOf("::");
  if (doubleColon !== normalized.lastIndexOf("::")) return null;
  const [leftText, rightText] =
    doubleColon === -1
      ? [normalized, ""]
      : [normalized.slice(0, doubleColon), normalized.slice(doubleColon + 2)];
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if (
    left.length + right.length > 8 ||
    (doubleColon === -1 && left.length !== 8)
  )
    return null;
  const parts = [
    ...left,
    ...Array(8 - left.length - right.length).fill("0"),
    ...right,
  ];

  let address = 0n;
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    address = (address << 16n) + BigInt(`0x${part}`);
  }
  return address;
}

function isIpv6Range(address: bigint, prefix: bigint, bits: number): boolean {
  return address >> BigInt(128 - bits) === prefix >> BigInt(128 - bits);
}

function isPublicIpv6Address(address: bigint): boolean {
  const mappedIpv4Prefix = 0xffffn;
  if (address >> 32n === mappedIpv4Prefix) {
    // URL normalization renders mapped addresses as hex (for example, ::ffff:a00:1),
    // so classify the final 32 bits numerically instead of inspecting text prefixes.
    return isPublicIpv4Address(Number(address & 0xffff_ffffn));
  }

  // Only globally routable unicast space is acceptable. This rejects unspecified,
  // loopback, IPv4-compatible, ULA, link-local, multicast, and future/reserved ranges.
  if (!isIpv6Range(address, 0x2000n << 112n, 3)) return false;

  // These prefixes sit inside 2000::/3 but are reserved for documentation,
  // benchmarking, historical overlays, or deprecated transition mechanisms.
  return !(
    isIpv6Range(address, 0x20010db8n << 96n, 32) ||
    isIpv6Range(address, 0x20010002n << 80n, 48) ||
    isIpv6Range(address, 0x20010010n << 96n, 28) ||
    isIpv6Range(address, 0x20010020n << 96n, 28) ||
    isIpv6Range(address, 0x2002n << 112n, 16)
  );
}

function configuredPublicProtocol(protocol: "http" | "https"): boolean {
  for (const origin of configuredFrontendOrigins()) {
    if (new URL(origin).protocol === `${protocol}:`) return true;
  }
  return false;
}

/**
 * This deliberately does not enable Express trust proxy. The marker is stripped and re-created by
 * the owned Preview proxy, must arrive over its loopback hop, and is bound to an explicitly
 * configured public origin protocol. A caller-supplied X-Forwarded-Proto alone has no authority.
 */
export function isTrustedPreviewProxyRequest(
  req: Pick<Request, "headers" | "socket">,
  protocol: "http" | "https",
): boolean {
  const forwardedProto = req.headers["x-forwarded-proto"];
  return (
    loopbackAddress(req.socket?.remoteAddress) &&
    req.headers[PREVIEW_PROXY_HEADER] === "1" &&
    typeof forwardedProto === "string" &&
    forwardedProto === protocol &&
    configuredPublicProtocol(protocol)
  );
}

/**
 * A generic TLS terminator is trusted only when its immediate socket address matches the reviewed
 * CIDR policy and it supplies one, syntactically valid client hop. This is deliberately separate
 * from the owned Preview marker: no loopback CIDR can promote arbitrary forwarded headers.
 */
export function isTrustedExternalProxyRequest(
  req: Pick<Request, "headers" | "socket">,
  protocol: "http" | "https",
  policy = configuredTrustedProxyPolicy(),
): boolean {
  const forwardedProto = req.headers["x-forwarded-proto"];
  return (
    policy !== null &&
    policy.trustsAddress(req.socket?.remoteAddress) &&
    typeof forwardedProto === "string" &&
    forwardedProto === protocol &&
    !forwardedProto.includes(",") &&
    singleForwardedAddress(req.headers["x-forwarded-for"])
  );
}

export function previewLimiterIdentityFromRequest(req: Request): string | null {
  if (
    !isTrustedPreviewProxyRequest(req, "http") &&
    !isTrustedPreviewProxyRequest(req, "https")
  ) {
    return null;
  }
  const header = req.headers[PREVIEW_LIMITER_HEADER];
  return typeof header === "string"
    ? verifyPreviewLimiterIdentity(header)
    : null;
}

export async function fetchWithDeadline(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  timeoutMs = OUTBOUND_FETCH_TIMEOUT_MS,
): Promise<Response> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("Outbound request timeout must be a positive integer");
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const externalSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new OutboundRequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

/** Reads no more than the configured response budget, including streams without Content-Length. */
export async function readBoundedResponseBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Buffer> {
  if (!body || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Invalid bounded response body");
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      received += value.byteLength;
      if (received > maxBytes)
        throw new Error("Response body exceeded configured limit");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, received);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Rejects direct/private IP literals before any outbound managed-storage request is attempted. */
export function isPublicInternetHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (
    !normalized ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost")
  )
    return false;
  const family = isIP(normalized);
  if (family === 0) return true;
  if (family === 4) {
    const address = parseIpv4Address(normalized);
    return address !== null && isPublicIpv4Address(address);
  }
  const address = parseIpv6Address(normalized);
  return address !== null && isPublicIpv6Address(address);
}
