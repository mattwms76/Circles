import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const liveRouterSource = readFileSync(
  new URL("../server/live-router.ts", import.meta.url),
  "utf8",
);

describe("LIV-PG-001 PostgreSQL live mutations", () => {
  it("locks the host lease through a PostgreSQL primary-key conflict update", () => {
    expect(liveRouterSource).toContain(".onConflictDoUpdate({");
    expect(liveRouterSource).toContain("target: activeHostLeases.hostId");
    expect(liveRouterSource).toContain("set: { hostId }");
  });

  it("returns the created stream and renews viewers on their composite conflict key", () => {
    expect(liveRouterSource).toMatch(
      /\.insert\(streams\)[\s\S]*?\.returning\(\)/,
    );
    expect(liveRouterSource).toContain(
      "target: [liveViewers.streamId, liveViewers.userId]",
    );
  });

  it("does not reintroduce MySQL result or conflict APIs and keeps search case-insensitive", () => {
    expect(liveRouterSource).not.toContain("onDuplicateKeyUpdate");
    expect(liveRouterSource).not.toContain("insertId");
    expect(liveRouterSource).toContain("ilike(streams.title, `%${search}%`)");
  });
});
