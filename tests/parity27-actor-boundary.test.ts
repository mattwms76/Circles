import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  actorBoundaryKey,
  actorBoundaryResetRequired,
  isAuthAuthorityQueryKey,
  observedActorForAuth,
  resetActorScopedClientState,
} from "../lib/parity27-actor-boundary";
import { isCurrentSourceQueryForPath } from "../lib/source-query-invalidation";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function trpcKey(router: string, procedure: string): QueryKey {
  return [[router, procedure], { type: "query" }];
}

describe("parity27 actor boundary", () => {
  it("requires a reset only for a confirmed replacement and gives each admitted actor an isolated subtree key", () => {
    expect(observedActorForAuth("checking", { id: 7 })).toBeUndefined();
    expect(observedActorForAuth("error", { id: 7 })).toBeUndefined();
    expect(observedActorForAuth("guest", null)).toBeNull();
    expect(observedActorForAuth("authenticated", { id: 7 })).toBe(7);

    expect(actorBoundaryResetRequired(7, undefined)).toBe(false);
    expect(actorBoundaryResetRequired(undefined, 7)).toBe(false);
    expect(actorBoundaryResetRequired(7, 7)).toBe(false);
    expect(actorBoundaryResetRequired(7, 8)).toBe(true);
    expect(actorBoundaryResetRequired(7, null)).toBe(true);
    expect(actorBoundaryResetRequired(null, 8)).toBe(true);

    expect(actorBoundaryKey(7)).toBe("actor:7");
    expect(actorBoundaryKey(8)).toBe("actor:8");
    expect(actorBoundaryKey(null)).toBe("actor:guest");
    expect(actorBoundaryKey(undefined)).toBe("actor:unresolved");
  });

  it("treats the AppShell circles sidebar as a current actor projection on a wide shell route", () => {
    expect(
      isCurrentSourceQueryForPath(trpcKey("social", "circles"), "/profile", 8),
    ).toBe(true);
    expect(
      isCurrentSourceQueryForPath(
        trpcKey("social", "circles"),
        "/profile",
        null,
      ),
    ).toBe(false);
  });

  it("retains only current auth authority while synchronously removing former actor queries and mutations", async () => {
    const queryClient = makeQueryClient();
    const authKey = trpcKey("auth", "me");
    const inboxKey = trpcKey("social", "conversations");
    queryClient.setQueryData(authKey, { id: 8, name: "Synthetic B" });
    queryClient.setQueryData(inboxKey, ["Synthetic A inbox preview"]);
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: ["social", "sendMessage"],
      mutationFn: async () => undefined,
    });

    let resolveFormerRequest!: (value: string[]) => void;
    let formerRequestAborted = false;
    const formerRequest = queryClient.fetchQuery({
      queryKey: trpcKey("social", "messages"),
      queryFn: ({ signal }) =>
        new Promise<string[]>((resolve) => {
          resolveFormerRequest = resolve;
          signal.addEventListener("abort", () => {
            formerRequestAborted = true;
          });
        }),
    });
    void formerRequest.catch(() => undefined);

    const reset = resetActorScopedClientState(queryClient);

    expect(formerRequestAborted).toBe(true);
    expect(queryClient.getQueryData(inboxKey)).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(queryClient.getQueryData(authKey)).toEqual({
      id: 8,
      name: "Synthetic B",
    });
    expect(isAuthAuthorityQueryKey(authKey)).toBe(true);
    expect(isAuthAuthorityQueryKey(inboxKey)).toBe(false);

    await reset;
    resolveFormerRequest(["late synthetic A message"]);
    await Promise.resolve();
    expect(
      queryClient.getQueryData(trpcKey("social", "messages")),
    ).toBeUndefined();
  });
});
