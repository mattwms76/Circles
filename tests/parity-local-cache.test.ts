import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  invalidateCircleDirectories,
  invalidateModerationViews,
  invalidatePostFeeds,
  invalidateProfileViews,
  type SourceQueryUtils,
} from "../lib/source-query-invalidation";
import { isCurrentModerationScope } from "../lib/moderation-ui";

type InvalidationCalls = {
  calls: string[];
  utils: SourceQueryUtils;
};

function makeSourceUtils(): InvalidationCalls {
  const calls: string[] = [];
  const procedure = (name: string) => ({
    invalidate: async () => {
      calls.push(name);
    },
  });

  return {
    calls,
    utils: {
      social: {
        feed: procedure("social.feed"),
        feedPage: procedure("social.feedPage"),
        circles: procedure("social.circles"),
        circlesPage: procedure("social.circlesPage"),
        profile: procedure("social.profile"),
        profiles: procedure("social.profiles"),
        profilesPage: procedure("social.profilesPage"),
        conversations: procedure("social.conversations"),
      },
      moderation: {
        list: procedure("moderation.list"),
        detail: procedure("moderation.detail"),
      },
    },
  };
}

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("local cache parity invalidation helpers", () => {
  it("invalidates every paired paged and legacy source reader", async () => {
    const post = makeSourceUtils();
    await invalidatePostFeeds(post.utils);
    expect(post.calls.sort()).toEqual(["social.feed", "social.feedPage"]);

    const circles = makeSourceUtils();
    await invalidateCircleDirectories(circles.utils);
    expect(circles.calls.sort()).toEqual([
      "social.circles",
      "social.circlesPage",
    ]);

    const profile = makeSourceUtils();
    await invalidateProfileViews(profile.utils);
    expect(profile.calls.sort()).toEqual([
      "social.conversations",
      "social.feed",
      "social.feedPage",
      "social.profile",
      "social.profiles",
      "social.profilesPage",
    ]);

    const moderation = makeSourceUtils();
    await invalidateModerationViews(moderation.utils);
    expect(moderation.calls.sort()).toEqual([
      "moderation.detail",
      "moderation.list",
    ]);
  });

  it("wires owned mutation handlers to the matching parity helpers", () => {
    const profile = source("components/profile-screen.tsx");
    const circleCard = source("components/circle-card.tsx");
    const circleScreen = source("app/circle/[id].tsx");
    const postCard = source("components/post-card.tsx");

    expect(profile).toContain("invalidateProfileViews(utils)");
    expect(profile).toContain("requireAuth(() => update.mutate(draft))");
    expect(circleCard).toContain("invalidateCircleDirectories(utils)");
    expect(circleScreen).toContain("invalidateCircleDirectories(utils)");

    const sidebar = source("components/app-shell.tsx");
    const discover = source("app/(tabs)/discover.tsx");
    expect(sidebar).toContain("invalidateCircleDirectories(utils)");
    expect(discover).toContain("invalidateProfileViews(utils)");
    expect(profile.match(/invalidateProfileViews\(utils\)/g)).toHaveLength(2);

    expect(postCard.match(/invalidatePostFeeds\(utils\)/g)).toHaveLength(4);
    expect(postCard.match(/invalidateModerationViews\(utils\)/g)).toHaveLength(
      2,
    );
    expect(postCard).toContain("post.circleId !== null");
    expect(postCard).toContain("const operationPost = post;");
    const removeHandler = postCard.slice(
      postCard.indexOf("const removePost ="),
      postCard.indexOf("  return (", postCard.indexOf("const removePost =")),
    );
    expect(removeHandler).toContain("requireAuth(() => {");
    expect(removeHandler).toContain("{ postId: operationPost.id }");
    expect(removeHandler).toContain(
      "if (!isCurrentSource(operationScope, operationPost)) return;",
    );
    expect(removeHandler).toContain("invalidatePostFeeds(utils)");
    expect(removeHandler).toContain("invalidateModerationViews(utils)");
  });

  it("derives optimistic post state from the active source/account boundary", () => {
    const postCard = source("components/post-card.tsx");
    const sourceLifecycleStart = postCard.indexOf("useEffect(() => {");
    const sourceLifecycleEnd = postCard.indexOf(
      "const liked =",
      sourceLifecycleStart,
    );
    const sourceLifecycle = postCard.slice(
      sourceLifecycleStart,
      sourceLifecycleEnd,
    );

    expect(postCard).toContain(
      'const sourceScope = `${user?.id ?? "guest"}:${post.id}`',
    );
    expect(postCard).toContain("likeOptimism?.source === post");
    expect(postCard).toContain("saveOptimism?.source === post");
    expect(postCard).toContain("likeOptimism.scope === sourceScope");
    expect(postCard).toContain("saveOptimism.scope === sourceScope");
    expect(sourceLifecycle).toContain(
      "const activeSource = { scope: sourceScope, post }",
    );
    expect(sourceLifecycle).toContain(
      "currentSourceScope.current = activeSource",
    );
    expect(sourceLifecycle).toContain(
      "currentSourceScope.current === activeSource",
    );
    expect(sourceLifecycle).not.toContain("setLikeOptimism");
    expect(sourceLifecycle).not.toContain("setSaveOptimism");
    expect(
      postCard.match(/isCurrentSource\(operationScope, operationPost\)/g),
    ).toHaveLength(11);
  });
});

describe("moderation conflict and account scope lifecycle", () => {
  it("rejects stale account, case, and unmounted completion scopes", () => {
    const active = "moderation:42:7:case:11";
    expect(isCurrentModerationScope(active, active, true)).toBe(true);
    expect(
      isCurrentModerationScope(active, "moderation:42:8:case:11", true),
    ).toBe(false);
    expect(
      isCurrentModerationScope(active, "moderation:42:7:case:12", true),
    ).toBe(false);
    expect(isCurrentModerationScope(active, active, false)).toBe(false);
  });

  it("refreshes matching moderation detail and queue before releasing conflict controls", () => {
    const workspace = source("components/moderation-workspace.tsx");
    const refreshStart = workspace.indexOf("const refreshResolvedCase");
    const submitStart = workspace.indexOf("const submitResolution");
    const submitEnd = workspace.indexOf("const requestRemoval");
    const refresh = workspace.slice(refreshStart, submitStart);
    const submit = workspace.slice(submitStart, submitEnd);

    expect(refresh).toContain("await invalidateModerationViews(utils)");
    expect(refresh).toContain(
      "await Promise.all([detail.refetch(), queue.refetch()])",
    );
    expect(refresh).toContain("await invalidatePostFeeds(utils)");
    expect(
      refresh.match(/isCurrentCase\(capturedScope, caseId\)/g),
    ).toHaveLength(4);

    const conflict = submit.slice(
      submit.indexOf("if (isModerationConflict(caught))"),
      submit.indexOf("if (isConfirmedModerationAuthorityLoss(caught))"),
    );
    expect(conflict).toContain(
      "await refreshResolvedCase(capturedScope, caseId)",
    );
    expect(conflict).toContain(
      "if (!isCurrentCase(capturedScope, caseId)) return",
    );
    expect(
      submit.indexOf("await refreshResolvedCase(capturedScope, caseId)"),
    ).toBeLessThan(submit.indexOf("setPendingDecision(null)"));
    expect(workspace).not.toContain("confirmedNoLongerResolvable");
    expect(workspace).not.toMatch(/reporterId|reporterName/);
  });
});
