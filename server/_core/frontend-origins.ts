export const FRONTEND_ORIGIN_ENV_NAMES = [
  "EXPO_PACKAGER_PROXY_URL",
  "EXPO_WEB_PREVIEW_URL",
  "FRONTEND_ORIGIN",
  "WEB_ORIGIN",
  "EXPO_PUBLIC_WEB_URL",
  "PUBLIC_URL",
] as const;

type FrontendOriginEnvironmentName = (typeof FRONTEND_ORIGIN_ENV_NAMES)[number];

/**
 * Parses a configured or browser-supplied frontend origin only when it is the
 * canonical HTTP(S) origin string. Paths, credentials, and normalization
 * aliases are deliberately not accepted as trusted origins.
 */
export function parseExactFrontendOrigin(
  value: string | undefined,
): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      url.origin !== value
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Returns the exact configured Expo and custom deployment frontend origins. */
export function configuredFrontendOrigins(
  environment: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const origins = new Set<string>();
  for (const name of FRONTEND_ORIGIN_ENV_NAMES) {
    const origin = parseExactFrontendOrigin(environment[name]);
    if (origin) origins.add(origin);
  }
  return origins;
}

export function configuredFrontendOrigin(
  name: FrontendOriginEnvironmentName,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  return parseExactFrontendOrigin(environment[name]);
}
