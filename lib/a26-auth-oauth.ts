export const ACCOUNT_EMAIL_OAUTH_CONTINUATION = "/account/email" as const;

export type OAuthContinuation = typeof ACCOUNT_EMAIL_OAUTH_CONTINUATION;

export type NativeOAuthPendingFlow = {
  flowToken: string;
  generation: number;
  continuation: OAuthContinuation | null;
  expiresAt: number | null;
};

const FLOW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const PENDING_FLOW_VERSION = 1;

export function normalizeOAuthContinuation(
  value: string | null | undefined,
): OAuthContinuation | null {
  return value === ACCOUNT_EMAIL_OAUTH_CONTINUATION
    ? ACCOUNT_EMAIL_OAUTH_CONTINUATION
    : null;
}

function isValidGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isValidExpiry(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * The previous release persisted only the raw bearer-quality flow token. Keep
 * that form readable for a callback already in flight, but write versioned
 * records for all new flows so callbacks can compare exact identity.
 */
export function parseNativeOAuthPendingFlow(
  stored: string | null | undefined,
): NativeOAuthPendingFlow | null {
  if (!stored) return null;
  if (FLOW_TOKEN_PATTERN.test(stored)) {
    return {
      flowToken: stored,
      generation: 0,
      continuation: null,
      expiresAt: null,
    };
  }

  try {
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const continuation = normalizeOAuthContinuation(
      typeof record.continuation === "string" ? record.continuation : null,
    );
    if (
      record.version !== PENDING_FLOW_VERSION ||
      typeof record.flowToken !== "string" ||
      !FLOW_TOKEN_PATTERN.test(record.flowToken) ||
      !isValidGeneration(record.generation) ||
      (record.continuation !== null && continuation === null) ||
      (record.expiresAt !== null && !isValidExpiry(record.expiresAt))
    ) {
      return null;
    }

    return {
      flowToken: record.flowToken,
      generation: record.generation,
      continuation,
      expiresAt: record.expiresAt as number | null,
    };
  } catch {
    return null;
  }
}

export function serializeNativeOAuthPendingFlow(
  flow: NativeOAuthPendingFlow,
): string {
  if (
    !FLOW_TOKEN_PATTERN.test(flow.flowToken) ||
    !isValidGeneration(flow.generation) ||
    (flow.continuation !== null &&
      flow.continuation !== ACCOUNT_EMAIL_OAUTH_CONTINUATION) ||
    (flow.expiresAt !== null && !isValidExpiry(flow.expiresAt))
  ) {
    throw new Error("Invalid native OAuth pending flow");
  }

  return JSON.stringify({
    version: PENDING_FLOW_VERSION,
    flowToken: flow.flowToken,
    generation: flow.generation,
    continuation: flow.continuation,
    expiresAt: flow.expiresAt,
  });
}

/** Exact token plus generation prevents F1 from clearing or completing F2. */
export function isSameNativeOAuthPendingFlow(
  left: NativeOAuthPendingFlow | null | undefined,
  right: NativeOAuthPendingFlow | null | undefined,
): boolean {
  return (
    !!left &&
    !!right &&
    left.flowToken === right.flowToken &&
    left.generation === right.generation
  );
}
