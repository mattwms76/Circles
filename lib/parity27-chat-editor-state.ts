export type ChatEditorAuthorityLatch = {
  scope: string;
  messagesDataUpdatedAt: number;
  metadataDataUpdatedAt: number;
};

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExplicitAuthorityCode(value: unknown): boolean {
  return value === "UNAUTHORIZED" || value === "FORBIDDEN";
}

/**
 * Only a structured application denial revokes locally retained chat content.
 * Transport and validation failures remain recoverable so a continuation retry
 * does not discard already loaded transcript pages.
 */
export function isExplicitChatEditorAuthorityError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (hasExplicitAuthorityCode(error.code)) return true;

  const data = isRecord(error.data) ? error.data : null;
  if (hasExplicitAuthorityCode(data?.code)) return true;

  const shape = isRecord(error.shape) ? error.shape : null;
  const shapeData = shape && isRecord(shape.data) ? shape.data : null;
  return hasExplicitAuthorityCode(shapeData?.code);
}

function validTimestamp(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/** Captures the exact cached generations that pre-date an explicit denial. */
export function createChatEditorAuthorityLatch({
  scope,
  messagesDataUpdatedAt,
  metadataDataUpdatedAt,
}: {
  scope: string;
  messagesDataUpdatedAt: number | undefined;
  metadataDataUpdatedAt: number | undefined;
}): ChatEditorAuthorityLatch {
  return {
    scope,
    messagesDataUpdatedAt: validTimestamp(messagesDataUpdatedAt),
    metadataDataUpdatedAt: validTimestamp(metadataDataUpdatedAt),
  };
}

/**
 * A denial cannot be cleared by the same cached transcript or metadata. The
 * route needs both newer data generations and a matching authorized metadata
 * result before local reads and writes can resume.
 */
export function canReleaseChatEditorAuthorityLatch({
  latch,
  scope,
  transcriptAuthorityAvailable,
  messagesDataUpdatedAt,
  metadataAuthorityAvailable,
  metadataDataUpdatedAt,
}: {
  latch: ChatEditorAuthorityLatch | null;
  scope: string;
  transcriptAuthorityAvailable: boolean;
  messagesDataUpdatedAt: number | undefined;
  metadataAuthorityAvailable: boolean;
  metadataDataUpdatedAt: number | undefined;
}): boolean {
  return !!(
    latch &&
    latch.scope === scope &&
    transcriptAuthorityAvailable &&
    metadataAuthorityAvailable &&
    validTimestamp(messagesDataUpdatedAt) > latch.messagesDataUpdatedAt &&
    validTimestamp(metadataDataUpdatedAt) > latch.metadataDataUpdatedAt
  );
}

/**
 * A profile edit is valid only for the rendered authenticated actor and that
 * actor's own profile resource. The string is suitable for a React key and for
 * synchronously withholding editor-local state during account replacement.
 */
export function ownProfileEditorScope({
  accountId,
  profileId,
  ownsProfile,
}: {
  accountId: number | null | undefined;
  profileId: number | null | undefined;
  ownsProfile: boolean;
}): string | null {
  if (
    !ownsProfile ||
    !Number.isSafeInteger(accountId) ||
    (accountId ?? 0) <= 0 ||
    !Number.isSafeInteger(profileId) ||
    profileId !== accountId
  ) {
    return null;
  }

  return `${accountId}:profile:${profileId}`;
}
