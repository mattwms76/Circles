import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canReleaseModerationAuthorityLatch,
  createModerationAuthorityLatch,
  resolveModerationRouteAuthGate,
} from "../lib/a26-moderation-authority";

describe("A26 moderation auth gate", () => {
  it("makes an auth error win over retained identity, guest UI, and workspace mounting", () => {
    expect(
      resolveModerationRouteAuthGate({ authState: "error", hasUser: true }),
    ).toBe("auth-error");
    expect(
      resolveModerationRouteAuthGate({ authState: "error", hasUser: false }),
    ).toBe("auth-error");
    expect(
      resolveModerationRouteAuthGate({ authState: "checking", hasUser: false }),
    ).toBe("checking");
    expect(
      resolveModerationRouteAuthGate({ authState: "guest", hasUser: false }),
    ).toBe("guest");
    expect(
      resolveModerationRouteAuthGate({
        authState: "authenticated",
        hasUser: true,
      }),
    ).toBe("workspace");
  });
});

describe("A26 moderation authority-loss latch", () => {
  it("does not restore detail controls from cached responses that predate a known denial", () => {
    const latch = createModerationAuthorityLatch({
      scopeKey: "moderation:42:7",
      listDataUpdatedAt: 100,
      detailDataUpdatedAt: 101,
      requiresDetail: true,
    });

    expect(
      canReleaseModerationAuthorityLatch({
        latch,
        scopeKey: "moderation:42:7",
        listAuthorityAvailable: true,
        listDataUpdatedAt: 100,
        detailAuthorityAvailable: true,
        detailDataUpdatedAt: 101,
      }),
    ).toBe(false);
    expect(
      canReleaseModerationAuthorityLatch({
        latch,
        scopeKey: "moderation:42:7",
        listAuthorityAvailable: true,
        listDataUpdatedAt: 102,
        detailAuthorityAvailable: true,
        detailDataUpdatedAt: 101,
      }),
    ).toBe(false);
  });

  it("releases an open-case latch only after newer current list and detail responses", () => {
    const latch = createModerationAuthorityLatch({
      scopeKey: "moderation:42:7",
      listDataUpdatedAt: 100,
      detailDataUpdatedAt: 101,
      requiresDetail: true,
    });

    expect(
      canReleaseModerationAuthorityLatch({
        latch,
        scopeKey: "moderation:42:7",
        listAuthorityAvailable: true,
        listDataUpdatedAt: 102,
        detailAuthorityAvailable: true,
        detailDataUpdatedAt: 103,
      }),
    ).toBe(true);
    expect(
      canReleaseModerationAuthorityLatch({
        latch,
        scopeKey: "moderation:42:8",
        listAuthorityAvailable: true,
        listDataUpdatedAt: 102,
        detailAuthorityAvailable: true,
        detailDataUpdatedAt: 103,
      }),
    ).toBe(false);
  });

  it("allows a queue-only latch to recover from a newer authorized list response", () => {
    const latch = createModerationAuthorityLatch({
      scopeKey: "moderation:42:7",
      listDataUpdatedAt: 100,
      detailDataUpdatedAt: undefined,
      requiresDetail: false,
    });

    expect(
      canReleaseModerationAuthorityLatch({
        latch,
        scopeKey: "moderation:42:7",
        listAuthorityAvailable: true,
        listDataUpdatedAt: 101,
        detailAuthorityAvailable: false,
        detailDataUpdatedAt: undefined,
      }),
    ).toBe(true);
  });
});

describe("A26 moderation source wiring", () => {
  it("wires route-level auth retry and authority-loss action suppression to the helpers", () => {
    const workspace = readFileSync(
      join(process.cwd(), "components/moderation-workspace.tsx"),
      "utf8",
    );
    const route = readFileSync(
      join(process.cwd(), "app/moderation/[circleId].tsx"),
      "utf8",
    );

    expect(route).toContain("resolveModerationRouteAuthGate");
    expect(route).toContain('if (authGate === "auth-error")');
    expect(route).toContain('action="Try again"');
    expect(route).toContain("onAction={refresh}");
    expect(route.indexOf('authGate === "auth-error"')).toBeLessThan(
      route.indexOf('authGate === "guest"'),
    );

    expect(workspace).toContain(
      "isConfirmedModerationAuthorityLoss(queue.error)",
    );
    expect(workspace).toContain("canReleaseModerationAuthorityLatch");
    expect(workspace).toContain("listDataUpdatedAt: queue.dataUpdatedAt");
    expect(workspace).toContain("detailDataUpdatedAt: detail.dataUpdatedAt");
    expect(workspace).toContain("authorityLocked ||");
    expect(workspace).toContain('title="Refresh permissions"');
    expect(workspace).toContain("await queue.refetch()");
    expect(workspace).toContain("await detail.refetch()");
  });
});
