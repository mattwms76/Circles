import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiRequestUrl } from "@/constants/oauth";
import * as Auth from "./_core/auth";
import { credentialAdmission } from "./sec27-credential-admission";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

// Cooperative client limits are not the server security boundary, but prevent ordinary polling
// screens from accidentally creating an unbounded batched GET. The server enforces its own larger
// request-target bound and the same finite batch count for arbitrary callers.
export const TRPC_CLIENT_MAX_BATCH_ITEMS = 10;
export const TRPC_CLIENT_MAX_URL_LENGTH = 2_048;

/** Exported for focused transport tests; all normal tRPC headers use this path. */
export async function trpcCredentialAdmissionHeaders(): Promise<
  Record<string, string>
> {
  const token = await Auth.getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Applies the final credential fence after asynchronous header resolution. A
 * logout can begin between `getSessionToken()` resolving and fetch dispatch,
 * so this removes a stale bearer and omits browser cookies at that last point.
 */
export function fetchWithCredentialAdmission(
  url: RequestInfo | URL,
  options?: RequestInit,
): Promise<Response> {
  return fetch(url, credentialAdmission.prepareRequest(options));
}

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
export function createTRPCClient() {
  // Starts the persisted-marker check before any query can ask for a bearer or
  // let browser cookies reach its request. Admission remains closed meanwhile.
  void Auth.initializeCredentialAdmission();
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: getApiRequestUrl("/api/trpc"),
        maxItems: TRPC_CLIENT_MAX_BATCH_ITEMS,
        maxURLLength: TRPC_CLIENT_MAX_URL_LENGTH,
        // tRPC v11: transformer MUST be inside httpBatchLink, not at root
        transformer: superjson,
        headers: trpcCredentialAdmissionHeaders,
        // Applies to all tRPC paths, including background polling/refetches.
        fetch: fetchWithCredentialAdmission,
      }),
    ],
  });
}
