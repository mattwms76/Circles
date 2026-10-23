import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as ReactNative from "react-native";
import * as SecureStore from "expo-secure-store";
import { CIRCLES_NATIVE_OAUTH_REDIRECT_URI } from "../shared/oauth-redirect-contract";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<
  string,
  string | undefined
>;

const env = {
  portal:
    extra.oauthPortalUrl ?? process.env.EXPO_PUBLIC_OAUTH_PORTAL_URL ?? "",
  server:
    extra.oauthServerUrl ?? process.env.EXPO_PUBLIC_OAUTH_SERVER_URL ?? "",
  appId: extra.appId ?? process.env.EXPO_PUBLIC_APP_ID ?? "",
  ownerId: process.env.EXPO_PUBLIC_OWNER_OPEN_ID ?? "",
  ownerName: process.env.EXPO_PUBLIC_OWNER_NAME ?? "",
  apiBaseUrl: extra.apiBaseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
};

export const OAUTH_PORTAL_URL = env.portal;
export const OAUTH_SERVER_URL = env.server;
export const APP_ID = env.appId;
export const OWNER_OPEN_ID = env.ownerId;
export const OWNER_NAME = env.ownerName;
export const API_BASE_URL = env.apiBaseUrl;

export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "manus-runtime-user-info";
const NATIVE_OAUTH_FLOW_KEY = "manus_oauth_pending_flow";

type NativeOAuthPreparation = {
  authorizationUrl: string;
  flowToken: string;
  expiresIn: number;
};

/**
 * Web uses its own origin through Metro's fixed /api proxy. Native devices
 * retain the injected API endpoint; they cannot use browser-relative URLs.
 */
export function getApiBaseUrl(): string {
  if (
    ReactNative.Platform.OS === "web" &&
    typeof window !== "undefined" &&
    window.location
  ) {
    return window.location.origin;
  }

  return API_BASE_URL.replace(/\/$/, "");
}

/** Browser requests are relative; OAuth redirect construction uses an origin. */
export function getApiRequestUrl(pathname: string): string {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new Error("API paths must be root-relative");
  }
  if (ReactNative.Platform.OS === "web" && typeof window !== "undefined") {
    return pathname;
  }
  return `${getApiBaseUrl()}${pathname}`;
}

function apiUrl(pathname: string): string {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) throw new Error("OAuth API URL is unavailable");
  return new URL(pathname, `${baseUrl}/`).toString();
}

function getWebFrontendOrigin(): string {
  if (typeof window === "undefined" || !window.location?.origin) {
    throw new Error("OAuth login must be started from the application origin");
  }
  return window.location.origin;
}

/**
 * Get the redirect URI for OAuth callback.
 * - Web: the public API callback endpoint
 * - Native: the app's fixed Manus deep link
 */
export const getRedirectUri = () => {
  if (ReactNative.Platform.OS === "web") return apiUrl("/api/oauth/callback");
  return CIRCLES_NATIVE_OAUTH_REDIRECT_URI;
};

/**
 * The web login entrypoint. It does not construct OAuth state in the client;
 * the server sets an HttpOnly state/nonce cookie and redirects to Manus.
 */
export const getLoginUrl = () => {
  if (ReactNative.Platform.OS !== "web") {
    throw new Error("Native login must be started with startOAuthLogin");
  }
  const url = new URL(apiUrl("/api/oauth/start"));
  url.searchParams.set("redirectUri", getRedirectUri());
  url.searchParams.set("frontendOrigin", getWebFrontendOrigin());
  return url.toString();
};

async function prepareNativeOAuthLogin(): Promise<NativeOAuthPreparation> {
  const url = new URL(apiUrl("/api/oauth/mobile/start"));
  url.searchParams.set("redirectUri", getRedirectUri());

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to start secure sign in");

  const preparation =
    (await response.json()) as Partial<NativeOAuthPreparation>;
  if (
    typeof preparation.authorizationUrl !== "string" ||
    typeof preparation.flowToken !== "string" ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(preparation.flowToken)
  ) {
    throw new Error("Invalid OAuth login preparation");
  }

  // The initiating token never appears in the deep-link URL and is kept in platform secure storage.
  await SecureStore.setItemAsync(NATIVE_OAUTH_FLOW_KEY, preparation.flowToken);
  return {
    authorizationUrl: preparation.authorizationUrl,
    flowToken: preparation.flowToken,
    expiresIn:
      typeof preparation.expiresIn === "number" ? preparation.expiresIn : 0,
  };
}

/** Returns the native flow token only for the callback's server-side code exchange. */
export async function getNativeOAuthFlowToken(): Promise<string | null> {
  if (ReactNative.Platform.OS === "web") return null;
  return SecureStore.getItemAsync(NATIVE_OAUTH_FLOW_KEY);
}

export async function clearNativeOAuthFlowToken(): Promise<void> {
  if (ReactNative.Platform.OS !== "web") {
    await SecureStore.deleteItemAsync(NATIVE_OAUTH_FLOW_KEY);
  }
}

/**
 * Start OAuth login flow.
 *
 * Web login enters the server route that creates the signed state binding.
 * Native login prepares a one-time server flow and retains its random initiating
 * token in SecureStore until the Expo deep-link callback arrives.
 */
export async function startOAuthLogin(): Promise<string | null> {
  if (ReactNative.Platform.OS === "web") {
    window.location.assign(getLoginUrl());
    return null;
  }

  const preparation = await prepareNativeOAuthLogin();
  const supported = await Linking.canOpenURL(preparation.authorizationUrl);
  if (!supported) {
    await clearNativeOAuthFlowToken();
    throw new Error("Cannot open the secure sign-in page");
  }

  try {
    await Linking.openURL(preparation.authorizationUrl);
  } catch {
    await clearNativeOAuthFlowToken();
    throw new Error("Unable to open the secure sign-in page");
  }

  // The OAuth provider returns to /oauth/callback through Expo Linking.
  return null;
}
