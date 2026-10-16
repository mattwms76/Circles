import { storage } from "@/src/utils/storage";

export const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;
export const TOKEN_KEY = "auth_token";

export async function getToken(): Promise<string | null> {
  return storage.secureGet(TOKEN_KEY, null);
}

export async function setToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    throw new ApiError((data as any)?.detail ?? "Something went wrong", res.status);
  }
  return data as T;
}

export const apiGet = <T>(path: string) => request<T>(path);
export const apiPost = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
export const apiPut = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined });
export const apiDelete = <T>(path: string) => request<T>(path, { method: "DELETE" });

// Build absolute URL for stored media served by our backend.
export function mediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${API_URL}${url}`;
}
