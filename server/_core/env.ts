const MAX_OAUTH_PROVIDER_ORIGIN_LENGTH = 2_048;

/**
 * Normalizes only a credential-free, HTTPS, path-free OAuth provider origin.
 * A trailing slash represents the same origin and is normalized away; every
 * other path/query/fragment/credential variant is rejected rather than passed
 * through to an HTTP client.
 */
export function canonicalOAuthProviderOrigin(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_OAUTH_PROVIDER_ORIGIN_LENGTH ||
    value.trim() !== value
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Server OAuth accepts the platform-owned MANUS variable. The historical
 * OAUTH_SERVER_URL alias remains available for non-production compatibility,
 * but production must explicitly use the reviewed platform variable.
 */
export function configuredOAuthProviderOrigin(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const canonical = environment.MANUS_OAUTH_API_URL;
  const legacy = environment.OAUTH_SERVER_URL;

  if (canonical) {
    const origin = canonicalOAuthProviderOrigin(canonical);
    if (!origin) return null;
    // A supplied alias cannot silently select a different back-channel host.
    if (legacy && canonicalOAuthProviderOrigin(legacy) !== origin) return null;
    return origin;
  }

  if (environment.NODE_ENV === "production" || !legacy) return null;
  return canonicalOAuthProviderOrigin(legacy);
}

/**
 * Startup callers may use this helper to turn an invalid/missing provider
 * configuration into a generic fail-closed startup error without logging it.
 */
export function assertCanonicalOAuthProviderConfiguration(): string {
  if (!ENV.oAuthServerUrl) {
    throw new Error("OAuth provider configuration is unavailable");
  }
  return ENV.oAuthServerUrl;
}

export const ENV = {
  appId: process.env.MANUS_PROJECT_ID ?? process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.MANUS_JWT_SECRET ?? process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: configuredOAuthProviderOrigin(),
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
