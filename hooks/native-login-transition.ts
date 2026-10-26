import type { QueryClient } from "@tanstack/react-query";

type AuthRefetchResult<TUser> = {
  data: TUser | null | undefined;
};

export type NativeLoginTransitionOptions<TUser> = {
  queryClient: QueryClient;
  resetLoginModal: () => void;
  resetSigning: () => void;
  clearCachedUser: () => Promise<void>;
  clearPrivateImageCaches: () => Promise<void>;
  invalidateAuth: () => Promise<unknown>;
  refetchAuth: () => Promise<AuthRefetchResult<TUser>>;
};

export type FailedNativeConfirmationCleanupOptions = {
  capturedBearer: string;
  clearLocalCredentials: () => Promise<void>;
  remoteLogout: (capturedBearer: string) => Promise<void>;
};

export type FailedNativeConfirmationCleanupResult = {
  localCleanupFailed: boolean;
  remoteRevocationFailed: boolean;
};

export type NativeLogoutAfterEmailAuthDrainOptions = {
  drainEmailAuthRequests: () => Promise<void>;
  getNativeBearer: () => Promise<string | null>;
  logoutAndPurge: (capturedBearer: string | null) => Promise<void>;
};

export type NativeLoginConfirmationOptions<TUser> = {
  drainEmailAuthRequests: () => Promise<void>;
  getNativeBearer: () => Promise<string | null>;
  completeTransition: () => Promise<TUser | null>;
  clearLocalCredentials: (capturedBearer: string) => Promise<void>;
  remoteLogout: (capturedBearer: string) => Promise<void>;
};

export type NativeLoginConfirmationResult<TUser> = {
  authenticatedUser: TUser | null;
  cleanup: FailedNativeConfirmationCleanupResult | null;
};

export type PersistNativeBearerAfterEmailAuthDrainOptions = {
  drainEmailAuthRequests: () => Promise<void>;
  setNativeBearer: (bearer: string) => Promise<void>;
  bearer: string;
  isCurrent?: () => boolean | Promise<boolean>;
};

export type ClearCapturedNativeCredentialsOptions = {
  capturedBearer: string;
  getCurrentBearer: () => Promise<string | null>;
  clearLocalCredentials: () => Promise<void>;
};

let nativeCredentialTransitionTail: Promise<void> = Promise.resolve();

/**
 * Serializes only parent-owned native credential transitions. Email-client
 * writes remain outside this lease, so callers drain them before entering it.
 * This is process-local coordination, not a SecureStore compare-and-swap API.
 */
export async function runNativeCredentialTransition<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const prior = nativeCredentialTransitionTail;
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  nativeCredentialTransitionTail = prior.then(
    () => completion,
    () => completion,
  );

  await prior.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * Captures the bearer only after email work has stopped. The caller owns the
 * ensuing local purge and remote logout, but cannot accidentally revoke the
 * bearer that was present before an in-flight email write completed.
 */
export async function logoutNativeSessionAfterEmailAuthDrain(
  options: NativeLogoutAfterEmailAuthDrainOptions,
): Promise<void> {
  await runNativeCredentialTransition(async () => {
    await options.drainEmailAuthRequests();
    const capturedBearer = await options.getNativeBearer();
    await options.logoutAndPurge(capturedBearer);
  });
}

/**
 * Sequences the public OAuth write behind email request cancellation. This is
 * deliberately shared by the callback and deferred integration test so that a
 * completed email write cannot overwrite the newer OAuth bearer.
 */
export async function persistNativeBearerAfterEmailAuthDrain(
  options: PersistNativeBearerAfterEmailAuthDrainOptions,
): Promise<boolean> {
  return runNativeCredentialTransition(async () => {
    await options.drainEmailAuthRequests();
    if (!((await options.isCurrent?.()) ?? true)) return false;
    await options.setNativeBearer(options.bearer);
    return true;
  });
}

/**
 * Best-effort protection for a credential superseded before failed-confirmation
 * cleanup starts. SecureStore has no compare-and-delete primitive, so this is
 * not represented as an atomic compare-and-clear guarantee; it avoids deleting
 * a bearer already observed to be newer than the captured failed session.
 */
export async function clearCapturedNativeCredentialsIfCurrent(
  options: ClearCapturedNativeCredentialsOptions,
): Promise<boolean> {
  return runNativeCredentialTransition(async () => {
    if ((await options.getCurrentBearer()) !== options.capturedBearer) {
      return false;
    }
    await options.clearLocalCredentials();
    return true;
  });
}

/**
 * A bearer issued by mobile exchange has no pending state: if immediate auth.me
 * confirmation fails, remove it locally before attempting remote revocation.
 * The captured argument is deliberately never reread from SecureStore after
 * cleanup, and each failure is returned for explicit caller-visible feedback.
 */
export async function cleanupFailedNativeLoginConfirmation(
  options: FailedNativeConfirmationCleanupOptions,
): Promise<FailedNativeConfirmationCleanupResult> {
  const localCleanup = await Promise.allSettled([
    options.clearLocalCredentials(),
  ]);
  let remoteRevocationFailed = false;
  try {
    await options.remoteLogout(options.capturedBearer);
  } catch {
    remoteRevocationFailed = true;
  }

  return {
    localCleanupFailed: localCleanup.some(
      (result) => result.status === "rejected",
    ),
    remoteRevocationFailed,
  };
}

/**
 * Uses the same drain/capture protocol for a newly persisted email bearer and
 * a subsequent fresh auth.me confirmation. A guest or failed confirmation is
 * treated as failed: the exact captured bearer is locally cleared (subject to
 * the caller's newer-bearer guard) and remotely revoked.
 */
export async function confirmNativeLoginAfterEmailAuthDrain<TUser>(
  options: NativeLoginConfirmationOptions<TUser>,
): Promise<NativeLoginConfirmationResult<TUser>> {
  await options.drainEmailAuthRequests();
  const capturedBearer = await options.getNativeBearer();
  const authenticatedUser = await options
    .completeTransition()
    .catch(() => null);

  if (authenticatedUser || !capturedBearer) {
    return { authenticatedUser, cleanup: null };
  }

  const cleanup = await cleanupFailedNativeLoginConfirmation({
    capturedBearer,
    clearLocalCredentials: () => options.clearLocalCredentials(capturedBearer),
    remoteLogout: options.remoteLogout,
  });
  return { authenticatedUser: null, cleanup };
}

/**
 * Completes a native sign-in only after SecureStore has persisted its bearer.
 *
 * This is intentionally called by CirclesProvider rather than the OAuth route:
 * provider state owns both the guest auth query and the sign-in modal. Clearing
 * the client cache after cancellation keeps a late guest response from restoring
 * account data while the following auth.me request reads the newly stored bearer.
 */
export async function completeNativeLoginTransition<TUser>(
  options: NativeLoginTransitionOptions<TUser>,
): Promise<TUser | null> {
  options.resetLoginModal();
  options.resetSigning();

  await options.queryClient.cancelQueries();
  options.queryClient.clear();

  // These are display-only caches. Neither is allowed to block server identity
  // verification after a successful native OAuth exchange.
  await Promise.allSettled([
    options.clearCachedUser(),
    options.clearPrivateImageCaches(),
  ]);

  await options.invalidateAuth();
  const authenticated = await options.refetchAuth();
  return authenticated.data ?? null;
}
