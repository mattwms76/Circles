import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

type UseAuthOptions = {
  autoFetch?: boolean;
};

function toAuthUser(apiUser: {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: string;
}): Auth.User {
  return {
    id: apiUser.id,
    openId: apiUser.openId,
    name: apiUser.name,
    email: apiUser.email,
    loginMethod: apiUser.loginMethod,
    lastSignedIn: new Date(apiUser.lastSignedIn),
  };
}

async function resolveAuthenticatedUser(): Promise<Auth.User | null> {
  // Native SecureStore holds only a bearer token. The identity is always
  // resolved by /api/auth/me, which verifies its JWT and app binding.
  if (Platform.OS !== "web" && !(await Auth.getSessionToken())) {
    await Auth.clearUserInfo();
    return null;
  }

  const apiUser = await Api.getMe();
  if (!apiUser) {
    // A cached profile never establishes an authenticated native session.
    await Auth.clearUserInfo();
    return null;
  }

  return toAuthUser(apiUser);
}

export function useAuth(options?: UseAuthOptions) {
  const { autoFetch = true } = options ?? {};
  const [user, setUser] = useState<Auth.User | null>(null);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<Error | null>(null);
  const [previousAutoFetch, setPreviousAutoFetch] = useState(autoFetch);

  // Derive loading directly from an option transition instead of scheduling a
  // synchronous state change in the effect that starts validation.
  if (previousAutoFetch !== autoFetch) {
    setPreviousAutoFetch(autoFetch);
    setLoading(autoFetch);
    if (autoFetch) setError(null);
  }

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const validatedUser = await resolveAuthenticatedUser();
      setUser(validatedUser);
      // Cache is display-only and is refreshed only after server validation.
      if (validatedUser) await Auth.setUserInfo(validatedUser);
    } catch (err) {
      setUser(null);
      setError(
        err instanceof Error ? err : new Error("Failed to validate session"),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await Api.logout();
    } catch {
      // Local credentials are still removed if an offline logout request fails.
    } finally {
      await Auth.removeSessionToken();
      await Auth.clearUserInfo();
      setUser(null);
      setError(null);
    }
  }, []);

  const isAuthenticated = useMemo(() => Boolean(user), [user]);

  useEffect(() => {
    if (!autoFetch) return;

    let active = true;

    async function validateInitialSession() {
      try {
        const validatedUser = await resolveAuthenticatedUser();

        if (!active) {
          // Keep the display-only cache in sync after server validation even
          // if this hook has unmounted before the response arrives.
          if (validatedUser) await Auth.setUserInfo(validatedUser);
          return;
        }

        setUser(validatedUser);
        // Cache is display-only and is refreshed only after server validation.
        if (validatedUser) await Auth.setUserInfo(validatedUser);
        setError(null);
      } catch (err) {
        if (!active) return;

        setUser(null);
        setError(
          err instanceof Error ? err : new Error("Failed to validate session"),
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void validateInitialSession();

    return () => {
      active = false;
    };
  }, [autoFetch]);

  return {
    user,
    loading,
    error,
    isAuthenticated,
    refresh: fetchUser,
    logout,
  };
}
