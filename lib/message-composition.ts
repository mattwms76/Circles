export const MAX_READ_RECEIPT_ATTEMPTS = 3;

const MESSAGE_RETRY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A message operation ID is generated once per composition attempt and retained
 * by the caller until the server confirms settlement. It must be cryptographic:
 * falling back to a timestamp/counter would weaken server-side idempotency.
 */
export function createMessageCompositionRetryId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value || !MESSAGE_RETRY_ID.test(value)) {
    throw new Error("Secure message retry IDs are unavailable");
  }
  return value;
}

/**
 * Retries stay intentionally short and finite while the conversation remains
 * mounted. A newer delivered message resets the caller's attempt counter.
 */
export function readReceiptRetryDelayMs(
  failedAttempts: number,
): number | null {
  if (
    !Number.isSafeInteger(failedAttempts) ||
    failedAttempts < 1 ||
    failedAttempts >= MAX_READ_RECEIPT_ATTEMPTS
  ) {
    return null;
  }
  return failedAttempts === 1 ? 250 : 1_000;
}
