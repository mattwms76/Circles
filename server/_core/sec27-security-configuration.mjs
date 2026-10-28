import { isIP } from "node:net";

/** Configuration parsing is not DNS proof; the transport separately validates every DNS answer. */
export function canonicalPublicHttpsOrigin(value) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    value.trim() !== value
  )
    return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      isIP(host) ||
      !host.includes(".") ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseStorageObjectOrigins(configured) {
  if (typeof configured !== "string" || !configured.trim()) return null;
  const values = configured.split(",").map((x) => x.trim());
  if (values.length > 4 || values.some((x) => !x)) return null;
  const origins = values.map(canonicalPublicHttpsOrigin);
  if (origins.some((x) => !x) || new Set(origins).size !== origins.length)
    return null;
  return new Set(origins.filter((origin) => typeof origin === "string"));
}

function addressNumber(value, family) {
  if (family === 4) {
    return value.split(".").reduce((n, octet) => (n << 8n) + BigInt(octet), 0n);
  }
  if (value.includes(".")) return null;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const parts = normalized.split("::");
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts[1] ? parts[1].split(":") : [];
  const expanded =
    parts.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  if (expanded.length !== 8) return null;
  return expanded.reduce((n, group) => (n << 16n) + BigInt(`0x${group}`), 0n);
}

/** Mirrors runtime's narrow, canonical, immediate-hop policy without enabling any trust. */
export function isValidTrustedProxyConfiguration(configured) {
  if (typeof configured !== "string" || !configured.trim()) return true;
  const values = configured.split(",").map((x) => x.trim());
  if (
    !values.length ||
    values.length > 4 ||
    new Set(values.map((x) => x.toLowerCase())).size !== values.length
  )
    return false;
  return values.every((value) => {
    try {
      const match = /^([^/]+)\/(\d{1,3})$/.exec(value);
      if (!match) return false;
      const family = isIP(match[1]);
      if (!family) return false;
      const bits = family === 4 ? 32 : 128;
      const prefix = Number(match[2]);
      if (prefix < (family === 4 ? 24 : 64) || prefix > bits) return false;
      const address = addressNumber(match[1], family);
      if (address === null) return false;
      const hostBits = BigInt(bits - prefix);
      if ((address >> hostBits) << hostBits !== address) return false;
      if (family === 4) return address >> 24n !== 127n;
      const contains = (target) => target >> hostBits === address >> hostBits;
      return !contains(1n) && !contains((0xffffn << 32n) + 0x7f000001n);
    } catch {
      return false;
    }
  });
}
