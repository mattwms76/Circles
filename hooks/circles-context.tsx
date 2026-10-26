import type { QueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { C, IconButton, Logo, T } from "@/components/circles-ui";
import { EmailAuthForm } from "@/components/email-auth-form";
import { StatusMessage } from "@/components/status-message";
import { usePathname, useRouter } from "expo-router";
import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { logoutAndPurgeClientSession } from "@/lib/client-session";
import { cancelAndDrainEmailAuthRequests } from "@/lib/email-auth-client";
import { clearPrivateImageCaches } from "@/lib/media-cache";
import {
  clearCapturedNativeCredentialsIfCurrent,
  completeNativeLoginTransition,
  confirmNativeLoginAfterEmailAuthDrain,
  logoutNativeSessionAfterEmailAuthDrain,
} from "@/hooks/native-login-transition";
import { resolveAuthGateState } from "@/lib/feed-ui-helpers";
import type { StatusTone } from "@/lib/status-announcement";
import { CirclesContext as Context } from "./circles-context-core";
export { useCircles } from "./circles-context-core";

type GlobalNotice = {
  message: string;
  tone: StatusTone;
};

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
  const pendingProtectedAction = useRef<(() => void) | null>(null);
  const authState = resolveAuthGateState({
    isLoading: auth.isLoading,
    isError: auth.isError,
    hasUser: !!auth.data,
  });
  const loginVisible = login && authState === "guest";
  const refetchAuth = auth.refetch;
  const showNotice = useCallback(
    (message: string, tone: StatusTone = "info") => {
      setNotice({ message, tone });
    },
    [],
  );
  const callbackOwnsRecovery = pathname === "/oauth/callback";
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (authState === "authenticated" && pendingProtectedAction.current) {
      const action = pendingProtectedAction.current;
      pendingProtectedAction.current = null;
      action();
      return;
    }

    if (authState === "guest" && pendingProtectedAction.current) {
      setLogin(true);
    }
  }, [authState]);

  const refresh = useCallback(() => {
    void refetchAuth();
  }, [refetchAuth]);

  const logout = useCallback(async () => {
    await logoutNativeSessionAfterEmailAuthDrain({
      drainEmailAuthRequests: cancelAndDrainEmailAuthRequests,
      getNativeBearer: Auth.getSessionToken,
      logoutAndPurge: async (nativeBearer) => {
        // Api.logout receives this post-drain captured value rather than reading
        // local storage after purge has begun.
        setLogin(false);
        await logoutAndPurgeClientSession(
          () => Api.logout(nativeBearer),
          queryClient,
          {
            clearLocalCredentials: async () => {
              await Promise.allSettled([
                Auth.removeSessionToken(),
                Auth.clearUserInfo(),
              ]);
            },
            clearPrivateImageCaches,
            resetProtectedNavigation,
          },
        );
      },
    });
  }, [queryClient, resetProtectedNavigation]);

  const completeNativeLogin = useCallback(async () => {
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
    return result.authenticatedUser !== null;
  }, [queryClient, refetchAuth, showNotice, utils]);

  const connectExistingCirclesAccount = useCallback(() => {
    router.push("/account/email");
  }, [router]);

  const requireAuth = useCallback(
    (action?: () => void) => {
      if (authState === "authenticated") {
        action?.();
        return true;
      }

      if (authState === "checking") {
        if (action) pendingProtectedAction.current = action;
        showNotice("Checking your sign-in…", "info");
        return false;
      }

      if (authState === "error") {
        showNotice(
          "We couldn’t confirm your sign-in. Check your connection and try again.",
          "error",
        );
        return false;
      }

      setLogin(true);
      return false;
    },
    [authState, showNotice],
  );
  return (
    <Context.Provider
      value={{
        user: auth.data || null,
        authLoading: auth.isLoading,
        authState,
        requireAuth,
        notify: showNotice,
        refresh,
        showLogin: () => {
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
      }}
    >
      {children}
      {!!notice && !callbackOwnsRecovery && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 90,
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
      <Modal
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
                <View style={{ alignSelf: "flex-end" }}>
                  <IconButton
                    icon="close"
                    onPress={() => setLogin(false)}
                    label="Close sign in"
                  />
                </View>
                <Logo size={58} />
                <T
                  style={{
                    fontSize: 29,
                    lineHeight: 35,
                    fontWeight: "800",
                    letterSpacing: -1,
                  }}
                >
                  Your people are here.
                </T>
                <T style={{ color: C.secondary }}>
                  Sign in to make a circle, share your moments, and keep the
                  conversation going.
                </T>
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
