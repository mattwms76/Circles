import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  activityInternals,
  getActivityUnread,
} from "../server/activity-service";
const mock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: mock.getDb }));
vi.mock("../server/social-service", () => ({ getActivityPostTarget: vi.fn() }));

describe("activity public identity and read snapshot", () => {
  it("bounds profile labels by Unicode code points, not surrogate units", () => {
    expect(activityInternals.activityDisplayName("  Public profile  ")).toBe(
      "Public profile",
    );
    expect(
      Array.from(
        activityInternals.activityDisplayName("\u{1F642}".repeat(141)),
      ),
    ).toHaveLength(140);
    const source = readFileSync(
      new URL("../server/activity-service.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("name: profiles.name");
    expect(source).not.toContain("users.name");
  });
  it("fetches count and watermark together in exactly one recipient-scoped aggregate", async () => {
    const where = vi.fn().mockResolvedValue([{ count: "2", throughId: 19 }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    mock.getDb.mockResolvedValue({ select });
    await expect(getActivityUnread(71, { viewerScope: 71 })).resolves.toEqual({
      viewerId: 71,
      count: 2,
      throughId: 19,
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.calls[0][0]).toHaveProperty("count");
    expect(select.mock.calls[0][0]).toHaveProperty("throughId");
    expect(where).toHaveBeenCalledTimes(1);
  });
});
