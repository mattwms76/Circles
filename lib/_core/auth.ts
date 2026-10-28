import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { SESSION_TOKEN_KEY, USER_INFO_KEY } from "@/constants/oauth";
import type { LocalCredentialCleanupOutcome } from "@/lib/client-session";
import {
  credentialAdmission,
  type CredentialAdmissionLogoutAttempt,
  type CredentialAdmissionSnapshot,
  type CredentialAdmissionStorage,
} from "../sec27-credential-admission";

export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: Date;
};

let credentialAdmissionInitialization: Promise<void> | null = null;

function credentialAdmissionStorage(): CredentialAdmissionStorage {
  if (Platform.OS === "web") {
    return {
      async getItem(key) {
        return window.localStorage.getItem(key);
      },
      async setItem(key, value) {
        window.localStorage.setItem(key, value);
      },
      async removeItem(key) {
        window.localStorage.removeItem(key);
      },
    };
  }

  return {
    getItem: SecureStore.getItemAsync,
    setItem: SecureStore.setItemAsync,
    removeItem: SecureStore.deleteItemAsync,
  };
}

/**
 * Begins the marker read before normal credential access. Callers do not need
 * to await this: the controller denies credentials until it has completed.
 */
export function initializeCredentialAdmission(): Promise<void> {
  if (!credentialAdmissionInitialization) {
    credentialAdmissionInitialization = credentialAdmission.configureStorage(
      credentialAdmissionStorage(),
    );
  }
  return credentialAdmissionInitialization;
}

export function getCredentialAdmissionSnapshot(): CredentialAdmissionSnapshot {
  return credentialAdmission.getSnapshot();
}

export function subscribeCredentialAdmission(listener: () => void): () => void {
  return credentialAdmission.subscribe(listener);
}

/**
 * This is deliberately synchronous. It closes memory admission before logout
 * marks React pending state or waits for email/OAuth transition draining.
 */
export function beginIncompleteLogoutCredentialAdmission(): CredentialAdmissionLogoutAttempt {
  void initializeCredentialAdmission();
  return credentialAdmission.beginIncompleteLogout();
}

export async function clearCredentialAdmissionAfterConfirmedLogout(
  attempt: CredentialAdmissionLogoutAttempt,
): Promise<boolean> {
  await initializeCredentialAdmission();
  return credentialAdmission.clearAfterConfirmedLogout(attempt);
}

async function readNativeSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

export async function getSessionToken(): Promise<string | null> {
  await initializeCredentialAdmission();
  const admission = credentialAdmission.getSnapshot();
  if (!credentialAdmission.isGenerationAdmitted(admission.generation)) {
    return null;
  }

  try {
    // Web platform uses cookie-based auth. The tRPC dispatch fence decides
    // whether the browser may attach that cookie after this hydration check.
    if (Platform.OS === "web") return null;

    const token = await readNativeSessionToken();
    // SecureStore can resolve after logout starts. Do not return that stale
    // bearer to a header or protected-media request.
    return credentialAdmission.isGenerationAdmitted(admission.generation)
      ? token
      : null;
  } catch {
    console.error("[Auth] Failed to get session token");
    return null;
  }
}

/**
 * Recovery-only credential reader. It is not a normal-auth bypass: it only
 * works while the global incomplete-logout barrier is closed, captures after
 * the caller's email/OAuth drain, and never persists the raw bearer itself.
 */
export async function getSessionTokenForIncompleteLogoutRecovery(): Promise<
  string | null
> {
  await initializeCredentialAdmission();
  const captured =
    credentialAdmission.getCapturedCredentialForIncompleteLogoutRecovery();
  if (captured !== undefined) return captured;
  if (credentialAdmission.getSnapshot().admitted) return null;
  if (Platform.OS === "web") {
    return credentialAdmission.captureCredentialForIncompleteLogoutRecovery(
      null,
    );
  }

  try {
    const token = await readNativeSessionToken();
    return credentialAdmission.captureCredentialForIncompleteLogoutRecovery(
      token,
    );
  } catch {
    console.error("[Auth] Failed to capture a recovery-only session token");
    return null;
  }
}

