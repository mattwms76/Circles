import { describe, expect, it } from "vitest";
import {
  A26_CIRCLE_HERO_BACKPLATE_COLOR,
  getA26CurrentAvatar,
  getA26LiveControlCopy,
  getA26MomentsRailState,
  getA26OwnProfileQueryInput,
  isA26CurrentActorProfile,
} from "../lib/a26-directory-ui";

function luminance(hex: string): number {
  const normalized = hex.replace("#", "");
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (light + 0.05) / (dark + 0.05);
}

describe("A26 directory UI policies", () => {
  it("A26-005 scopes own-profile requests to the current actor", () => {
    expect(getA26OwnProfileQueryInput(42)).toStrictEqual({ id: 42 });
    expect(getA26OwnProfileQueryInput(undefined)).toBeUndefined();
    expect(getA26OwnProfileQueryInput(Number.NaN)).toBeUndefined();
  });

  it("A26-005 never renders a cached avatar whose response identity differs from the current actor", () => {
    expect(getA26CurrentAvatar(42, { id: 42, avatar: "owned-avatar" })).toBe(
      "owned-avatar",
    );
    expect(getA26CurrentAvatar(42, { id: 7, avatar: "former-avatar" })).toBe(
      undefined,
    );
    expect(
      getA26CurrentAvatar(undefined, { id: 42, avatar: "former-avatar" }),
    ).toBe(undefined);
  });

  it("A26-006 recognizes the current actor’s directory row before a Follow mutation can be offered", () => {
    expect(isA26CurrentActorProfile(42, 42)).toBe(true);
    expect(isA26CurrentActorProfile(42, 7)).toBe(false);
    expect(isA26CurrentActorProfile(undefined, 42)).toBe(false);
  });

  it("A26-019 uses a fully opaque hero backplate with at least AA contrast for each hero foreground", () => {
    expect(
      contrastRatio("#FFFFFF", A26_CIRCLE_HERO_BACKPLATE_COLOR),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio("#EEF6E9", A26_CIRCLE_HERO_BACKPLATE_COLOR),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("A26-020 keeps loading, failure, successful empty, and populated moments rails distinct", () => {
    expect(
      getA26MomentsRailState({ isLoading: true, isError: false, itemCount: 0 }),
    ).toBe("loading");
    expect(
      getA26MomentsRailState({ isLoading: false, isError: true, itemCount: 0 }),
    ).toBe("error");
    expect(
      getA26MomentsRailState({
        isLoading: false,
        isError: false,
        itemCount: 0,
      }),
    ).toBe("empty");
    expect(
      getA26MomentsRailState({
        isLoading: false,
        isError: false,
        itemCount: 1,
      }),
    ).toBe("content");
  });

  it("A26-021 keeps the Live accessible name aligned with visual count and readiness", () => {
    expect(
      getA26LiveControlCopy({ count: 3, isError: false, isLoading: false }),
    ).toStrictEqual({
      accessibilityLabel: "Open Live now, 3 live sessions",
      visibleText: "Live now · 3",
    });
    expect(
      getA26LiveControlCopy({ count: 1, isError: false, isLoading: false }),
    ).toStrictEqual({
      accessibilityLabel: "Open Live now, 1 live session",
      visibleText: "Live now · 1",
    });
    expect(
      getA26LiveControlCopy({
        count: undefined,
        isError: false,
        isLoading: true,
      }),
    ).toStrictEqual({
      accessibilityLabel: "Open Live now, checking live sessions",
      visibleText: "Live now · checking",
    });
    expect(
      getA26LiveControlCopy({
        count: undefined,
        isError: true,
        isLoading: false,
      }),
    ).toStrictEqual({
      accessibilityLabel: "Open Live now, live sessions unavailable",
      visibleText: "Live now · unavailable",
    });
  });
});
