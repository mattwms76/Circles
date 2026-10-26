export type StatusTone = "info" | "success" | "error";

export type StatusLiveRegion = "polite" | "assertive";

export type StatusAccessibilityProps = Readonly<{
  accessibilityRole?: "alert";
  accessibilityLiveRegion?: StatusLiveRegion;
  "aria-live"?: StatusLiveRegion;
}>;

export type StatusNativeAnnouncer = Readonly<{
  announceForAccessibility?: (message: string) => void;
  announceForAccessibilityWithOptions?: (
    message: string,
    options: { queue?: boolean; priority?: "low" | "default" | "high" },
  ) => void;
}>;

export type StatusAnnouncementInput = Readonly<{
  platform: string;
  message: string | null | undefined;
  tone: StatusTone;
  announcer?: StatusNativeAnnouncer | null;
}>;

/** A blank status carries no visible or announcement meaning. */
export function normalizeStatusMessage(
  message: string | null | undefined,
): string | null {
  const normalized = message?.trim();
  return normalized ? normalized : null;
}

export function statusLiveRegionForTone(tone: StatusTone): StatusLiveRegion {
  return tone === "error" ? "assertive" : "polite";
}

/**
 * Web and Android have native live-region support. iOS deliberately has no
 * live-region prop here because the component sends one guarded native
 * announcement instead; applying both paths would risk speaking it twice.
 */
export function statusAccessibilityProps(
  tone: StatusTone,
  platform: string,
): StatusAccessibilityProps {
  if (platform === "ios") return {};

  const liveRegion = statusLiveRegionForTone(tone);
  const errorRole =
    tone === "error" ? { accessibilityRole: "alert" as const } : {};

  if (platform === "web") {
    return { ...errorRole, "aria-live": liveRegion };
  }

  return { ...errorRole, accessibilityLiveRegion: liveRegion };
}

/**
 * Keeps the last announced meaning for one mounted StatusMessage. React Strict
 * Mode repeats effect setup, so an unchanged status must not be announced twice.
 * Returning to an empty status resets the boundary for a later new appearance.
 */
export function createStatusAnnouncementDedupe() {
  let lastAnnouncedMeaning: string | null = null;

  return {
    announce({
      platform,
      message,
      tone,
      announcer,
    }: StatusAnnouncementInput): boolean {
      const normalizedMessage = normalizeStatusMessage(message);
      if (!normalizedMessage) {
        lastAnnouncedMeaning = null;
        return false;
      }

      if (platform !== "ios") return false;

      const meaning = `${tone}\u0000${normalizedMessage}`;
      if (meaning === lastAnnouncedMeaning) return false;

      try {
        if (
          typeof announcer?.announceForAccessibilityWithOptions === "function"
        ) {
          announcer.announceForAccessibilityWithOptions(
            normalizedMessage,
            tone === "error" ? { priority: "high" } : { queue: true },
          );
          lastAnnouncedMeaning = meaning;
          return true;
        }

        if (typeof announcer?.announceForAccessibility === "function") {
          announcer.announceForAccessibility(normalizedMessage);
          lastAnnouncedMeaning = meaning;
          return true;
        }
      } catch {
        // The visual status remains available if a native bridge is unavailable.
      }

      return false;
    },
  };
}
