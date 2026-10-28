import type { QueryClient } from "@tanstack/react-query";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  View,
} from "react-native";
import * as ReactNative from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { credentialAdmission } from "../lib/sec27-credential-admission";
import {
  Heading,
  Button,
  C,
  IconButton,
  Logo,
  T,
} from "@/components/circles-ui";
import { EmailAuthForm } from "@/components/email-auth-form";
import { StatusMessage } from "@/components/status-message";
import { usePathname, useRouter } from "expo-router";
import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import {
  clientLogoutOutcomeFromError,
  describeClientLogoutOutcome,
  logoutAndPurgeClientSession,
  type ClientLogoutRecovery,
} from "@/lib/client-session";
import { cancelAndDrainEmailAuthRequests } from "@/lib/email-auth-client";
import { clearPrivateImageCaches } from "@/lib/media-cache";
import {
  clearCapturedNativeCredentialsIfCurrent,
  completeNativeLoginTransition,
  confirmNativeLoginAfterEmailAuthDrain,
  logoutNativeSessionAfterEmailAuthDrain,
} from "@/hooks/native-login-transition";
import { rootFeedbackNoticeBottom } from "../lib/a26-auth-layout";
import { resolveProtectedActionRequest } from "../lib/a26-auth-protected-action";
import { resolveAuthGateState } from "@/lib/feed-ui-helpers";
import {
  actorBoundaryKey,
  actorBoundaryResetRequired,
  observedActorForAuth,
  resetActorScopedClientState,
  type ObservedActor,
} from "../lib/parity27-actor-boundary";
import type { StatusTone } from "@/lib/status-announcement";
import {
  CirclesContext as Context,
  type NativeLoginCompletionResult,
} from "./circles-context-core";
export { useCircles } from "./circles-context-core";

type GlobalNotice = {
  message: string;
  tone: StatusTone;
};

function currentWindowWidth(): number {
  // Minimal source-equivalent test mocks can omit Dimensions; Expo supplies it
  // on device and web, where it follows rotations and responsive Preview size.
  if (!("Dimensions" in ReactNative)) return 0;
  const width = ReactNative.Dimensions.get("window").width;
  return Number.isFinite(width) ? Math.max(0, width) : 0;
}

