import { countNoun } from "./count-copy";

export const A26_PROFILE_NAME_MAX_LENGTH = 120;
export const A26_PROFILE_HANDLE_MIN_LENGTH = 2;
export const A26_PROFILE_HANDLE_MAX_LENGTH = 48;
export const A26_PROFILE_BIO_MAX_LENGTH = 2_000;

export type A26ProfileDraft = {
  name: string;
  handle: string;
  bio: string;
};

export type A26ProfileDraftErrors = Partial<
  Record<keyof A26ProfileDraft, string>
>;

const A26_PROFILE_HANDLE_PATTERN = /^@?[a-zA-Z0-9_.-]+$/;

/**
 * This mirrors the public, non-sensitive updateProfile router constraints. Keep
 * trimming here because the server trims before applying its minimums/maximums.
 */
export function normalizeA26ProfileDraft(
  draft: A26ProfileDraft,
): A26ProfileDraft {
  return {
    name: draft.name.trim(),
    handle: draft.handle.trim(),
    bio: draft.bio.trim(),
  };
}

export function validateA26ProfileDraft(
  draft: A26ProfileDraft,
): A26ProfileDraftErrors {
  const normalized = normalizeA26ProfileDraft(draft);
  const errors: A26ProfileDraftErrors = {};

  if (!normalized.name) {
    errors.name = "Enter your name.";
  } else if (normalized.name.length > A26_PROFILE_NAME_MAX_LENGTH) {
    errors.name = `Your name must be ${A26_PROFILE_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (normalized.handle.length < A26_PROFILE_HANDLE_MIN_LENGTH) {
    errors.handle = `Your handle must be at least ${A26_PROFILE_HANDLE_MIN_LENGTH} characters.`;
  } else if (normalized.handle.length > A26_PROFILE_HANDLE_MAX_LENGTH) {
    errors.handle = `Your handle must be ${A26_PROFILE_HANDLE_MAX_LENGTH} characters or fewer.`;
  } else if (!A26_PROFILE_HANDLE_PATTERN.test(normalized.handle)) {
    errors.handle =
      "Use letters, numbers, underscores, periods, or hyphens in your handle.";
  }

  if (normalized.bio.length > A26_PROFILE_BIO_MAX_LENGTH) {
    errors.bio = `Your bio must be ${A26_PROFILE_BIO_MAX_LENGTH} characters or fewer.`;
  }

  return errors;
}

export function hasA26ProfileDraftErrors(
  errors: A26ProfileDraftErrors,
): boolean {
  return Object.keys(errors).length > 0;
}

type A26ErrorShape = {
  code?: unknown;
  data?: { code?: unknown } | null;
};

/**
 * A malformed profile draft is recoverable in the editor, not a connection
 * failure. Other errors retain the existing transport/unknown recovery copy.
 */
export function a26ProfileUpdateErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, data } = error as A26ErrorShape;
    if (code === "BAD_REQUEST" || data?.code === "BAD_REQUEST") {
      return "These profile details need another look. Review the fields and try again.";
    }
  }
  return "We couldn’t update your profile. Check your connection and try again.";
}

export type A26ProfilePage<Item> = {
  items: readonly Item[];
};

/** Keeps every loaded page visible; the server owns ordering and visibility. */
export function flattenA26ProfilePages<Item>(
  pages: readonly A26ProfilePage<Item>[] | undefined,
): Item[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

export type A26ProfileFeedTab = "Moments" | "Saved";

export type A26ProfileMomentStatInput = {
  tab: A26ProfileFeedTab;
  loadedCount: number;
  hasNextPage: boolean;
  isInitialLoading: boolean;
  hasInitialError: boolean;
};

export type A26ProfileMomentStat = {
  displayValue: string;
  label: string;
  accessibilityLabel: string;
};

function normalizedA26ProfileCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

/**
 * Compact display avoids a narrow/large-text metric rail overflow. The
 * accessibility name intentionally preserves the unabridged exact count.
 */
export function formatA26ProfileStatCount(count: number): string {
  const safeCount = normalizedA26ProfileCount(count);
  if (safeCount < 1_000) return String(safeCount);
  if (safeCount < 1_000_000) {
    const compact = safeCount / 1_000;
    return `${compact >= 100 ? Math.round(compact) : Number(compact.toFixed(1))}K`;
  }
  if (safeCount < 1_000_000_000) {
    const compact = safeCount / 1_000_000;
    return `${compact >= 100 ? Math.round(compact) : Number(compact.toFixed(1))}M`;
  }
  const compact = safeCount / 1_000_000_000;
  return `${compact >= 100 ? Math.round(compact) : Number(compact.toFixed(1))}B`;
}

export function a26ProfileMomentStat({
  tab,
  loadedCount,
  hasNextPage,
  isInitialLoading,
  hasInitialError,
}: A26ProfileMomentStatInput): A26ProfileMomentStat {
  const noun = tab === "Saved" ? "saved moments" : "moments";
  if (isInitialLoading) {
    return {
      displayValue: "—",
      label: `${noun} loading`,
      accessibilityLabel: `${noun} are loading`,
    };
  }
  if (hasInitialError) {
    return {
      displayValue: "—",
      label: `${noun} unavailable`,
      accessibilityLabel: `${noun} are unavailable`,
    };
  }

  const exactCount = normalizedA26ProfileCount(loadedCount);
  const settledNoun = `${tab === "Saved" ? "saved " : ""}${countNoun(exactCount, "moment")}`;
  const completion = hasNextPage ? " loaded" : "";
  return {
    displayValue: formatA26ProfileStatCount(exactCount),
    label: `${settledNoun}${completion}`,
    accessibilityLabel: `${exactCount} ${settledNoun}${completion}`,
  };
}

export type A26ProfileStatsLayout = {
  container: {
    flexDirection: "row";
    flexWrap: "wrap" | "nowrap";
    columnGap: number;
    rowGap: number;
  };
  item: {
    flexGrow: number;
    flexShrink: number;
    flexBasis: `${number}%`;
    minWidth: number;
  };
};

/**
 * At narrow width or enlarged text, two flexible columns avoid the prior fixed
 * three-item rail while allowing the final metric to wrap into its own row.
 */
export function a26ProfileStatsLayout(
  width: number,
  fontScale: number,
): A26ProfileStatsLayout {
  const needsReflow = width <= 360 || fontScale >= 1.2;
  return {
    container: {
      flexDirection: "row",
      flexWrap: needsReflow ? "wrap" : "nowrap",
      columnGap: needsReflow ? 12 : 20,
      rowGap: needsReflow ? 12 : 0,
    },
    item: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: needsReflow ? "44%" : "0%",
      minWidth: 0,
    },
  };
}
