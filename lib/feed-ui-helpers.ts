export type CreateMode = "post" | "circle" | "live";

export const UI_COLLECTION_PAGE_SIZE = 20;
/**
 * Current social list endpoints cap their array responses at 100 items and do
 * not yet expose a continuation cursor. Never label a capped response as the
 * end of a collection.
 */
export const LEGACY_COLLECTION_RESPONSE_CAP = 100;

export type AuthGateState = "checking" | "authenticated" | "guest" | "error";

export function resolveAuthGateState({
  isLoading,
  isError,
  hasUser,
}: {
  isLoading: boolean;
  isError: boolean;
  hasUser: boolean;
}): AuthGateState {
  if (isLoading) return "checking";
  if (isError) return "error";
  return hasUser ? "authenticated" : "guest";
}

export function normalizeCreateMode(value: unknown): CreateMode {
  return value === "circle" || value === "live" || value === "post"
    ? value
    : "post";
}

/** Accepts only canonical positive safe-integer route identifiers. */
export function parsePositiveSafeId(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function isCircleCoverMime(mimeType: string): boolean {
  return (
    mimeType === "image/jpeg" ||
    mimeType === "image/png" ||
    mimeType === "image/webp"
  );
}

export function validateComposerDraft({
  mode,
  text,
  name,
  category,
  hasMedia,
}: {
  mode: CreateMode;
  text: string;
  name: string;
  category: string;
  hasMedia: boolean;
}): string | undefined {
  const trimmedText = text.trim();
  const trimmedName = name.trim();

  if (mode === "post") {
    if (!trimmedText && !hasMedia) return "Add a moment or a few words first.";
    if (trimmedText.length > 10_000)
      return "Keep your moment under 10,000 characters.";
    return undefined;
  }

  if (mode === "circle") {
    if (trimmedName.length < 2)
      return "Give your circle a name with at least 2 characters.";
    if (trimmedName.length > 140)
      return "Keep your circle name under 140 characters.";
    if (!trimmedText) return "Tell people what brings your circle together.";
    if (trimmedText.length > 5_000)
      return "Keep your circle description under 5,000 characters.";
    if (!category.trim()) return "Choose a category for your circle.";
    if (category.trim().length > 80)
      return "Keep your circle category under 80 characters.";
    return undefined;
  }

  if (!trimmedName) return "Give your live session a title.";
  return undefined;
}

export function mediaUploadKey({
  uri,
  mimeType,
  fileSize,
}: {
  uri: string;
  mimeType: string;
  fileSize?: number | null;
}): string {
  return `${uri}\u0000${mimeType}\u0000${fileSize ?? "unknown"}`;
}

export type ReusableUpload = { key: string; url: string };

export function reusableUploadUrl(
  upload: ReusableUpload | null,
  key: string,
): string | undefined {
  return upload?.key === key ? upload.url : undefined;
}

export type LoadedCollectionEndState =
  | "more-loaded"
  | "continuation-unavailable"
  | "end";

export function getBoundedLoadedCollection<T>(
  source: readonly T[] | undefined,
  visibleCount: number,
  pageSize = UI_COLLECTION_PAGE_SIZE,
  sourceCap = LEGACY_COLLECTION_RESPONSE_CAP,
): {
  items: T[];
  canAppend: boolean;
  nextVisibleCount: number;
  endState: LoadedCollectionEndState;
} {
  const items = Array.isArray(source) ? [...source] : [];
  const safePageSize =
    Number.isSafeInteger(pageSize) && pageSize > 0
      ? pageSize
      : UI_COLLECTION_PAGE_SIZE;
  const requestedCount = Number.isFinite(visibleCount)
    ? Math.max(0, Math.floor(visibleCount))
    : safePageSize;
  const boundedCount = Math.min(items.length, requestedCount);
  const canAppend = boundedCount < items.length;

  return {
    items: items.slice(0, boundedCount),
    canAppend,
    nextVisibleCount: Math.min(items.length, boundedCount + safePageSize),
    endState: canAppend
      ? "more-loaded"
      : items.length >= sourceCap
        ? "continuation-unavailable"
        : "end",
  };
}
