import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createLiveOperationScope,
  isCurrentLiveOperationScope,
  type LiveOperationScope,
} from "../lib/batch4-live-operation-scope";

const liveRoute = readFileSync(
  new URL("../app/live/[id].tsx", import.meta.url),
  "utf8",
);

function committedScopeLifecycle() {
  let generation = 0;
  let current: LiveOperationScope | null = null;

  return {
    setup(accountId: number | null, routeId: string) {
      generation += 1;
      const scope = createLiveOperationScope({
        accountId,
        routeId,
        generation,
      });
      current = scope;
      return {
        scope,
        cleanup() {
          if (isCurrentLiveOperationScope(scope, current)) current = null;
        },
      };
    },
    current() {
      return current;
    },
  };
}

describe("Batch 4 live operation scope", () => {
  it("rejects an older A lifecycle after an A → B → A account and route sequence", () => {
    const lifecycle = committedScopeLifecycle();
    const firstA = lifecycle.setup(71, "live/42");
    lifecycle.setup(72, "live/42");
    const secondA = lifecycle.setup(71, "live/42");

    expect(firstA.scope.accountId).toBe(secondA.scope.accountId);
    expect(firstA.scope.routeId).toBe(secondA.scope.routeId);
    expect(firstA.scope.generation).toBeLessThan(secondA.scope.generation);
    expect(isCurrentLiveOperationScope(firstA.scope, lifecycle.current())).toBe(
      false,
    );
    expect(
      isCurrentLiveOperationScope(secondA.scope, lifecycle.current()),
    ).toBe(true);
  });

  it("makes Strict Mode setup → cleanup → setup a fresh committed lifecycle", () => {
    const lifecycle = committedScopeLifecycle();
    const firstSetup = lifecycle.setup(71, "live/42");

    firstSetup.cleanup();
    expect(lifecycle.current()).toBeNull();

    const replayedSetup = lifecycle.setup(71, "live/42");
    firstSetup.cleanup();

    expect(replayedSetup.scope.generation).toBeGreaterThan(
      firstSetup.scope.generation,
    );
    expect(lifecycle.current()).toBe(replayedSetup.scope);
    expect(
      isCurrentLiveOperationScope(firstSetup.scope, lifecycle.current()),
    ).toBe(false);
  });

  it("uses a keyed session boundary and committed opaque scope for every live completion path", () => {
    expect(liveRoute).toContain("key={liveSessionKey}");
    expect(liveRoute).toContain("useLayoutEffect(() => {");
    expect(liveRoute).toContain("liveOperationGenerationRef.current += 1;");
    expect(liveRoute).toContain(
      "currentLiveOperationScopeRef.current = activeScope;",
    );
    expect(liveRoute).toContain(
      "const operationScope = captureLiveOperationScope();",
    );
    expect(liveRoute).toContain(
      "if (!isCurrentLiveScope(operationScope)) return;",
    );
    expect(liveRoute).toContain("void refetchChat(operationScope);");
    expect(liveRoute).toContain("onRetry={retryLiveList}");
    expect(liveRoute).toContain("onRetry={retryChat}");
    expect(liveRoute).toContain("onError={handleLiveMediaError}");
    expect(liveRoute).toContain("onReady={handleLiveMediaReady}");
    expect(liveRoute).toContain('router.replace("/live");');
    expect(liveRoute).toContain("const generation = hostGeneration;");
    expect(liveRoute).toContain("{ streamId, generation },");
    expect(liveRoute).not.toContain("onRetry={() => void chat.refetch()}");
  });
});