export function CirclesProvider({
  children,
  queryClient,
  resetProtectedNavigation,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
  resetProtectedNavigation: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const auth = trpc.auth.me.useQuery(undefined, {
    refetchInterval: 15000,
    retry: false,
  });
  const utils = trpc.useUtils();
  const [login, setLogin] = useState(false);
  const [notice, setNotice] = useState<GlobalNotice | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [storedLogoutRecovery, setLogoutRecovery] =
    useState<ClientLogoutRecovery | null>(null);
  const [credentialAdmissionSnapshot, setCredentialAdmissionSnapshot] =
    useState(() => credentialAdmission.getSnapshot());
  const [windowWidth, setWindowWidth] = useState(currentWindowWidth);
  useEffect(() => {
    if (!("Dimensions" in ReactNative)) return;
    const subscription = ReactNative.Dimensions.addEventListener(
      "change",
      ({ window }) => setWindowWidth(Math.max(0, window.width)),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    const unsubscribe = credentialAdmission.subscribe(() => {
      setCredentialAdmissionSnapshot(credentialAdmission.getSnapshot());
    });
    return unsubscribe;
  }, []);
  const credentialAdmissionBlocks =
    credentialAdmissionSnapshot.hydrated &&
    !credentialAdmissionSnapshot.admitted;
  const logoutRecovery = useMemo<ClientLogoutRecovery | null>(
    () =>
      storedLogoutRecovery ??
      (credentialAdmissionBlocks
        ? {
            complete: false,
            blocksAuthenticatedContinuation: true,
            message:
              "Secure sign-out recovery is still required. Retry secure sign-out before continuing.",
            remoteStatus:
              "Remote session revocation must be retried before it can be confirmed.",
            localCredentialStatus:
              "Local credential cleanup must be rechecked during secure sign-out retry.",
            privateImageCacheStatus:
              "Private image cache cleanup must be rechecked during secure sign-out retry.",
            protectedNavigationStatus:
              "Protected navigation reset must be rechecked during secure sign-out retry.",
            credentialAdmissionStatus:
              credentialAdmissionSnapshot.persistence === "failed"
                ? "The incomplete sign-out recovery marker could not be checked or persisted."
                : "An incomplete secure sign-out recovery marker was found on this device.",
          }
        : null),
    [
      storedLogoutRecovery,
      credentialAdmissionBlocks,
      credentialAdmissionSnapshot.persistence,
    ],
  );
  const resolvedAuthState = resolveAuthGateState({
    isLoading: auth.isLoading,
    isError: auth.isError,
    hasUser: !!auth.data,
  });
  const logoutBlocksAuthenticatedContinuation =
    logoutPending ||
    credentialAdmissionBlocks ||
    logoutRecovery?.blocksAuthenticatedContinuation === true;
  const authState = logoutBlocksAuthenticatedContinuation
    ? "guest"
    : resolvedAuthState;
  const visibleUser = logoutBlocksAuthenticatedContinuation
    ? null
    : (auth.data ?? null);
  const observedActor = observedActorForAuth(authState, visibleUser);
  const [admittedActor, setAdmittedActor] = useState<ObservedActor>(undefined);
  const actorResetRequired = actorBoundaryResetRequired(
    admittedActor,
    observedActor,
  );
  const actorBoundaryActor =
    observedActor === undefined ? admittedActor : observedActor;
  const loginVisible =
    login && authState === "guest" && !logoutBlocksAuthenticatedContinuation;
  const refetchAuth = auth.refetch;
  const showNotice = useCallback(
    (message: string, tone: StatusTone = "info") => {
      setNotice({ message, tone });
    },
    [],
  );
  const callbackOwnsRecovery = pathname === "/oauth/callback";
  const noticeBottom = rootFeedbackNoticeBottom({
    pathname,
    windowWidth,
    insets,
  });
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useLayoutEffect(() => {
    if (observedActor === undefined) return;
    let disposed = false;
    const admitObservedActor = () => {
      if (disposed) return;
      if (actorResetRequired) {
        setLogin(false);
        setNotice(null);
      }
      setAdmittedActor(observedActor);
    };

    if (admittedActor === undefined) {
      // Deferring admission avoids a cascading render from the effect while
      // preserving the initial auth gate's existing render behavior.
      void Promise.resolve().then(admitObservedActor);
      return () => {
        disposed = true;
      };
    }
    if (!actorResetRequired) return;

    // Do not clear auth.me: it is the confirmed authority that detected this
    // replacement. All other query/mutation state is detached before a keyed
    // descendant subtree can observe the next actor.
    void resetActorScopedClientState(queryClient);
    void clearPrivateImageCaches().catch(() => undefined);
    void Promise.resolve().then(admitObservedActor);
    return () => {
      disposed = true;
    };
  }, [actorResetRequired, admittedActor, observedActor, queryClient]);

  const refresh = useCallback(() => {
    void refetchAuth();
  }, [refetchAuth]);

  const logout = useCallback(async () => {
    // This is intentionally the first logout operation. It synchronously
    // closes headers, browser cookies, and protected-media bearer admission
    // before React pending state or email/OAuth draining can yield.
    const credentialAdmissionAttempt =
      Auth.beginIncompleteLogoutCredentialAdmission();
    setLogin(false);
    setLogoutPending(true);
    try {
      await logoutNativeSessionAfterEmailAuthDrain({
        drainEmailAuthRequests: cancelAndDrainEmailAuthRequests,
        // The helper runs only after the serialized drain and is recovery-only:
        // normal Auth.getSessionToken remains denied by the global barrier.
        getNativeBearer: Auth.getSessionTokenForIncompleteLogoutRecovery,
        logoutAndPurge: async (nativeBearer) => {
          // Api.logout receives this post-drain captured value rather than
          // rereading local storage after purge has begun. Its cookie request
          // remains the deliberate web revocation operation.
          await logoutAndPurgeClientSession(
            () => Api.logout(nativeBearer),
            queryClient,
            {
              clearLocalCredentials: Auth.clearLocalSessionCredentials,
              clearPrivateImageCaches,
              resetProtectedNavigation,
            },
            {
              confirmPersisted: credentialAdmissionAttempt.confirmPersisted,
              clearAfterConfirmedLogout: () =>
                Auth.clearCredentialAdmissionAfterConfirmedLogout(
                  credentialAdmissionAttempt,
                ),
            },
          );
          setLogoutRecovery(null);
        },
      });
    } catch (error) {
      const outcome = clientLogoutOutcomeFromError(error);
      const recovery: ClientLogoutRecovery = outcome
        ? describeClientLogoutOutcome(outcome)
        : {
            complete: false,
            blocksAuthenticatedContinuation: true,
            message:
              "Secure sign-out stopped before cleanup could be confirmed. Retry secure sign-out before continuing.",
            remoteStatus: "Remote session revocation could not be confirmed.",
            localCredentialStatus:
              "Local credential cleanup could not be confirmed.",
            privateImageCacheStatus:
              "Private image cache cleanup could not be confirmed.",
            protectedNavigationStatus:
              "Protected navigation reset could not be confirmed.",
            credentialAdmissionStatus:
              "Credential admission remains closed until secure sign-out recovery succeeds.",
          };
      setLogoutRecovery(recovery);
      showNotice(recovery.message, "error");
      throw error;
    } finally {
      setLogoutPending(false);
    }
  }, [queryClient, resetProtectedNavigation, showNotice]);

  const completeNativeLoginWithResult = useCallback(async () => {
    const result = await confirmNativeLoginAfterEmailAuthDrain({
      drainEmailAuthRequests: cancelAndDrainEmailAuthRequests,
      getNativeBearer: () =>
        Platform.OS === "web" ? Promise.resolve(null) : Auth.getSessionToken(),
      completeTransition: () =>
        completeNativeLoginTransition({
          queryClient,
          resetLoginModal: () => setLogin(false),
          // EmailAuthForm owns its exact operation's busy lifecycle; closing unmounts it.
          resetSigning: () => undefined,
          clearCachedUser: Auth.clearUserInfo,
          clearPrivateImageCaches,
          invalidateAuth: () => utils.auth.me.invalidate(),
          refetchAuth,
        }),
      clearLocalCredentials: async (capturedBearer) => {
        await clearCapturedNativeCredentialsIfCurrent({
          capturedBearer,
          getCurrentBearer: Auth.getSessionToken,
          clearLocalCredentials: async () => {
            await Promise.all([
              Auth.removeSessionToken(),
              Auth.clearUserInfo(),
            ]);
          },
        });
      },
      remoteLogout: Api.logout,
    });
    if (result.cleanup?.localCleanupFailed) {
      showNotice(
        "This device could not clear incomplete sign-in. Close and reopen Circles before retrying.",
        "error",
      );
    } else if (result.cleanup?.remoteRevocationFailed) {
      showNotice(
        "This device was cleared, but secure sign-out could not be confirmed. Please retry shortly.",
        "error",
      );
    } else if (!result.authenticatedUser) {
      showNotice("We couldn’t confirm sign-in. Please try again.", "error");
    }
    const completion: NativeLoginCompletionResult = {
      authenticated: result.authenticatedUser !== null,
      cleanup: result.cleanup,
    };
    return completion;
  }, [queryClient, refetchAuth, showNotice, utils]);

  const completeNativeLogin = useCallback(
    async () => (await completeNativeLoginWithResult()).authenticated,
    [completeNativeLoginWithResult],
  );

  const connectExistingCirclesAccount = useCallback(() => {
    router.push("/account/email");
  }, [router]);

  const requireAuth = useCallback(
    (action?: () => void) => {
      if (logoutBlocksAuthenticatedContinuation) {
        showNotice(
          logoutRecovery?.message ?? "Secure sign-out is still in progress.",
          "error",
        );
        return false;
      }
      const resolution = resolveProtectedActionRequest(authState);
      if (resolution.kind === "run") {
        action?.();
        return true;
      }
      if (resolution.kind === "checking" || resolution.kind === "authError") {
        showNotice(
          resolution.message,
          resolution.kind === "checking" ? "info" : "error",
        );
        return false;
      }
      setLogin(true);
      return false;
    },
    [
      authState,
      logoutBlocksAuthenticatedContinuation,
      logoutRecovery,
      showNotice,
    ],
  );
  return (
    <Context.Provider
      value={{
        user: visibleUser,
        authLoading: logoutBlocksAuthenticatedContinuation
          ? false
          : auth.isLoading,
        authState,
        requireAuth,
        notify: showNotice,
        refresh,
        showLogin: () => {
          if (logoutBlocksAuthenticatedContinuation) {
            showNotice(
              logoutRecovery?.message ??
                "Secure sign-out is still in progress.",
              "error",
            );
            return;
          }
          if (authState === "error") {
            showNotice(
              "We couldn’t confirm your sign-in. Check your connection and try again.",
              "error",
            );
            return;
          }
          setLogin(true);
        },
        logout,
        completeNativeLogin,
        completeNativeLoginWithResult,
      }}
    >
      {actorResetRequired ? null : (
        <React.Fragment key={actorBoundaryKey(actorBoundaryActor)}>
          {children}
        </React.Fragment>
      )}
      {!!notice && !callbackOwnsRecovery && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: noticeBottom,
            left: 24,
            right: 24,
            alignItems: "center",
            zIndex: 100,
          }}
        >
          <View
            style={{
              backgroundColor: notice.tone === "error" ? C.soft : C.paper,
              borderColor: C.border,
              borderWidth: 1,
              paddingHorizontal: 20,
              paddingVertical: 13,
              borderRadius: 14,
              maxWidth: 480,
            }}
          >
            <StatusMessage
              message={notice.message}
              tone={notice.tone}
              style={{ textAlign: "center" }}
            />
          </View>
        </View>
      )}
      {!!logoutRecovery && (
        <Modal
          accessibilityLabel="Secure sign-out recovery"
          transparent
          visible
          animationType="fade"
          onRequestClose={() => undefined}
        >
          <View
            style={{
              alignItems: "center",
              backgroundColor: "#19201B88",
              flex: 1,
              justifyContent: "center",
              paddingHorizontal: 20,
              paddingVertical: Math.max(20, insets.top + 12),
            }}
          >
            <View
              style={{
                backgroundColor: C.paper,
                borderColor: C.border,
                borderRadius: 20,
                borderWidth: 1,
                gap: 14,
                maxWidth: 440,
                padding: 20,
                width: "100%",
              }}
            >
              <Heading style={{ fontSize: 22, fontWeight: "800" }}>
                Sign-out needs your attention
              </Heading>
              <StatusMessage message={logoutRecovery.message} tone="error" />
              <View style={{ gap: 5 }}>
                <T style={{ color: C.secondary, fontSize: 13 }}>
                  {logoutRecovery.remoteStatus}
                </T>
                <T style={{ color: C.secondary, fontSize: 13 }}>
                  {logoutRecovery.localCredentialStatus}
                </T>
                <T style={{ color: C.secondary, fontSize: 13 }}>
                  {logoutRecovery.privateImageCacheStatus}
                </T>
                <T style={{ color: C.secondary, fontSize: 13 }}>
                  {logoutRecovery.protectedNavigationStatus}
                </T>
                <T style={{ color: C.secondary, fontSize: 13 }}>
                  {logoutRecovery.credentialAdmissionStatus}
                </T>
              </View>
              <Button
                title={
                  logoutPending
                    ? "Retrying secure sign-out…"
                    : "Retry secure sign-out"
                }
                loading={logoutPending}
                disabled={logoutPending}
                onPress={() => {
                  void logout().catch(() => undefined);
                }}
              />
            </View>
          </View>
        </Modal>
      )}
      <Modal
        accessibilityLabel="Sign in"
        transparent
        visible={loginVisible}
        animationType="fade"
        onRequestClose={() => setLogin(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <View style={{ backgroundColor: "#19201B88", flex: 1 }}>
            <ScrollView
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={{
                alignItems: "center",
                flexGrow: 1,
                justifyContent: "center",
                paddingHorizontal: 16,
                paddingTop: Math.max(16, insets.top + 12),
                paddingBottom: Math.max(16, insets.bottom + 12),
              }}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              style={{ flex: 1, width: "100%" }}
            >
              <View
                style={{
                  alignSelf: "center",
                  backgroundColor: C.paper,
                  borderColor: C.border,
                  borderRadius: 24,
                  borderWidth: 1,
                  gap: 16,
                  maxWidth: 440,
                  padding: 20,
                  width: "100%",
                }}
              >
                <View
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Logo size={34} />
                  <IconButton
                    icon="close"
                    onPress={() => setLogin(false)}
                    label="Close sign in"
                  />
                </View>
                {loginVisible && (
                  <EmailAuthForm
                    mode="signIn"
                    onAuthenticated={completeNativeLogin}
                    onClose={() => setLogin(false)}
                    onConnectExisting={connectExistingCirclesAccount}
                    presentation="embedded"
                  />
                )}
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Context.Provider>
  );
}
