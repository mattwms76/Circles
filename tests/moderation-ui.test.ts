import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ModerationCase,
  ModerationDetail,
  ModerationPage,
} from "../shared/moderation";
import {
  boundModerationNote,
  isConfirmedModerationAuthorityLoss,
  isCurrentModerationResolution,
  isCurrentModerationScope,
  moderationDecisionLabel,
  moderationScopeKey,
  resolveModerationDetailUiState,
  resolveModerationPagesUiState,
  serializeModerationNote,
  uniqueModerationCases,
  validateModerationNote,
} from "../lib/moderation-ui";

const scope = { circleId: 42, viewerScope: 7 };

const moderationCase = (
  id: number,
  overrides: Partial<ModerationCase> = {},
): ModerationCase => ({
  id,
  circleId: 42,
  postId: 91,
  status: "open",
  reportCount: 2,
  createdAt: "2026-10-23T00:00:00.000Z",
  lastReportedAt: "2026-10-23T00:01:00.000Z",
  resolvedAt: null,
  canResolve: true,
  blockedReason: null,
  ...overrides,
});

const page = (
  viewerScope: number,
  items: ModerationCase[],
): ModerationPage => ({
  circleId: 42,
  viewerScope,
  items,
  nextCursor: items.length ? { id: items.at(-1)!.id } : null,
});

const detail = (caseId: number, viewerScope = 7): ModerationDetail => ({
  circleId: 42,
  viewerScope,
  item: moderationCase(caseId),
  post: null,
  reasons: [{ reason: "Spam", count: 2 }],
  history: [],
});

