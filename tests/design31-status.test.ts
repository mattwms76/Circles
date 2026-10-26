import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStatusAnnouncementDedupe,
  normalizeStatusMessage,
  statusAccessibilityProps,
} from "../lib/status-announcement";

const native = vi.hoisted(() => ({
  platform: "web",
  announcements: [] as {
    message: string;
    options?: { queue?: boolean; priority?: "low" | "default" | "high" };
  }[],
  focusRequests: [] as number[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (setup: () => void | (() => void)) => {
      void setup();
    },
    useState: (initialValue: unknown) => [
      typeof initialValue === "function" ? initialValue() : initialValue,
      vi.fn(),
    ],
  };
});

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return native.platform;
    },
  },
  AccessibilityInfo: {
    announceForAccessibility: (message: string) => {
      native.announcements.push({ message });
    },
    announceForAccessibilityWithOptions: (
      message: string,
      options: { queue?: boolean; priority?: "low" | "default" | "high" },
    ) => {
      native.announcements.push({ message, options });
    },
    setAccessibilityFocus: (reactTag: number) => {
      native.focusRequests.push(reactTag);
    },
  },
}));

vi.mock("@/components/circles-ui", () => ({
  C: { action: "#A53728", secondary: "#4D5948" },
  T: "T",
}));

const { StatusMessage } = await import("../components/status-message");

describe("D26-07 shared StatusMessage announcement contract", () => {
  beforeEach(() => {
    native.platform = "web";
    native.announcements.length = 0;
    native.focusRequests.length = 0;
  });

  it("normalizes empty statuses away from both visible and native output", () => {
    expect(normalizeStatusMessage(undefined)).toBeNull();
    expect(normalizeStatusMessage(null)).toBeNull();
    expect(normalizeStatusMessage("   \n ")).toBeNull();
    expect(normalizeStatusMessage("  Saved.  ")).toBe("Saved.");

    expect(StatusMessage({ message: "   ", testID: "save-status" })).toBeNull();
    expect(native.announcements).toEqual([]);
  });

  it("uses one supported live-region path per non-iOS platform", () => {
    expect(statusAccessibilityProps("info", "web")).toEqual({
      "aria-live": "polite",
    });
    expect(statusAccessibilityProps("success", "android")).toEqual({
      accessibilityLiveRegion: "polite",
    });
    expect(statusAccessibilityProps("error", "web")).toEqual({
      accessibilityRole: "alert",
      "aria-live": "assertive",
    });
    expect(statusAccessibilityProps("error", "android")).toEqual({
      accessibilityRole: "alert",
      accessibilityLiveRegion: "assertive",
    });
    expect(statusAccessibilityProps("error", "ios")).toEqual({});
  });

  it("announces each meaningful iOS change once, with polite and assertive native options", () => {
    const announcements: {
      message: string;
      options?: { queue?: boolean; priority?: "low" | "default" | "high" };
    }[] = [];
    const dedupe = createStatusAnnouncementDedupe();
    const announcer = {
      announceForAccessibilityWithOptions: (
        message: string,
        options: { queue?: boolean; priority?: "low" | "default" | "high" },
      ) => announcements.push({ message, options }),
    };

    expect(
      dedupe.announce({
        platform: "ios",
        message: "Saved.",
        tone: "success",
        announcer,
      }),
    ).toBe(true);
    expect(
      dedupe.announce({
        platform: "ios",
        message: "Could not save.",
        tone: "error",
        announcer,
      }),
    ).toBe(true);

    expect(announcements).toEqual([
      { message: "Saved.", options: { queue: true } },
      { message: "Could not save.", options: { priority: "high" } },
    ]);
  });

  it("deduplicates Strict-Mode-style repeated setup, but permits a later reappearance after empty", () => {
    const announceForAccessibility = vi.fn();
    const dedupe = createStatusAnnouncementDedupe();
    const input = {
      platform: "ios",
      message: "Profile updated.",
      tone: "success" as const,
      announcer: { announceForAccessibility },
    };

    expect(dedupe.announce(input)).toBe(true);
    expect(dedupe.announce(input)).toBe(false);
    expect(announceForAccessibility).toHaveBeenCalledTimes(1);

    expect(dedupe.announce({ ...input, message: null })).toBe(false);
    expect(dedupe.announce(input)).toBe(true);
    expect(announceForAccessibility).toHaveBeenCalledTimes(2);
  });

  it("never calls an explicit native announcer outside iOS and guards absent or failing bridges", () => {
    const announceForAccessibility = vi.fn();
    const dedupe = createStatusAnnouncementDedupe();

    expect(
      dedupe.announce({
        platform: "android",
        message: "Saved.",
        tone: "success",
        announcer: { announceForAccessibility },
      }),
    ).toBe(false);
    expect(announceForAccessibility).not.toHaveBeenCalled();

    expect(
      dedupe.announce({
        platform: "ios",
        message: "Saved.",
        tone: "success",
      }),
    ).toBe(false);
    expect(() =>
      dedupe.announce({
        platform: "ios",
        message: "Saved.",
        tone: "success",
        announcer: {
          announceForAccessibility: () => {
            throw new Error("synthetic unavailable bridge");
          },
        },
      }),
    ).not.toThrow();
  });

  it("renders visible text through T with safe semantic colors and exact element props", () => {
    native.platform = "web";
    const success = StatusMessage({
      message: "Saved.",
      tone: "success",
      style: { fontWeight: "700" },
      testID: "save-status",
    });
    expect(success?.type).toBe("T");
    expect(success?.props).toMatchObject({
      testID: "save-status",
      "aria-live": "polite",
      children: "Saved.",
    });
    expect(success?.props.accessibilityRole).toBeUndefined();
    expect(success?.props.style).toEqual([
      { fontWeight: "700" },
      { color: "#4D5948" },
    ]);
    expect(native.announcements).toEqual([]);

    native.platform = "android";
    const error = StatusMessage({
      message: "Please try again.",
      tone: "error",
    });
    expect(error?.props).toMatchObject({
      accessibilityRole: "alert",
      accessibilityLiveRegion: "assertive",
      children: "Please try again.",
    });
    expect(error?.props["aria-live"]).toBeUndefined();
    expect(error?.props.style).toEqual([undefined, { color: "#A53728" }]);
    expect(native.announcements).toEqual([]);

    native.platform = "ios";
    const ios = StatusMessage({ message: "Saved." });
    expect(ios?.props.accessibilityLiveRegion).toBeUndefined();
    expect(ios?.props["aria-live"]).toBeUndefined();
    expect(ios?.props.accessibilityRole).toBeUndefined();
    expect(native.announcements).toEqual([
      { message: "Saved.", options: { queue: true } },
    ]);
    expect(native.focusRequests).toEqual([]);
  });
});
