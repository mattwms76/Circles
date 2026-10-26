import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as ReactNative from "react-native";
import * as SecureStore from "expo-secure-store";
import { CIRCLES_NATIVE_OAUTH_REDIRECT_URI } from "../shared/oauth-redirect-contract";
import {
  isSameNativeOAuthPendingFlow,
  normalizeOAuthContinuation,
  parseNativeOAuthPendingFlow,
  serializeNativeOAuthPendingFlow,
  type NativeOAuthPendingFlow,
  type OAuthContinuation,
} from "../lib/a26-auth-oauth";

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

export type StartOAuthLoginOptions = {
  /** Only the protected email-connection migration may request this route. */
  continuation?: OAuthContinuation;
};

let nativeOAuthStartGeneration = 0;
let nativeOAuthStorageTail: Promise<void> = Promise.resolve();

function nextNativeOAuthGeneration(): number {
  nativeOAuthStartGeneration = Math.max(
    nativeOAuthStartGeneration + 1,
    Date.now(),
  );
  return nativeOAuthStartGeneration;
}

async function runNativeOAuthStorageTransition<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const prior = nativeOAuthStorageTail;
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  nativeOAuthStorageTail = prior.then(
    () => completion,
    () => completion,
  );

  await prior.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}

function requestedContinuation(
  options: StartOAuthLoginOptions | undefined,
): OAuthContinuation | null {
  const value = options?.continuation;
  const continuation = normalizeOAuthContinuation(value);
  if (value !== undefined && continuation === null) {
    throw new Error("Invalid OAuth continuation");
  }
  return continuation;
}

function isActiveVersionedNativeFlow(
  flow: NativeOAuthPendingFlow | null,
): boolean {
  return (
    !!flow &&
    flow.generation > 0 &&
    flow.expiresAt !== null &&
    flow.expiresAt > Date.now()
  );
}

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
export const getLoginUrl = (options?: StartOAuthLoginOptions) => {
  if (ReactNative.Platform.OS !== "web") {
    throw new Error("Native login must be started with startOAuthLogin");
  }
  const url = new URL(apiUrl("/api/oauth/start"));
  url.searchParams.set("redirectUri", getRedirectUri());
  url.searchParams.set("frontendOrigin", getWebFrontendOrigin());
  const continuation = requestedContinuation(options);
  if (continuation) url.searchParams.set("continuation", continuation);
  return url.toString();
};

async function prepareNativeOAuthLogin(
  continuation: OAuthContinuation | null,
  generation: number,
): Promise<
  (NativeOAuthPreparation & { pendingFlow: NativeOAuthPendingFlow }) | null
> {
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

  // A later initiation wins before this earlier preparation reaches storage.
  if (generation !== nativeOAuthStartGeneration) return null;
  const expiresAt =
    typeof preparation.expiresIn === "number" && preparation.expiresIn > 0
      ? Date.now() + preparation.expiresIn * 1000
      : null;
  const pendingFlow: NativeOAuthPendingFlow = {
    flowToken: preparation.flowToken,
    generation,
    continuation,
    expiresAt,
  };
  await setNativeOAuthPendingFlow(pendingFlow);
  if (!(await isNativeOAuthPendingFlowCurrent(pendingFlow))) return null;
  return {
    authorizationUrl: preparation.authorizationUrl,
    flowToken: preparation.flowToken,
    expiresIn:
      typeof preparation.expiresIn === "number" ? preparation.expiresIn : 0,
    pendingFlow,
  };
}

async function setNativeOAuthPendingFlow(
  pendingFlow: NativeOAuthPendingFlow,
): Promise<void> {
  await runNativeOAuthStorageTransition(async () => {
    await SecureStore.setItemAsync(
      NATIVE_OAUTH_FLOW_KEY,
      serializeNativeOAuthPendingFlow(pendingFlow),
    );
  });
}