export async function setSessionToken(token: string): Promise<void> {
  await initializeCredentialAdmission();
  const admission = credentialAdmission.getSnapshot();
  if (!credentialAdmission.isGenerationAdmitted(admission.generation)) {
    throw new Error(
      "Secure sign-out recovery must finish before a new session can be stored.",
    );
  }

  try {
    // Web platform uses cookie-based auth, no manual token management needed
    if (Platform.OS === "web") {
      console.log(
        "[Auth] Web platform uses cookie-based auth, skipping token storage",
      );
      return;
    }

    // Use SecureStore for native
    console.log("[Auth] Setting session token...");
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
    console.log("[Auth] Session token stored in SecureStore successfully");
  } catch (error) {
    console.error("[Auth] Failed to set session token");
    throw error;
  }
}

export async function removeSessionToken(): Promise<void> {
  try {
    // Web platform uses cookie-based auth, logout is handled by server clearing cookie
    if (Platform.OS === "web") {
      console.log(
        "[Auth] Web platform uses cookie-based auth, skipping token removal",
      );
      return;
    }

    // Use SecureStore for native
    console.log("[Auth] Removing session token...");
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    console.log("[Auth] Session token removed from SecureStore successfully");
  } catch (error) {
    console.error("[Auth] Failed to remove session token");
    throw error;
  }
}

async function removeCachedUserInfo(): Promise<void> {
  if (Platform.OS === "web") {
    window.localStorage.removeItem(USER_INFO_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(USER_INFO_KEY);
}

/**
 * Removes app-controlled client credentials and returns non-secret facts about
 * the attempt. A web HttpOnly session cookie is deliberately reported as
 * server-required: JavaScript cannot verify or remove it locally.
 */
export async function clearLocalSessionCredentials(): Promise<LocalCredentialCleanupOutcome> {
  if (Platform.OS === "web") {
    try {
      await removeCachedUserInfo();
      return {
        platform: "web",
        nativeBearer: "not_applicable",
        cachedUserInfo: "cleared",
        httpOnlySessionCookie: "server_required",
      };
    } catch {
      console.error("[Auth] Failed to clear browser profile data");
      return {
        platform: "web",
        nativeBearer: "not_applicable",
        cachedUserInfo: "failed",
        httpOnlySessionCookie: "server_required",
      };
    }
  }

  const [nativeBearer, cachedUserInfo] = await Promise.allSettled([
    removeSessionToken(),
    removeCachedUserInfo(),
  ]);
  if (cachedUserInfo.status === "rejected") {
    console.error("[Auth] Failed to clear cached user info");
  }

  return {
    platform: "native",
    nativeBearer: nativeBearer.status === "fulfilled" ? "cleared" : "failed",
    cachedUserInfo:
      cachedUserInfo.status === "fulfilled" ? "cleared" : "failed",
    httpOnlySessionCookie: "not_applicable",
  };
}

export async function getUserInfo(): Promise<User | null> {
  try {
    console.log("[Auth] Getting user info...");

    let info: string | null = null;
    if (Platform.OS === "web") {
      // Use localStorage for web
      info = window.localStorage.getItem(USER_INFO_KEY);
    } else {
      // Use SecureStore for native
      info = await SecureStore.getItemAsync(USER_INFO_KEY);
    }

    if (!info) {
      console.log("[Auth] No user info found");
      return null;
    }
    const user = JSON.parse(info);
    console.log("[Auth] User info retrieved");
    return user;
  } catch {
    console.error("[Auth] Failed to get user info");
    return null;
  }
}

export async function setUserInfo(user: User): Promise<void> {
  try {
    console.log("[Auth] Setting user info...");

    if (Platform.OS === "web") {
      // Use localStorage for web
      window.localStorage.setItem(USER_INFO_KEY, JSON.stringify(user));
      console.log("[Auth] User info stored in localStorage successfully");
      return;
    }

    // Use SecureStore for native
    await SecureStore.setItemAsync(USER_INFO_KEY, JSON.stringify(user));
    console.log("[Auth] User info stored in SecureStore successfully");
  } catch {
    console.error("[Auth] Failed to set user info");
  }
}

export async function clearUserInfo(): Promise<void> {
  try {
    await removeCachedUserInfo();
  } catch {
    console.error("[Auth] Failed to clear user info");
  }
}
