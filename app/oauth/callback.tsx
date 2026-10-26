import { Button, C, T } from "@/components/circles-ui";
import { StatusMessage } from "@/components/status-message";
import * as OAuth from "@/constants/oauth";
import { useCircles } from "@/hooks/circles-context";
import { persistNativeBearerAfterEmailAuthDrain } from "@/hooks/native-login-transition";
import * as Auth from "@/lib/_core/auth";
import { cancelAndDrainEmailAuthRequests } from "@/lib/email-auth-client";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type MobileExchangeResponse = {
  app_session_id?: string;
  error?: string;
};

function friendlyOAuthError(value: string | null | undefined): string {
  const error = value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  if (error.includes("access_denied") || error.includes("access denied")) {
    return "Sign-in was cancelled. You can return to Circles and try again.";
  }
  if (
    error.includes("temporarily_unavailable") ||
    error.includes("temporarily unavailable") ||
    error.includes("server_error")
  ) {
    return "Sign-in is temporarily unavailable. Please try again shortly.";
  }
  if (
    error.includes("invalid_request") ||
    error.includes("missing oauth callback parameters") ||
    error.includes("expired")
  ) {
    return "This sign-in link is no longer valid. Please return to Circles and try again.";
  }
  if (error.includes("network") || error.includes("fetch")) {
    return "We couldn't reach secure sign-in. Check your connection and try again.";
  }
  return "We couldn't complete that sign-in. Please return to Circles and try again.";
}

function firstRouteValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function confirmationFailureMessage(
  cleanup: {
    localCleanupFailed: boolean;
    remoteRevocationFailed: boolean;
  } | null,
): string {
  const base = "We couldn't confirm the new secure session. Please try again.";
  if (cleanup?.localCleanupFailed) {
    return `${base} This device could not clear the incomplete sign-in. Please close and reopen Circles before trying again.`;
  }
  if (cleanup?.remoteRevocationFailed) {
    return `${base} This device was cleared, but secure sign-out could not be confirmed. Please try signing in again shortly.`;
  }
  return base;
}

async function exchangeNativeOAuthCode(
  code: string,
  state: string,
  flowToken: string,
): Promise<MobileExchangeResponse> {
  const apiBaseUrl = OAuth.getApiBaseUrl();
  if (!apiBaseUrl) throw new Error("OAuth API URL is unavailable");

  const url = new URL("/api/oauth/mobile", `${apiBaseUrl}/`);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Manus-OAuth-Flow": flowToken,
    },
    cache: "no-store",
  });
  const payload = (await response
    .json()
    .catch(() => ({}))) as MobileExchangeResponse;
  if (!response.ok)
    throw new Error(payload.error || "Unable to complete secure sign in");
  return payload;
}