/**
 * Returns the full native flow identity for the callback's server-side code
 * exchange. Raw legacy values remain readable only to finish a flow already
 * started by an older client.
 */
export async function getNativeOAuthPendingFlow(): Promise<NativeOAuthPendingFlow | null> {
  if (ReactNative.Platform.OS === "web") return null;
  return runNativeOAuthStorageTransition(async () =>
    parseNativeOAuthPendingFlow(
      await SecureStore.getItemAsync(NATIVE_OAUTH_FLOW_KEY),
    ),
  );
}

/** Returns the token for backwards-compatible callers that do not need flow metadata. */
export async function getNativeOAuthFlowToken(): Promise<string | null> {
  return (await getNativeOAuthPendingFlow())?.flowToken ?? null;
}

export async function isNativeOAuthPendingFlowCurrent(
  expected: NativeOAuthPendingFlow,
): Promise<boolean> {
  return isSameNativeOAuthPendingFlow(
    await getNativeOAuthPendingFlow(),
    expected,
  );
}

/** Deletes only a matching token-generation pair, never a newer native flow. */
export async function clearNativeOAuthPendingFlowIfCurrent(
  expected: NativeOAuthPendingFlow,
): Promise<boolean> {
  if (ReactNative.Platform.OS === "web") return false;
  return runNativeOAuthStorageTransition(async () => {
    const current = parseNativeOAuthPendingFlow(
      await SecureStore.getItemAsync(NATIVE_OAUTH_FLOW_KEY),
    );
    if (!isSameNativeOAuthPendingFlow(current, expected)) return false;
    await SecureStore.deleteItemAsync(NATIVE_OAUTH_FLOW_KEY);
    return true;
  });
}

/** Legacy clear for explicit abandonment paths that do not hold a flow snapshot. */
export async function clearNativeOAuthFlowToken(): Promise<void> {
  if (ReactNative.Platform.OS !== "web") {
    await runNativeOAuthStorageTransition(async () => {
      await SecureStore.deleteItemAsync(NATIVE_OAUTH_FLOW_KEY);
    });
  }
}

/**
 * Start OAuth login flow.
 *
 * Web login enters the server route that creates the signed state binding.
 * Native login prepares a one-time server flow and retains its random initiating
 * token in SecureStore until the Expo deep-link callback arrives.
 */
export async function startOAuthLogin(
  options?: StartOAuthLoginOptions,
): Promise<string | null> {
  const continuation = requestedContinuation(options);
  if (ReactNative.Platform.OS === "web") {
    window.location.assign(
      getLoginUrl({ continuation: continuation ?? undefined }),
    );
    return null;
  }

  const existing = await getNativeOAuthPendingFlow();
  if (isActiveVersionedNativeFlow(existing)) {
    // A continuation is already bound to the exact stored flow. Do not create
    // F2 while F1 can still reach its single-use callback.
    return null;
  }
  if (existing) await clearNativeOAuthPendingFlowIfCurrent(existing);

  const generation = nextNativeOAuthGeneration();
  const preparation = await prepareNativeOAuthLogin(continuation, generation);
  if (!preparation) return null;
  if (generation !== nativeOAuthStartGeneration) return null;
  const supported = await Linking.canOpenURL(preparation.authorizationUrl);
  if (
    generation !== nativeOAuthStartGeneration ||
    !(await isNativeOAuthPendingFlowCurrent(preparation.pendingFlow))
  ) {
    return null;
  }
  if (!supported) {
    await clearNativeOAuthPendingFlowIfCurrent(preparation.pendingFlow);
    throw new Error("Cannot open the secure sign-in page");
  }

  try {
    await Linking.openURL(preparation.authorizationUrl);
  } catch {
    await clearNativeOAuthPendingFlowIfCurrent(preparation.pendingFlow);
    throw new Error("Unable to open the secure sign-in page");
  }

  // The OAuth provider returns to /oauth/callback through Expo Linking.
  return null;
}
