import type { QueryClient } from "@tanstack/react-query";

export type LocalCredentialCleanupOutcome = {
  platform: "native" | "web";
  nativeBearer: "cleared" | "failed" | "not_applicable";
  cachedUserInfo: "cleared" | "failed";
  /** HttpOnly cookies can only be cleared by a successful server response. */
  httpOnlySessionCookie: "not_applicable" | "server_required";
};

export type ClientSessionPurgeOptions = {
  clearLocalCredentials?: () =>
    | Promise<LocalCredentialCleanupOutcome | void>
    | LocalCredentialCleanupOutcome
    | void;
  clearPrivateImageCaches?: () => Promise<void> | void;
  resetProtectedNavigation?: () => void;
};

export type CredentialAdmissionBarrierOptions = {
  /** Confirms the non-secret incomplete-logout marker was durably written. */
  confirmPersisted: () => Promise<boolean> | boolean;
  /** Removes that marker only after every other logout fence has succeeded. */
  clearAfterConfirmedLogout: () => Promise<boolean> | boolean;
};

export type CleanupAttempt<T> = {
  status: "cleared" | "failed" | "not_requested";
  result?: T;
};

export type ClientSessionPurgeOutcome = {
  localCredentials: CleanupAttempt<LocalCredentialCleanupOutcome | void>;
  privateImageCaches: CleanupAttempt<void>;
  protectedNavigation: CleanupAttempt<void>;
};

export type CredentialAdmissionBarrierOutcome = {
  persistence: CleanupAttempt<void>;
  removal: CleanupAttempt<void>;
};

export type ClientLogoutOutcome = {
  remoteRevocation: "confirmed" | "unconfirmed";
  purge: ClientSessionPurgeOutcome;
  credentialAdmission: CredentialAdmissionBarrierOutcome;
};

export type ClientLogoutRecovery = {
  complete: boolean;
  blocksAuthenticatedContinuation: boolean;
  message: string;
  remoteStatus: string;
  localCredentialStatus: string;
  privateImageCacheStatus: string;
  protectedNavigationStatus: string;
  credentialAdmissionStatus: string;
};

async function runCleanup<T>(
  cleanup: (() => Promise<T> | T) | undefined,
): Promise<CleanupAttempt<T>> {
  if (!cleanup) return { status: "not_requested" };
  try {
    return { status: "cleared", result: await cleanup() };
  } catch {
    return { status: "failed" };
  }
}

