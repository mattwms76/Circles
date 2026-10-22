/**
 * Managed social uploads are stored under this route after the server encrypts and records them.
 * This deliberately accepts the exact storage key shape produced by socialRouter.upload, rather
 * than treating an arbitrary pathname as a managed resource.
 */
export const MANAGED_MEDIA_URL_PREFIX = "/manus-storage/";

const SOCIAL_ENCRYPTED_UPLOAD_KEY =
  /^social-encrypted\/[1-9]\d*\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|mp4)\.enc$/;

// The public starter seed deliberately uses these fixed Manus CDN image URLs. They remain an
// explicit exception; user-provided absolute URLs are never accepted as managed attachments.
export const TRUSTED_STARTER_MEDIA_URLS: ReadonlySet<string> = new Set([
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/ZgGJzfWyY9fwJoZLPkvxrP.jpg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/zbRoFfVCeGtCAfdL7AfjC.jpg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/VNHqQTYTLh8nDJ2u4aeb8i.jpeg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/NUTTRxAHJdmYnRhkq42pfE.jpeg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/8FZ5aYhFA4zqa3ZhJHqiJj.jpg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/gFnPS8tbb4u6WyHZo9Ax5c.jpg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/PdFjW97bZiC7Up8biFK6Fo.jpg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/bRVqsyasnfvtCASQLyRKfG.jpeg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/hetf6jCCnRySviFFgCKUTf.jpg",
]);

/**
 * Returns a storage key only for an unescaped, server-shaped relative social upload URL.
 * Absolute URLs, protocol-relative forms, query/hash suffixes, encoded traversal, and lookalike
 * pathnames all fail this exact key check.
 */
export function managedSocialMediaKeyFromUrl(value: string): string | null {
  if (!value.startsWith(MANAGED_MEDIA_URL_PREFIX)) return null;
  const key = value.slice(MANAGED_MEDIA_URL_PREFIX.length);
  return SOCIAL_ENCRYPTED_UPLOAD_KEY.test(key) ? key : null;
}

export function managedSocialMediaUrlForKey(key: string): string | null {
  return SOCIAL_ENCRYPTED_UPLOAD_KEY.test(key)
    ? `${MANAGED_MEDIA_URL_PREFIX}${key}`
    : null;
}

export function isCanonicalManagedSocialMediaUrl(value: string): boolean {
  return managedSocialMediaKeyFromUrl(value) !== null;
}

function decodedPathname(value: string): string | null {
  try {
    const url = value.startsWith("/")
      ? new URL(value, "https://circles.invalid")
      : new URL(value);
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

/** Identifies absolute, protocol-relative, encoded, or malformed paths imitating managed media. */
export function isManagedMediaPathLookalike(value: string): boolean {
  const pathname = decodedPathname(value);
  return pathname !== null && pathname.startsWith(MANAGED_MEDIA_URL_PREFIX);
}

export function isTrustedStarterMediaUrl(value: string): boolean {
  return TRUSTED_STARTER_MEDIA_URLS.has(value);
}

/** Only a recorded managed relative URL or an explicit starter image may be persisted as media. */
export function isAllowedMediaAttachmentReference(value: string): boolean {
  return (
    isCanonicalManagedSocialMediaUrl(value) || isTrustedStarterMediaUrl(value)
  );
}

/** Encrypted media gets the authenticated application route, never an arbitrary origin. */
export function isEncryptedManagedSocialMediaUrl(value: string): boolean {
  return managedSocialMediaKeyFromUrl(value) !== null;
}

export function resolveMediaUrlForRenderer(
  uri: string,
  options: {
    isWeb: boolean;
    apiBaseUrl: string;
    apiRequestUrl: (path: string) => string;
  },
): string {
  const key = managedSocialMediaKeyFromUrl(uri);
  if (!key) {
    // Do not allow a historic or malformed attachment to turn an attacker-controlled origin into
    // an image request merely because its pathname resembles managed storage. Other feature-owned
    // remote media (for example, a live thumbnail) remains untouched.
    return isManagedMediaPathLookalike(uri) ? "" : uri;
  }
  if (isEncryptedManagedSocialMediaUrl(uri)) {
    return options.apiRequestUrl(`/api/media/${key}`);
  }
  return options.isWeb ? uri : `${options.apiBaseUrl}${uri}`;
}

/** Native authorization is limited to a canonical application-managed encrypted media route. */
export function requiresNativeMediaAuthorization(
  uri: string,
  isWeb: boolean,
): boolean {
  return !isWeb && isEncryptedManagedSocialMediaUrl(uri);
}
