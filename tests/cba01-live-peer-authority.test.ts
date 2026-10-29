import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  currentLivePeerAuthority,
  hasLivePeerAuthority,
} from "../shared/live-peer-authority";
import { liveHostPeerIdsToEvict } from "../lib/live-peer-authority";

const webSource = readFileSync(
  new URL("../components/live-media.web.tsx", import.meta.url),
  "utf8",
);
const nativeSource = readFileSync(
  new URL("../components/live-media.native.tsx", import.meta.url),
  "utf8",
);
const routerSource = readFileSync(
  new URL("../server/live-router.ts", import.meta.url),
  "utf8",
);

const now = Date.UTC(2026, 9, 29, 12, 0, 0);
const VIEWER_LEASE_MS = 30_000;

describe("CBA-01 authoritative WebRTC peer eviction", () => {
  it("excludes silent lease expiry and a revoked private membership from the host authority snapshot", () => {
    const authority = currentLivePeerAuthority({
      now,
      viewerLeaseMs: VIEWER_LEASE_MS,
      privateCircle: true,
      viewers: [
        {
          userId: 20,
          generation: 4,
          leftAt: null,
          lastSeenAt: new Date(now - VIEWER_LEASE_MS + 1),
        },
        {
          userId: 21,
          generation: 2,
          leftAt: null,
          lastSeenAt: new Date(now - VIEWER_LEASE_MS),
        },
        {
          userId: 22,
          generation: 6,
          leftAt: null,
          lastSeenAt: new Date(now - 1),
        },
      ],
      memberships: [
        { userId: 20, role: "member" },
        { userId: 21, role: "member" },
        // User 22 was removed after its peer was negotiated.
      ],
    });

    expect(authority).toEqual([{ userId: 20, generation: 4 }]);
    expect(hasLivePeerAuthority(authority, 20, 4)).toBe(true);
    expect(hasLivePeerAuthority(authority, 21, 2)).toBe(false);
    expect(hasLivePeerAuthority(authority, 22, 6)).toBe(false);
  });

  it("initiates every stale close before opening capacity for a replacement generation", () => {
    const authority = [{ userId: 20, generation: 5 }];
    const establishedPeers = [
      { viewerId: 20, viewerGeneration: 4 },
      { viewerId: 21, viewerGeneration: 2 },
      { viewerId: 22, viewerGeneration: 6 },
    ];

    const closeOrder = liveHostPeerIdsToEvict({
      peers: establishedPeers,
      authority,
    });
    const events: string[] = [];
    for (const viewerId of closeOrder) events.push(`close:${viewerId}`);
    for (const viewer of authority) events.push(`offer:${viewer.userId}`);

    expect(closeOrder).toEqual([20, 21, 22]);
    expect(events).toEqual(["close:20", "close:21", "close:22", "offer:20"]);
  });

  it("keeps both adapters and the server on the generation-bound authority contract", () => {
    for (const source of [webSource, nativeSource]) {
      expect(source).toContain("api.live.peerAuthority.query({");
      expect(source).toContain("liveHostPeerIdsToEvict({");
      expect(source).toContain("await reconcileHostPeers();");
      expect(source).toContain(
        "peer.viewerGeneration !== signal.fromGeneration",
      );

      const reconciliation = source.slice(
        source.indexOf("const reconcileHostPeers"),
        source.indexOf("const handleSignal"),
      );
      expect(reconciliation.indexOf("closePeer(viewerId)")).toBeGreaterThan(-1);
      expect(reconciliation.indexOf("closePeer(viewerId)")).toBeLessThan(
        reconciliation.indexOf(
          "await hostPeer(viewer.userId, viewer.generation)",
        ),
      );
    }

    expect(routerSource).toContain("peerAuthority: protectedProcedure");
    expect(routerSource).toContain("currentLivePeerAuthority({");
    expect(routerSource).toContain(
      "fromGeneration: liveSignals.fromGeneration",
    );
  });
});
