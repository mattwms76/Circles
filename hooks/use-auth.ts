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

export function useAuth(options?: UseAuthOptions) {
  const { autoFetch = true } = options ?? {};
  const [user, setUser] = useState<Auth.User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Native SecureStore holds only a bearer token. The identity is always
      // resolved by /api/auth/me, which verifies its JWT and app binding.
      if (Platform.OS !== "web" && !(await Auth.getSessionToken())) {
        setUser(null);
        await Auth.clearUserInfo();
        return;
      }

      const apiUser = await Api.getMe();
      if (!apiUser) {
        setUser(null);
        // A cached profile never establishes an authenticated native session.
        await Auth.clearUserInfo();
        return;
      }

      const validatedUser = toAuthUser(apiUser);
      setUser(validatedUser);
      // Cache is display-only and is refreshed only after server validation.
      await Auth.setUserInfo(validatedUser);
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
    if (autoFetch) {
      void fetchUser();
    } else {
      setLoading(false);
    }
  }, [autoFetch, fetchUser]);

  return {
    user,
    loading,
    error,
    isAuthenticated,
    refresh: fetchUser,
    logout,
  };
}
