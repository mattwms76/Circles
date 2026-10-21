import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  logoutAndPurgeClientSession,
  purgeClientSession,
} from "../lib/client-session";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

describe("client account session transitions", () => {
  it("cancels an active account request and removes query and mutation state before a late result", async () => {
    const queryClient = makeQueryClient();
    const messagesKey = ["trpc", "social.messages", { conversationId: 71 }];
    queryClient.setQueryData(messagesKey, ["A private message"]);
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: ["trpc", "social.sendMessage"],
      mutationFn: async () => undefined,
    });

    let resolveAResponse!: (value: string[]) => void;
    let requestWasAborted = false;
    const inFlightA = queryClient.fetchQuery({
      queryKey: messagesKey,
      queryFn: ({ signal }) =>
        new Promise<string[]>((resolve) => {
          resolveAResponse = resolve;
          signal.addEventListener("abort", () => {
            requestWasAborted = true;
          });
        }),
    });
    void inFlightA.catch(() => undefined);

    await purgeClientSession(queryClient);

    expect(requestWasAborted).toBe(true);
    expect(queryClient.getQueryData(messagesKey)).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);

    resolveAResponse(["late A private message"]);
    await Promise.resolve();
    expect(queryClient.getQueryData(messagesKey)).toBeUndefined();
  });

  it("clears local state before remote completion and rethrows a remote revocation failure", async () => {
    const queryClient = makeQueryClient();
    const accountKey = ["trpc", "social.conversations"];
    queryClient.setQueryData(accountKey, ["A inbox"]);
    const calls: string[] = [];

    await expect(
      logoutAndPurgeClientSession(
        async () => {
          expect(queryClient.getQueryData(accountKey)).toBeUndefined();
          throw new Error("synthetic offline logout");
        },
        queryClient,
        {
          clearLocalCredentials: async () => {
            calls.push("credentials");
          },
          clearPrivateImageCaches: async () => {
            calls.push("images");
          },
          resetProtectedNavigation: () => {
            calls.push("navigation");
          },
        },
      ),
    ).rejects.toThrow("synthetic offline logout");

    expect(queryClient.getQueryData(accountKey)).toBeUndefined();
    expect(calls).toEqual(
      expect.arrayContaining(["credentials", "images", "navigation"]),
    );
  });
});
