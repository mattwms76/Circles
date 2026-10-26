import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("hooks/live-avatar-context.tsx", "utf8");

describe("live avatar provider source contract", () => {
  it("uses account-keyed inner providers and exact viewer-scoped batched list inputs", () => {
    expect(source).toContain("key={scopeKey}");
    expect(source).toContain("liveAvatarScopeKey(viewerScope)");
    expect(source).toContain("queries.live.list(");
    expect(source).toContain("{ hostIds, readyOnly: true, viewerScope }");
    expect(source).toContain("trpc.useQueries");
    expect(source).not.toContain("live.list.useQuery");
  });

  it("registers exact IDs with strict-mode-safe reference counts and stops polling in the background", () => {
    expect(source).toContain("new Map<number, number>()");
    expect(source).toContain("registrations.current.set(userId, count + 1)");
    expect(source).toContain("registrations.current.delete(userId)");
    expect(source).toMatch(
      /useEffect\(\s*\(\) => registerVisibleUserId\(userId\),\s*\[registerVisibleUserId, userId\],\s*\)/,
    );
    expect(source).toContain(
      "refetchInterval: requestEnabled ? LIVE_AVATAR_REFETCH_MS : false",
    );
    expect(source).toContain("refetchIntervalInBackground: false");
    expect(source).toContain("AppState.addEventListener");
    expect(source).toContain('document.addEventListener("visibilitychange"');
  });

  it("fails closed during auth checking or errors, avoids prior-account placeholders, and expires cached status locally", () => {
    expect(source).toContain('authState === "guest"');
    expect(source).toContain("authenticatedViewerScope !== null");
    expect(source).toContain("placeholderData: undefined");
    expect(source).toContain("resolveLiveAvatarStatus");
    expect(source).toContain("status.nextExpiryAt");
    expect(source).toContain("setTimeout(() => setClock(Date.now()), delay)");
    expect(source).toContain(
      "Live avatar status registration reached its 512-user safety limit.",
    );
  });
});