describe("Moderation UI account and freshness contracts", () => {
  it("uses both circle and account only as cache affinity and rejects foreign queue/detail values", () => {
    expect(moderationScopeKey(scope)).toBe("moderation:42:7");

    const foreignPage = resolveModerationPagesUiState({
      pages: [page(8, [moderationCase(4)])],
      scope,
      queryEnabled: true,
      isFetchedAfterMount: true,
      isFetching: false,
      isError: false,
    });
    expect(foreignPage).toMatchObject({
      items: [],
      isError: true,
      isAuthorityAvailable: false,
    });

    const foreignCase = resolveModerationDetailUiState({
      detail: detail(5, 8),
      scope,
      caseId: 5,
      queryEnabled: true,
      isFetchedAfterMount: true,
      isFetching: false,
      isError: false,
    });
    expect(foreignCase).toMatchObject({
      detail: undefined,
      isError: true,
      isAuthorityAvailable: false,
    });
  });

  it("does not render pre-mount/error cache and suspends action authority during refresh", () => {
    const cached = page(7, [moderationCase(11)]);
    expect(
      resolveModerationPagesUiState({
        pages: [cached],
        scope,
        queryEnabled: true,
        isFetchedAfterMount: false,
        isFetching: true,
        isError: false,
      }),
    ).toMatchObject({
      items: [],
      isLoading: true,
      isAuthorityAvailable: false,
    });

    const refreshing = resolveModerationDetailUiState({
      detail: detail(11),
      scope,
      caseId: 11,
      queryEnabled: true,
      isFetchedAfterMount: true,
      isFetching: true,
      isError: false,
    });
    expect(refreshing.detail?.item.id).toBe(11);
    expect(refreshing.isAuthorityAvailable).toBe(false);

    expect(
      resolveModerationDetailUiState({
        detail: detail(11),
        scope,
        caseId: 11,
        queryEnabled: true,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: true,
      }),
    ).toMatchObject({
      detail: undefined,
      isError: true,
      isAuthorityAvailable: false,
    });
  });

  it("keeps bounded keyset pages in server order without duplicate case cards", () => {
    const first = page(7, [moderationCase(12), moderationCase(11)]);
    const second = page(7, [moderationCase(11), moderationCase(10)]);
    const state = resolveModerationPagesUiState({
      pages: [first, second],
      scope,
      queryEnabled: true,
      isFetchedAfterMount: true,
      isFetching: false,
      isError: false,
    });
    expect(state.items.map((item) => item.id)).toEqual([12, 11, 10]);
    expect(
      uniqueModerationCases([moderationCase(3), moderationCase(3)]),
    ).toHaveLength(1);
  });

  it("captures completion scope and response scope before mutating current UI state", () => {
    expect(
      isCurrentModerationScope(
        "moderation:42:7:case:11",
        "moderation:42:7:case:11",
        true,
      ),
    ).toBe(true);
    expect(
      isCurrentModerationScope(
        "moderation:42:7:case:11",
        "moderation:42:8:case:11",
        true,
      ),
    ).toBe(false);
    expect(
      isCurrentModerationScope(
        "moderation:42:7:case:11",
        "moderation:42:7:case:11",
        false,
      ),
    ).toBe(false);

    expect(
      isCurrentModerationResolution(
        { ...scope, caseId: 11, decision: "keep", note: "" },
        scope,
        11,
      ),
    ).toBe(true);
    expect(
      isCurrentModerationResolution(
        { ...scope, caseId: 12, decision: "keep", note: "" },
        scope,
        11,
      ),
    ).toBe(false);
  });

  it("bounds optional plain-text notes by Unicode code points and preserves a recoverable draft", () => {
    const max = "😀".repeat(500);
    const over = "😀".repeat(501);
    expect(boundModerationNote(over)).toBe(max);
    expect(Array.from(boundModerationNote(over))).toHaveLength(500);
    expect(validateModerationNote(max)).toBeUndefined();
    expect(validateModerationNote(over)).toMatch(/500/);
    expect(serializeModerationNote("  short note  ")).toBe("short note");
    expect(serializeModerationNote("   ")).toBe("");
  });

  it("recognizes only explicit session or role authority denial as a draft-clearing boundary", () => {
    expect(
      isConfirmedModerationAuthorityLoss({ data: { code: "FORBIDDEN" } }),
    ).toBe(true);
    expect(
      isConfirmedModerationAuthorityLoss({ data: { code: "UNAUTHORIZED" } }),
    ).toBe(true);
    expect(
      isConfirmedModerationAuthorityLoss({ data: { code: "BAD_REQUEST" } }),
    ).toBe(false);
    expect(isConfirmedModerationAuthorityLoss(new Error("network"))).toBe(
      false,
    );
    expect(moderationDecisionLabel("keep")).toBe("Kept");
    expect(moderationDecisionLabel("remove")).toBe("Removed");
  });

  it("keeps the route, manager entry, queue/detail procedures, and cross-platform removal guard wired", () => {
    const workspace = readFileSync(
      join(process.cwd(), "components/moderation-workspace.tsx"),
      "utf8",
    );
    const route = readFileSync(
      join(process.cwd(), "app/moderation/[circleId].tsx"),
      "utf8",
    );
    const circle = readFileSync(
      join(process.cwd(), "app/circle/[id].tsx"),
      "utf8",
    );

    expect(workspace).toContain("trpc.moderation.list.useInfiniteQuery");
    expect(workspace).toContain("trpc.moderation.detail.useQuery");
    expect(workspace).toContain("trpc.moderation.resolve.useMutation");
    expect(workspace).toContain("resolveModerationPagesUiState");
    expect(workspace).toContain("resolveModerationDetailUiState");
    expect(workspace).toContain('Platform.OS === "web"');
    expect(workspace).toContain("Alert.alert(");
    expect(workspace).toContain("<PostCard post={selected.post} />");
    expect(workspace).not.toMatch(/reporterId|reporterName/);
    expect(route).toContain("key={moderationScopeKey(scope)}");
    expect(circle).toContain('title="Open Reports"');
    expect(circle).toContain("router.push(`/moderation/${circleId}`)");
  });
});
