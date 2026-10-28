export type PostPublishPayload = {
  text: string;
  media?: string;
  mediaType: "text" | "photo" | "video";
  circleId?: number;
};
export type PostPublishAttempt = PostPublishPayload & {
  clientPublishId: string;
};

export function canonicalPostPublishPayload(
  payload: PostPublishPayload,
): PostPublishPayload {
  return {
    text: payload.text.trim(),
    media: payload.media?.trim() || undefined,
    mediaType: payload.mediaType,
    circleId: payload.circleId,
  };
}

/** In-memory, per composer/account. Never regenerate an ID for an unsettled request. */
export function createPostPublishAttemptTracker() {
  let attempt: PostPublishAttempt | null = null;
  let submitted = false;
  return {
    isUnsettled: () => submitted,
    prepare(
      payload: PostPublishPayload,
      createId: () => string,
    ): PostPublishAttempt {
      const canonical = canonicalPostPublishPayload(payload);
      if (attempt) {
        const previous = canonicalPostPublishPayload(attempt);
        if (JSON.stringify(previous) === JSON.stringify(canonical))
          return attempt;
        if (submitted)
          throw new Error(
            "Retry the pending publication before changing your draft.",
          );
      }
      attempt = { ...canonical, clientPublishId: createId() };
      return attempt;
    },
    markSubmitted() {
      submitted = true;
    },
    reject() {
      // A definitive rejection unlocks editing, but an unchanged Retry must keep
      // its ID, including after the server reports a deleted-post tombstone.
      submitted = false;
    },
    clear() {
      attempt = null;
      submitted = false;
    },
  };
}

/** A transport timeout/unknown server failure may follow a committed post. */
export function isDefinitivePostPublishError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data = error.data;
  if (!data || typeof data !== "object" || !("code" in data)) return false;
  return [
    "BAD_REQUEST",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "PRECONDITION_FAILED",
    "PAYLOAD_TOO_LARGE",
  ].includes(String(data.code));
}

/**
 * A readiness/upload retry can fail before this invocation reaches createPost.
 * If a prior createPost response was ambiguous, that preflight failure says
 * nothing about whether the original operation committed, so its exact ID and
 * payload must remain frozen. Definitive errors settle only the request that
 * actually reached createPost during this invocation.
 */
export function shouldKeepPostPublishAttemptUnsettled({
  isPost,
  hasUnsettledAttempt,
  postRequestStarted,
  error,
}: {
  isPost: boolean;
  hasUnsettledAttempt: boolean;
  postRequestStarted: boolean;
  error: unknown;
}): boolean {
  return (
    isPost &&
    hasUnsettledAttempt &&
    (!postRequestStarted || !isDefinitivePostPublishError(error))
  );
}
