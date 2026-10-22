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
