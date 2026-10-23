import { describe, expect, it } from "vitest";
import {
  getBoundedLoadedCollection,
  isCircleCoverMime,
  mediaUploadKey,
  normalizeCreateMode,
  parsePositiveSafeId,
  resolveAuthGateState,
  reusableUploadUrl,
  UI_COLLECTION_PAGE_SIZE,
  validateComposerDraft,
} from "../lib/feed-ui-helpers";
import { isCircleCoverImageMime } from "../server/social-service";

describe("feed UI pure safety contracts", () => {
  it("keeps composer routes in the closed post, circle, live union", () => {
    expect(normalizeCreateMode("post")).toBe("post");
    expect(normalizeCreateMode("circle")).toBe("circle");
    expect(normalizeCreateMode("live")).toBe("live");
    expect(normalizeCreateMode("unexpected")).toBe("post");
    expect(normalizeCreateMode(["live"])).toBe("post");
    expect(normalizeCreateMode(undefined)).toBe("post");
  });

  it("accepts only canonical positive safe circle identifiers", () => {
    expect(parsePositiveSafeId("42")).toBe(42);
    expect(parsePositiveSafeId(42)).toBe(42);
    expect(parsePositiveSafeId("0")).toBeUndefined();
    expect(parsePositiveSafeId(" 42")).toBeUndefined();
    expect(parsePositiveSafeId("1.5")).toBeUndefined();
    expect(parsePositiveSafeId(["42"])).toBeUndefined();
    expect(parsePositiveSafeId("9007199254740992")).toBeUndefined();
  });

  it("rejects a video as a circle cover before upload and validates deterministic circle fields", () => {
    expect(isCircleCoverMime("image/jpeg")).toBe(true);
    expect(isCircleCoverMime("image/png")).toBe(true);
    expect(isCircleCoverMime("image/webp")).toBe(true);
    expect(isCircleCoverMime("video/mp4")).toBe(false);
    expect(isCircleCoverImageMime("image/jpeg")).toBe(true);
    expect(isCircleCoverImageMime("image/png")).toBe(true);
    expect(isCircleCoverImageMime("image/webp")).toBe(true);
    expect(isCircleCoverImageMime("video/mp4")).toBe(false);
    expect(
      validateComposerDraft({
        mode: "circle",
        name: "C",
        text: "",
        category: "Lifestyle",
        hasMedia: true,
      }),
    ).toMatch(/at least 2 characters/i);
    expect(
      validateComposerDraft({
        mode: "circle",
        name: "Coffee Club",
        text: "",
        category: "Lifestyle",
        hasMedia: true,
      }),
    ).toMatch(/what brings your circle together/i);
    expect(
      validateComposerDraft({
        mode: "circle",
        name: "Coffee Club",
        text: "A place to meet.",
        category: "Lifestyle",
        hasMedia: true,
      }),
    ).toBeUndefined();
  });

  it("reuses only an upload whose exact selected-asset key matches", () => {
    const key = mediaUploadKey({
      uri: "file:///synthetic-cover.jpg",
      mimeType: "image/jpeg",
      fileSize: 123,
    });
    expect(
      reusableUploadUrl({ key, url: "https://media.invalid/synthetic" }, key),
    ).toBe("https://media.invalid/synthetic");
    expect(
      reusableUploadUrl(
        { key, url: "https://media.invalid/synthetic" },
        mediaUploadKey({
          uri: "file:///different.jpg",
          mimeType: "image/jpeg",
          fileSize: 123,
        }),
      ),
    ).toBeUndefined();
  });

  it("keeps checking, auth read errors, guests, and authenticated users distinct", () => {
    expect(
      resolveAuthGateState({ isLoading: true, isError: false, hasUser: false }),
    ).toBe("checking");
    expect(
      resolveAuthGateState({ isLoading: false, isError: true, hasUser: false }),
    ).toBe("error");
    expect(
      resolveAuthGateState({ isLoading: false, isError: false, hasUser: false }),
    ).toBe("guest");
    expect(
      resolveAuthGateState({ isLoading: false, isError: false, hasUser: true }),
    ).toBe("authenticated");
  });

  it("reveals loaded items in bounded pages and never calls an exact legacy-cap response an end", () => {
    const source = Array.from({ length: UI_COLLECTION_PAGE_SIZE + 3 }, (_, id) => id);
    const firstPage = getBoundedLoadedCollection(source, UI_COLLECTION_PAGE_SIZE);
    expect(firstPage.items).toHaveLength(UI_COLLECTION_PAGE_SIZE);
    expect(firstPage.canAppend).toBe(true);
    expect(firstPage.nextVisibleCount).toBe(source.length);

    const shortCompletePage = getBoundedLoadedCollection([1, 2], 20);
    expect(shortCompletePage.endState).toBe("end");

    const cappedPage = getBoundedLoadedCollection(
      Array.from({ length: 100 }, (_, id) => id),
      100,
    );
    expect(cappedPage.canAppend).toBe(false);
    expect(cappedPage.endState).toBe("continuation-unavailable");
  });
});
