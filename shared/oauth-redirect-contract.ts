/**
 * Deployment-owned native OAuth receiver. This value is shared by the API and
 * the native client so redirect validation never depends on caller input.
 */
export const CIRCLES_NATIVE_BUNDLE_ID =
  "space.manus.circles.t252278368451773" as const;
export const CIRCLES_NATIVE_OAUTH_SCHEME = "manus252278368451773" as const;
export const CIRCLES_NATIVE_OAUTH_CALLBACK_PATH = "/oauth/callback" as const;

/**
 * Expo Linking.createURL("/oauth/callback", { scheme }) serializes this
 * custom-scheme callback with an empty authority (three slashes).
 */
export const CIRCLES_NATIVE_OAUTH_REDIRECT_URI =
  "manus252278368451773:///oauth/callback" as const;

/**
 * OAuth native redirects must be byte-for-byte equal to the app-owned
 * AuthSession callback. URL normalization would incorrectly accept aliases.
 */
export function isCirclesNativeOAuthRedirectUri(value: string): boolean {
  return value === CIRCLES_NATIVE_OAUTH_REDIRECT_URI;
}
