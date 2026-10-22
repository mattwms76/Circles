import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { completeNativeLoginTransition } from "../hooks/native-login-transition";

function makeNativeLoginTransitionQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

describe("provider native-login completion transition", () => {
  it("resets guest UI, removes stale account state, and verifies the freshly persisted bearer", async () => {
    const queryClient = makeNativeLoginTransitionQueryClient();
    const privateFeedKey = ["trpc", "social.feed", { filter: "for-you" }];
    const guestAuthKey = ["trpc", "auth.me"];
    queryClient.setQueryData(privateFeedKey, ["synthetic private entry"]);
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: ["trpc", "social.sendMessage"],
      mutationFn: async () => undefined,
    });

    let resolveStaleGuest!: (value: { id: number } | null) => void;
    let staleGuestRequestWasAborted = false;
    const staleGuestRequest = queryClient.fetchQuery({
      queryKey: guestAuthKey,
      queryFn: ({ signal }) =>
        new Promise<{ id: number } | null>((resolve) => {
          resolveStaleGuest = resolve;
          signal.addEventListener("abort", () => {
            staleGuestRequestWasAborted = true;
          });
        }),
    });
    void staleGuestRequest.catch(() => undefined);

    const transitionSteps: string[] = [];
    const verifiedUser = { id: 42, name: "Synthetic user" };
    const completedUser = await completeNativeLoginTransition({
      queryClient,
      resetLoginModal: () => transitionSteps.push("modal"),
      resetSigning: () => transitionSteps.push("signing"),
      clearCachedUser: async () => {
        transitionSteps.push("cached-user");
      },
      clearPrivateImageCaches: async () => {
        transitionSteps.push("private-images");
      },
      invalidateAuth: async () => {
        transitionSteps.push("invalidate-auth");
        expect(staleGuestRequestWasAborted).toBe(true);
        expect(queryClient.getQueryData(privateFeedKey)).toBeUndefined();
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
      },
      refetchAuth: async () => {
        transitionSteps.push("refetch-auth");
        return { data: verifiedUser };
      },
    });

    expect(completedUser).toEqual(verifiedUser);
    expect(transitionSteps).toEqual([
      "modal",
      "signing",
      "cached-user",
      "private-images",
      "invalidate-auth",
      "refetch-auth",
    ]);

    resolveStaleGuest({ id: 7 });
    await Promise.resolve();
    expect(queryClient.getQueryData(guestAuthKey)).toBeUndefined();
  });

  it("does not establish an authenticated identity when the fresh auth.me result remains guest", async () => {
    const queryClient = makeNativeLoginTransitionQueryClient();
    const calls: string[] = [];

    const completedUser = await completeNativeLoginTransition({
      queryClient,
      resetLoginModal: () => calls.push("modal"),
      resetSigning: () => calls.push("signing"),
      clearCachedUser: async () => {
        calls.push("cached-user");
      },
      clearPrivateImageCaches: async () => {
        calls.push("private-images");
      },
      invalidateAuth: async () => {
        calls.push("invalidate-auth");
      },
      refetchAuth: async () => {
        calls.push("refetch-auth");
        return { data: null };
      },
    });

    expect(completedUser).toBeNull();
    expect(calls).toEqual([
      "modal",
      "signing",
      "cached-user",
      "private-images",
      "invalidate-auth",
      "refetch-auth",
    ]);
  });
});
