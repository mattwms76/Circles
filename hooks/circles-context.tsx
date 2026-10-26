import type { QueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Platform, View } from "react-native";
import { trpc } from "@/lib/trpc";
import { C, IconButton, Logo, T } from "@/components/circles-ui";
import { EmailAuthForm } from "@/components/email-auth-form";
import { useRouter } from "expo-router";
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
import { CirclesContext as Context } from "./circles-context-core";
export { useCircles } from "./circles-context-core";

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
  const auth = trpc.auth.me.useQuery(undefined, {
    refetchInterval: 15000,
    retry: false,
  });
  const utils = trpc.useUtils();
  const [login, setLogin] = useState(false);
  const [notice, setNotice] = useState("");
  const pendingProtectedAction = useRef<(() => void) | null>(null);
  const authState = resolveAuthGateState({
    isLoading: auth.isLoading,
    isError: auth.isError,
    hasUser: !!auth.data,
  });
  const loginVisible = login && authState === "guest";
  const refetchAuth = auth.refetch;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
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
      setNotice(
        "This device could not clear incomplete sign-in. Close and reopen Circles before retrying.",
      );
    } else if (result.cleanup?.remoteRevocationFailed) {
      setNotice(
        "This device was cleared, but secure sign-out could not be confirmed. Please retry shortly.",
      );
    } else if (!result.authenticatedUser) {
      setNotice("We couldn’t confirm sign-in. Please try again.");
    }
    return result.authenticatedUser !== null;
  }, [queryClient, refetchAuth, utils]);

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
        setNotice("Checking your sign-in…");
        return false;
      }

      if (authState === "error") {
        setNotice(
          "We couldn’t confirm your sign-in. Check your connection and try again.",
        );
        return false;
      }

      setLogin(true);
      return false;
    },
    [authState],
  );
  return (
    <Context.Provider
      value={{
        user: auth.data || null,
        authLoading: auth.isLoading,
        authState,
        requireAuth,
        notify: setNotice,
        refresh,
        showLogin: () => {
          if (authState === "error") {
            setNotice(
              "We couldn’t confirm your sign-in. Check your connection and try again.",
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
      {!!notice && (
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
              backgroundColor: C.ink,
              paddingHorizontal: 20,
              paddingVertical: 13,
              borderRadius: 14,
              maxWidth: 480,
            }}
          >
            <T style={{ color: "#fff", textAlign: "center" }}>{notice}</T>
          </View>
        </View>
      )}
      <Modal
        transparent
        visible={loginVisible}
        animationType="fade"
        onRequestClose={() => setLogin(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#19201B88",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: C.paper,
              borderRadius: 26,
              padding: 28,
              width: "100%",
              maxWidth: 390,
              maxHeight: "94%",
              gap: 16,
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
              />
            )}
          </View>
        </View>
      </Modal>
    </Context.Provider>
  );
}
