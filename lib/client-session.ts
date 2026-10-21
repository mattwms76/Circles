import type { QueryClient } from "@tanstack/react-query";

export type ClientSessionPurgeOptions = {
  clearLocalCredentials?: () => Promise<void> | void;
  clearPrivateImageCaches?: () => Promise<void> | void;
  resetProtectedNavigation?: () => void;
};

async function runCleanup(
  cleanup: (() => Promise<void> | void) | undefined,
): Promise<void> {
  if (!cleanup) return;
  try {
    await cleanup();
  } catch {
    // Cache/storage cleanup is best effort, but it must not retain query data or
    // prevent the route boundary from returning to the guest entry point.
  }
}

/**
 * Removes account-derived client state before another account can render.
 *
 * QueryClient.clear() removes query and mutation caches. Cancellation is
 * requested first so an active request cannot repopulate an attached observer
 * after the cache is removed.
 */
export async function purgeClientSession(
  queryClient: QueryClient,
  options: ClientSessionPurgeOptions = {},
): Promise<void> {
  let cancellation: Promise<void> | undefined;
  try {
    cancellation = queryClient.cancelQueries();
  } catch {
    // Continue fail-closed: clearing retained account data takes precedence.
  }

  try {
    queryClient.clear();
  } catch {
    // Keep clearing local credentials and navigating even for an unexpected
    // cache implementation failure.
  }

  const localCleanup = Promise.all([
    runCleanup(options.clearLocalCredentials),
    runCleanup(options.clearPrivateImageCaches),
  ]);

  try {
    await cancellation;
  } catch {
    // Aborted requests normally reject. They are detached from the cleared cache.
  }

  await localCleanup;
  await runCleanup(options.resetProtectedNavigation);
}

/**
 * Starts local removal before waiting for server revocation. Remote failures are
 * intentionally rethrown after local cleanup so the UI never reports success
 * when the presented credential could not be revoked remotely.
 */
export async function logoutAndPurgeClientSession(
  remoteLogout: () => Promise<void>,
  queryClient: QueryClient,
  options: ClientSessionPurgeOptions = {},
): Promise<void> {
  const localPurge = purgeClientSession(queryClient, options);
  try {
    await remoteLogout();
  } finally {
    await localPurge;
  }
}
