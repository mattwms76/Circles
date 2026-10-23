import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  aggregateModerationReasons,
  recordModerationReport,
} from "../server/moderation-events";

describe("moderation report aggregate events", () => {
  it("counts current one-per-reporter rows exactly, ranks at most twenty reasons, and has a deterministic tie order", () => {
    const later = new Date("2026-10-23T12:05:00.000Z");
    const aggregate = aggregateModerationReasons([
      { reason: " Spam ", updatedAt: new Date("2026-10-23T12:00:00.000Z") },
      { reason: "Spam", updatedAt: later },
      { reason: "Abuse", updatedAt: new Date("2026-10-23T12:01:00.000Z") },
    ]);
    expect(aggregate).toEqual({
      reportCount: 3,
      reasons: [
        { reason: "Spam", count: 2 },
        { reason: "Abuse", count: 1 },
      ],
      lastReportedAt: later,
    });

    const bounded = aggregateModerationReasons(
      Array.from({ length: 25 }, (_, index) => ({
        reason: `Reason ${String(index).padStart(2, "0")}`,
        updatedAt: later,
      })),
    );
    expect(bounded?.reportCount).toBe(25);
    expect(bounded?.reasons).toHaveLength(20);
    expect(bounded?.reasons[0]).toEqual({ reason: "Reason 00", count: 1 });
    expect(bounded?.reasons.at(-1)).toEqual({ reason: "Reason 19", count: 1 });
  });

  it("does not touch a transaction for legacy global reports", async () => {
    await expect(
      recordModerationReport({} as never, {
        circleId: null,
        postId: 11,
        subjectUserId: 7,
      }),
    ).resolves.toBeUndefined();
  });

  it("upserts the full current snapshot after report persistence without recording reporter identity", async () => {
    const rows = [
      { reason: "Spam", updatedAt: new Date("2026-10-23T12:01:00.000Z") },
      { reason: "Abuse", updatedAt: new Date("2026-10-23T12:02:00.000Z") },
    ];
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const tx = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({ orderBy: async () => rows }),
        }),
      })),
      insert: vi.fn(() => ({ values })),
    };

    await recordModerationReport(tx as never, {
      circleId: 4,
      postId: 11,
      subjectUserId: 7,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        circleId: 4,
        postId: 11,
        sourcePostId: 11,
        subjectUserId: 7,
        reportCount: 2,
        reasons: [
          { reason: "Abuse", count: 1 },
          { reason: "Spam", count: 1 },
        ],
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.any(Array) }),
    );
  });

  it("attaches the aggregate only after the established report upsert and leaves global reports on the legacy path", () => {
    const social = readFileSync("server/social-service.ts", "utf8");
    const report = social.slice(
      social.indexOf("export async function reportPost"),
      social.indexOf("async function ensureConversationParticipant"),
    );
    expect(report.indexOf(".onConflictDoUpdate")).toBeGreaterThan(-1);
    expect(report.indexOf(".onConflictDoUpdate")).toBeLessThan(
      report.indexOf("recordModerationReport"),
    );
    expect(report).toContain("circleId: post.circleId");
  });
});
