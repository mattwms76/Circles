import { describe, expect, it } from "vitest";
import {
  invalidateCircleDirectories,
  invalidateModerationViews,
  invalidatePostFeeds,
  invalidateProfileViews,
  type SourceQueryUtils,
} from "../lib/source-query-invalidation";

type Procedure = {
  invalidate: () => Promise<unknown>;
};

function makeUtils(rejected: ReadonlySet<string> = new Set()): {
  calls: string[];
  utils: SourceQueryUtils;
} {
  const calls: string[] = [];
  const procedure = (name: string): Procedure => ({
    invalidate: async () => {
      calls.push(name);
      if (rejected.has(name)) throw new Error(`synthetic ${name} rejection`);
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

describe("shared source query invalidation helpers", () => {
  it("invalidates both legacy and paged post feeds", async () => {
    const { calls, utils } = makeUtils();

    await expect(invalidatePostFeeds(utils)).resolves.toBeUndefined();

    expect(calls).toEqual(["social.feed", "social.feedPage"]);
  });

  it("invalidates both legacy and paged circle directories", async () => {
    const { calls, utils } = makeUtils();

    await expect(invalidateCircleDirectories(utils)).resolves.toBeUndefined();

    expect(calls).toEqual(["social.circles", "social.circlesPage"]);
  });

  it("covers all profile-dependent views without omitting paged feeds or conversations", async () => {
    const { calls, utils } = makeUtils();

    await expect(invalidateProfileViews(utils)).resolves.toBeUndefined();

    expect(calls).toEqual([
      "social.profile",
      "social.profiles",
      "social.profilesPage",
      "social.feed",
      "social.feedPage",
      "social.conversations",
    ]);
  });

  it("invalidates both moderation list and selected-case detail", async () => {
    const { calls, utils } = makeUtils();

    await expect(invalidateModerationViews(utils)).resolves.toBeUndefined();

    expect(calls).toEqual(["moderation.list", "moderation.detail"]);
  });

  it("contains a rejected observer refetch while still attempting every target", async () => {
    const { calls, utils } = makeUtils(new Set(["social.feed"]));

    await expect(invalidateProfileViews(utils)).resolves.toBeUndefined();

    expect(calls).toEqual([
      "social.profile",
      "social.profiles",
      "social.profilesPage",
      "social.feed",
      "social.feedPage",
      "social.conversations",
    ]);
  });
});
