import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  platform: "ios",
  announcements: [] as {
    message: string;
    options?: { queue?: boolean; priority?: "low" | "default" | "high" };
  }[],
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
    announceForAccessibilityWithOptions: (
      message: string,
      options: { queue?: boolean; priority?: "low" | "default" | "high" },
    ) => {
      native.announcements.push({ message, options });
    },
  },
}));

vi.mock("@/components/circles-ui", () => ({
  C: { action: "#A53728", secondary: "#4D5948" },
  T: "T",
  Heading: "T",
}));

const { StatusMessage } = await import("../components/status-message");

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const contextCore = source("hooks/circles-context-core.ts");
const contextProvider = source("hooks/circles-context.tsx");
const liveRoute = source("app/live/[id].tsx");
const unsupportedLiveMedia = source("components/live-media.tsx");
const webLiveMedia = source("components/live-media.web.tsx");
const nativeLiveMedia = source("components/live-media.native.tsx");

const noticeProducerSources = [
  source("app/(tabs)/discover.tsx"),
  source("components/profile-screen.tsx"),
  source("components/post-card.tsx"),
  source("app/create.tsx"),
  source("app/chat/[id].tsx"),
  source("app/circle/[id].tsx"),
  source("components/app-shell.tsx"),
  source("components/circle-card.tsx"),
  liveRoute,
];

describe("D26-07 / D26-21 notice integration", () => {
  beforeEach(() => {
    native.platform = "ios";
    native.announcements.length = 0;
  });

  it("exposes the provider's existing typed tone through the shared context", () => {
    expect(contextCore).toContain(
      "notify: (message: string, tone?: StatusTone) => void;",
    );
    expect(contextProvider).toContain(
      '(message: string, tone: StatusTone = "info") => {',
    );
    expect(contextProvider).toContain("notify: showNotice,");
  });

  it("keeps a duplicate visual status visible without adding another platform announcement", () => {
    const visualOnly = StatusMessage({
      message: "Live video is unavailable.",
      tone: "error",
      announce: false,
    });

    expect(native.announcements).toEqual([]);
    expect(visualOnly?.props.accessibilityRole).toBeUndefined();
    expect(visualOnly?.props.accessibilityLiveRegion).toBeUndefined();

    native.platform = "web";
    const webVisualOnly = StatusMessage({
      message: "Live video is unavailable.",
      tone: "error",
      announce: false,
    });
    expect(webVisualOnly?.props["aria-live"]).toBeUndefined();
  });

  it("uses shared assertive status rendering for Live errors without a second route announcement", () => {
    expect(liveRoute).toContain("onError={handleLiveMediaError}");
    expect(liveRoute).toContain("message={mediaError}");
    expect(liveRoute).toContain('tone="error"');
    expect(liveRoute).toContain("announce={false}");
    expect(unsupportedLiveMedia).toContain("<StatusMessage");
    expect(unsupportedLiveMedia).toContain('message={message} tone="error"');
    expect(unsupportedLiveMedia).not.toContain('accessibilityRole="alert"');
  });

  it("uses feature-safe recovery copy and explicit success or error tones for every declared producer", () => {
    for (const producer of noticeProducerSources) {
      expect(producer).not.toMatch(/\b(?:error|e)\.message\b/);
      expect(producer).not.toMatch(/\b(?:error|e) instanceof Error\b/);
    }

    expect(noticeProducerSources.join("\n")).toContain('"success"');
    expect(noticeProducerSources.join("\n")).toContain('"error"');
    expect(webLiveMedia).not.toMatch(/error\.message/);
    expect(nativeLiveMedia).not.toMatch(/error\.message/);
    expect(webLiveMedia).toContain(
      "We couldn’t connect to the live stream. Check your connection and try again.",
    );
    expect(nativeLiveMedia).toContain(
      "We couldn’t connect to the live stream. Check your connection and try again.",
    );
  });
});