export default function OAuthCallback() {
  const router = useRouter();
  const { completeNativeLogin, completeNativeLoginWithResult } = useCircles();
  const callbackGeneration = useRef(0);
  const params = useLocalSearchParams<{
    code?: string | string[];
    state?: string | string[];
    error?: string | string[];
  }>();
  const [status, setStatus] = useState<"processing" | "success" | "error">(
    "processing",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const generation = ++callbackGeneration.current;
    let mounted = true;
    let navigationTimer: ReturnType<typeof setTimeout> | null = null;
    const isCurrent = () =>
      mounted && callbackGeneration.current === generation;
    const setCurrentError = (message: string) => {
      if (!isCurrent()) return;
      setStatus("error");
      setErrorMessage(message);
    };

    const handleCallback = async () => {
      let pendingFlow: Awaited<
        ReturnType<typeof OAuth.getNativeOAuthPendingFlow>
      > = null;
      let completed = false;
      try {
        let code = firstRouteValue(params.code);
        let state = firstRouteValue(params.state);
        let error = firstRouteValue(params.error);

        if (!code && !state && !error) {
          const initialUrl = await Linking.getInitialURL();
          if (!isCurrent()) return;
          if (initialUrl) {
            const callbackUrl = new URL(initialUrl);
            code = callbackUrl.searchParams.get("code");
            state = callbackUrl.searchParams.get("state");
            error = callbackUrl.searchParams.get("error");
          }
        }

        if (error) {
          setCurrentError(friendlyOAuthError(error));
          return;
        }
        if (!code || !state) {
          setCurrentError(
            "This sign-in link is missing information. Please return to Circles and try again.",
          );
          return;
        }

        const flow = await OAuth.getNativeOAuthPendingFlow();
        pendingFlow = flow;
        if (!flow) {
          throw new Error(
            "This sign-in request has expired. Please try again.",
          );
        }
        if (
          !isCurrent() ||
          !(await OAuth.isNativeOAuthPendingFlowCurrent(flow))
        ) {
          return;
        }

        // exchangeNativeOAuthCode(code, state) now also binds the exact local
        // pending-flow token, so the server's state/nonce authority cannot be
        // reused by a superseded callback generation.
        const result = await exchangeNativeOAuthCode(
          code,
          state,
          flow.flowToken,
        );
        if (
          !isCurrent() ||
          !(await OAuth.isNativeOAuthPendingFlowCurrent(flow))
        ) {
          return;
        }
        if (!result.app_session_id) {
          throw new Error("Secure sign in did not return a session");
        }

        const persisted = await persistNativeBearerAfterEmailAuthDrain({
          drainEmailAuthRequests: cancelAndDrainEmailAuthRequests,
          setNativeBearer: Auth.setSessionToken,
          bearer: result.app_session_id,
          isCurrent: async () =>
            isCurrent() && (await OAuth.isNativeOAuthPendingFlowCurrent(flow)),
        });
        if (
          !persisted ||
          !isCurrent() ||
          !(await OAuth.isNativeOAuthPendingFlowCurrent(flow))
        ) {
          return;
        }

        // New providers expose structured cleanup. The boolean fallback retains
        // compatibility with callers that supply the historical context shape.
        const confirmation = completeNativeLoginWithResult
          ? await completeNativeLoginWithResult()
          : {
              // The former callback path used await completeNativeLogin().
              authenticated: await completeNativeLogin(),
              cleanup: null,
            };
        if (
          !isCurrent() ||
          !(await OAuth.isNativeOAuthPendingFlowCurrent(flow))
        ) {
          return;
        }
        if (!confirmation.authenticated) {
          setCurrentError(confirmationFailureMessage(confirmation.cleanup));
          return;
        }

        // compare-delete only this exact token and generation; do not erase F2.
        // The former unsafe await clearNativeOAuthFlowToken() is deliberately not used.
        if (!(await OAuth.clearNativeOAuthPendingFlowIfCurrent(flow))) return;
        if (!isCurrent()) return;
        completed = true;
        setStatus("success");
        navigationTimer = setTimeout(() => {
          if (!isCurrent()) return;
          router.replace(flow.continuation ?? "/(tabs)");
        }, 1_000);
      } catch (error) {
        if (!isCurrent()) return;
        setCurrentError(
          friendlyOAuthError(error instanceof Error ? error.message : null),
        );
      } finally {
        if (pendingFlow && !completed) {
          await OAuth.clearNativeOAuthPendingFlowIfCurrent(pendingFlow);
        }
      }
    };

    void handleCallback();
    return () => {
      mounted = false;
      if (navigationTimer) clearTimeout(navigationTimer);
    };
  }, [
    completeNativeLogin,
    completeNativeLoginWithResult,
    params.code,
    params.state,
    params.error,
    router,
  ]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: C.bg }}
      edges={["top", "bottom", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 400,
            alignItems: "center",
            gap: 16,
          }}
        >
          {status === "processing" && (
            <>
              <ActivityIndicator size="large" color={C.coral} />
              <StatusMessage
                message="Completing secure sign-in…"
                testID="oauth-callback-status"
                style={{ textAlign: "center" }}
              />
            </>
          )}
          {status === "success" && (
            <StatusMessage
              message="Signed in. Opening your circles…"
              tone="success"
              testID="oauth-callback-status"
              style={{ textAlign: "center" }}
            />
          )}
          {status === "error" && (
            <>
              <T
                accessibilityRole="header"
                style={{
                  color: C.action,
                  fontSize: 20,
                  lineHeight: 28,
                  fontWeight: "700",
                  textAlign: "center",
                }}
              >
                Authentication failed
              </T>
              <StatusMessage
                message={errorMessage}
                tone="error"
                testID="oauth-callback-status"
                style={{
                  textAlign: "center",
                  maxWidth: 400,
                }}
              />
              <Button
                title="Back to Circles"
                onPress={() => router.replace("/")}
                style={{ width: "100%", minHeight: 44 }}
              />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
