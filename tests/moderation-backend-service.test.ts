import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: mocks.getDb }));

const { moderationInternals } = await import("../server/moderation-service");

describe("moderation service defensive boundaries", () => {
  it("enforces the same stale-viewer rejection before asking for a database", () => {
    expect(() => moderationInternals.assertViewerScope(9, 10)).toThrow(
      /account changed/i,
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("keeps descending-ID keyset pagination inside the documented bounds", () => {
    expect(
      moderationInternals.normalizeList({
        circleId: 4,
        viewerScope: 9,
        filter: "open",
      }),
    ).toEqual({ circleId: 4, filter: "open", limit: 20 });
    expect(
      moderationInternals.normalizeList({
        circleId: 4,
        viewerScope: 9,
        filter: "resolved",
        cursor: { id: 17 },
        limit: 50,
      }),
    ).toEqual({ circleId: 4, filter: "resolved", cursorId: 17, limit: 50 });
    expect(() =>
      moderationInternals.normalizeList({
        circleId: 4,
        viewerScope: 9,
        filter: "open",
        limit: 51,
      }),
    ).toThrow(/page size/i);
  });

  it("normalizes blank optional notes and counts astral notes as Unicode code points", () => {
    const astral = "😀";
    expect(
      moderationInternals.normalizeResolution({
        circleId: 4,
        viewerScope: 9,
        caseId: 17,
        decision: "keep",
        note: "   ",
      }),
    ).toMatchObject({ note: "" });
    expect(
      moderationInternals.normalizeResolution({
        circleId: 4,
        viewerScope: 9,
        caseId: 17,
        decision: "remove",
        note: astral.repeat(500),
      }).note,
    ).toBe(astral.repeat(500));
    expect(() =>
      moderationInternals.normalizeResolution({
        circleId: 4,
        viewerScope: 9,
        caseId: 17,
        decision: "remove",
        note: astral.repeat(501),
      }),
    ).toThrow(/note is too long/i);
  });
});
