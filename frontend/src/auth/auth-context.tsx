import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { apiGet, apiPost, apiPut, clearToken, setToken } from "@/src/api/client";

export type User = {
  id: string;
  name: string;
  email: string;
  bio: string;
  avatar_url: string | null;
  interests: string[];
  onboarded: boolean;
  coins: number;
  is_moderator: boolean;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  updateUser: (patch: Partial<User>) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const me = await apiGet<User>("/api/auth/me");
        setUser(me);
      } catch {
        await clearToken();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    const res = await apiPost<{ access_token: string; user: User }>("/api/auth/login", {
      email,
      password,
    });
    await setToken(res.access_token);
    setUser(res.user);
  };

  const signUp = async (name: string, email: string, password: string) => {
    const res = await apiPost<{ access_token: string; user: User }>("/api/auth/register", {
      name,
      email,
      password,
    });
    await setToken(res.access_token);
    setUser(res.user);
  };

  const signOut = async () => {
    await clearToken();
    setUser(null);
  };

  const refresh = async () => {
    try {
      const me = await apiGet<User>("/api/auth/me");
      setUser(me);
    } catch {
      /* ignore */
    }
  };

  const updateUser = (patch: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refresh, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { apiPut };