async function runConfirmedCleanup(
  cleanup: (() => Promise<boolean> | boolean) | undefined,
): Promise<CleanupAttempt<void>> {
  if (!cleanup) return { status: "not_requested" };
  try {
    return (await cleanup()) ? { status: "cleared" } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

function localCredentialCleanupFailed(
  outcome: LocalCredentialCleanupOutcome | void | undefined,
): boolean {
  return (
    !!outcome &&
    (outcome.nativeBearer === "failed" || outcome.cachedUserInfo === "failed")
  );
}

function localCredentialStatus(outcome: ClientLogoutOutcome): string {
  const attempt = outcome.purge.localCredentials;
  if (attempt.status === "failed") {
    return "Local credential cleanup could not be completed.";
  }
  if (attempt.status === "not_requested" || !attempt.result) {
    return "Local credential cleanup was not reported.";
  }

  const credentials = attempt.result;
  if (credentials.platform === "web") {
    if (credentials.cachedUserInfo === "failed") {
      return "Browser profile data could not be cleared.";
    }
    return outcome.remoteRevocation === "confirmed"
      ? "Browser profile data was cleared and the server confirmed cookie sign-out."
      : "Browser profile data was cleared, but the HttpOnly session cookie can only be cleared by confirmed server sign-out.";
  }

  if (credentials.nativeBearer === "failed") {
    return "This device could not remove its secure native credential.";
  }
  if (credentials.cachedUserInfo === "failed") {
    return "This device removed its secure credential, but could not clear cached profile data.";
  }
  return "This device removed its secure credential and cached profile data.";
}

function privateImageCacheStatus(outcome: ClientLogoutOutcome): string {
  switch (outcome.purge.privateImageCaches.status) {
    case "cleared":
      return "Private image cache cleanup completed.";
    case "failed":
      return "Private image cache cleanup could not be completed.";
    default:
      return "Private image cache cleanup was not requested.";
  }
}

function protectedNavigationStatus(outcome: ClientLogoutOutcome): string {
  switch (outcome.purge.protectedNavigation.status) {
    case "cleared":
      return "Protected navigation was reset.";
    case "failed":
      return "Protected navigation could not be reset.";
    default:
      return "Protected navigation reset was not requested.";
  }
}

function credentialAdmissionStatus(outcome: ClientLogoutOutcome): string {
  const barrier = outcome.credentialAdmission;
  if (barrier.persistence.status === "not_requested") {
    return "Credential admission marker was not requested.";
  }
  if (barrier.persistence.status === "failed") {
    return "The incomplete sign-out recovery marker could not be persisted.";
  }
  if (barrier.removal.status === "cleared") {
    return "Credential admission reopened after confirmed secure sign-out.";
  }
  if (barrier.removal.status === "failed") {
    return "Secure sign-out completed its other steps, but the recovery marker could not be removed.";
  }
  return "Credential admission remains closed until secure sign-out cleanup is confirmed.";
}

/**
 * Converts non-secret cleanup facts into user-facing status. In particular, a
 * web client never calls an HttpOnly cookie locally cleared: it requires the
 * remote logout response that owns that cookie.
 */
export function describeClientLogoutOutcome(
  outcome: ClientLogoutOutcome,
): ClientLogoutRecovery {
  const credentialResult = outcome.purge.localCredentials.result;
  const remoteFailed = outcome.remoteRevocation === "unconfirmed";
  const localFailed =
    outcome.purge.localCredentials.status === "failed" ||
    localCredentialCleanupFailed(credentialResult);
  const cacheFailed = outcome.purge.privateImageCaches.status === "failed";
  const navigationFailed =
    outcome.purge.protectedNavigation.status === "failed";
  const barrierRequired =
    outcome.credentialAdmission.persistence.status !== "not_requested";
  const barrierFailed =
    barrierRequired &&
    (outcome.credentialAdmission.persistence.status !== "cleared" ||
      outcome.credentialAdmission.removal.status !== "cleared");
  const complete =
    !remoteFailed &&
    !localFailed &&
    !cacheFailed &&
    !navigationFailed &&
    !barrierFailed;

  let message = "Secure sign-out completed.";
  if (!complete && remoteFailed && credentialResult?.platform === "web") {
    message =
      "Secure sign-out is incomplete. This browser’s HttpOnly session cookie cannot be cleared locally until the server confirms sign-out. Retry secure sign-out.";
  } else if (
    !complete &&
    remoteFailed &&
    credentialResult?.platform === "native" &&
    credentialResult.nativeBearer === "failed"
  ) {
    message =
      "Secure sign-out is incomplete. The server could not confirm revocation and this device could not remove its secure credential. Retry secure sign-out before continuing.";
  } else if (!complete && localFailed) {
    message =
      "Secure sign-out is incomplete because local credential cleanup failed. Retry secure sign-out before continuing.";
  } else if (!complete && cacheFailed) {
    message =
      "Secure sign-out is incomplete because private image cache cleanup failed. Retry secure sign-out before continuing.";
  } else if (!complete && navigationFailed) {
    message =
      "Secure sign-out is incomplete because protected navigation could not reset. Retry secure sign-out before continuing.";
  } else if (!complete && barrierFailed) {
    message =
      "Secure sign-out is incomplete because its recovery marker could not be confirmed. Retry secure sign-out before continuing.";
  } else if (!complete && remoteFailed) {
    message =
      "Secure sign-out could not be confirmed. Retry secure sign-out before continuing.";
  }

  return {
    complete,
    blocksAuthenticatedContinuation: !complete,
    message,
    remoteStatus:
      outcome.remoteRevocation === "confirmed"
        ? "Remote session revocation was confirmed."
        : "Remote session revocation could not be confirmed.",
    localCredentialStatus: localCredentialStatus(outcome),
    privateImageCacheStatus: privateImageCacheStatus(outcome),
    protectedNavigationStatus: protectedNavigationStatus(outcome),
    credentialAdmissionStatus: credentialAdmissionStatus(outcome),
  };
}

/** An incomplete logout carries only redacted status facts, never a credential. */
export class ClientSessionLogoutIncompleteError extends Error {
  readonly outcome: ClientLogoutOutcome;

  constructor(outcome: ClientLogoutOutcome, cause?: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : "Secure sign-out could not be completed.",
    );
    this.name = "ClientSessionLogoutIncompleteError";
    this.outcome = outcome;
  }
}

export function clientLogoutOutcomeFromError(
  error: unknown,
): ClientLogoutOutcome | null {
  return error instanceof ClientSessionLogoutIncompleteError
    ? error.outcome
    : null;
}

/**
 * Removes account-derived client state before another account can render.
 *
 * QueryClient.clear() removes query and mutation caches. Cancellation is
 * requested first so an active request cannot repopulate an attached observer
 * after the cache is removed. Cleanup outcomes are retained so a caller can
 * distinguish a failed credential/cache removal from a completed removal.
 */
export async function purgeClientSession(
  queryClient: QueryClient,
  options: ClientSessionPurgeOptions = {},
): Promise<ClientSessionPurgeOutcome> {
  let cancellation: Promise<void> | undefined;
  try {
    cancellation = queryClient.cancelQueries();
  } catch {
    // Continue fail-closed: clearing retained account data takes precedence.
  }

  try {
    queryClient.clear();
  } catch {
    // Continue attempting independently owned local privacy cleanup.
  }

  const localCredentials = runCleanup(options.clearLocalCredentials);
  const privateImageCaches = runCleanup(options.clearPrivateImageCaches);

  try {
    await cancellation;
  } catch {
    // Aborted requests normally reject. They are detached from the cleared cache.
  }

  const [localCredentialOutcome, privateImageCacheOutcome] = await Promise.all([
    localCredentials,
    privateImageCaches,
  ]);
  const protectedNavigation = await runCleanup(
    options.resetProtectedNavigation,
  );

  return {
    localCredentials: localCredentialOutcome,
    privateImageCaches: privateImageCacheOutcome,
    protectedNavigation,
  };
}

/**
 * Starts local removal before waiting for server revocation. A remote failure,
 * or a reported failed credential/cache cleanup, rejects with a typed outcome
 * so the UI can state exactly what remains incomplete and offer an explicit
 * retry instead of claiming a completed local sign-out.
 */
export async function logoutAndPurgeClientSession(
  remoteLogout: () => Promise<void>,
  queryClient: QueryClient,
  options: ClientSessionPurgeOptions = {},
  credentialAdmissionOptions?: CredentialAdmissionBarrierOptions,
): Promise<ClientLogoutOutcome> {
  const localPurge = purgeClientSession(queryClient, options);
  const credentialAdmissionPersistence = runConfirmedCleanup(
    credentialAdmissionOptions?.confirmPersisted,
  );
  let remoteRevocation: ClientLogoutOutcome["remoteRevocation"] = "confirmed";
  let remoteError: unknown;
  try {
    await remoteLogout();
  } catch (error) {
    remoteRevocation = "unconfirmed";
    remoteError = error;
  }

  const purge = await localPurge;
  const persistence = await credentialAdmissionPersistence;
  const localCredentialsCleared =
    purge.localCredentials.status === "cleared" &&
    !localCredentialCleanupFailed(purge.localCredentials.result);
  const allPurgeFencesCleared =
    localCredentialsCleared &&
    purge.privateImageCaches.status === "cleared" &&
    purge.protectedNavigation.status === "cleared";
  const removal =
    persistence.status === "cleared" &&
    remoteRevocation === "confirmed" &&
    allPurgeFencesCleared
      ? await runConfirmedCleanup(
          credentialAdmissionOptions?.clearAfterConfirmedLogout,
        )
      : { status: "not_requested" as const };

  const outcome: ClientLogoutOutcome = {
    remoteRevocation,
    purge,
    credentialAdmission: {
      persistence,
      removal,
    },
  };
  const recovery = describeClientLogoutOutcome(outcome);
  if (!recovery.complete) {
    throw new ClientSessionLogoutIncompleteError(outcome, remoteError);
  }
  return outcome;
}
