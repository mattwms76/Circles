import { Button, C, T } from "@/components/circles-ui";
import {
  clearNativeOAuthFlowToken,
  getApiBaseUrl,
  getNativeOAuthFlowToken,
} from "@/constants/oauth";
import { useCircles } from "@/hooks/circles-context";
import { cleanupFailedNativeLoginConfirmation } from "@/hooks/native-login-transition";
import * as Auth from "@/lib/_core/auth";
import * as Api from "@/lib/_core/api";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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

async function exchangeNativeOAuthCode(
  code: string,
  state: string,
): Promise<MobileExchangeResponse> {
  const flowToken = await getNativeOAuthFlowToken();
  if (!flowToken)
    throw new Error("This sign-in request has expired. Please try again.");

  try {
    const apiBaseUrl = getApiBaseUrl();
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
  } finally {
    // Server-side validation also consumes this token before exchange; clear the local copy on all paths.
    await clearNativeOAuthFlowToken();
  }
}

export default function OAuthCallback() {
  const router = useRouter();
  const { completeNativeLogin } = useCircles();
  const params = useLocalSearchParams<{
    code?: string;
    state?: string;
    error?: string;
  }>();
  const [status, setStatus] = useState<"processing" | "success" | "error">(
    "processing",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      let capturedBearer: string | null = null;
      try {
        let code: string | null = params.code ?? null;
        let state: string | null = params.state ?? null;
        let error: string | null = params.error ?? null;

        if (!code && !state && !error) {
          const initialUrl = await Linking.getInitialURL();
          if (initialUrl) {
            const callbackUrl = new URL(initialUrl);
            code = callbackUrl.searchParams.get("code");
            state = callbackUrl.searchParams.get("state");
            error = callbackUrl.searchParams.get("error");
          }
        }

        if (error) {
          setStatus("error");
          setErrorMessage(friendlyOAuthError(error));
          return;
        }
        if (!code || !state) {
          setStatus("error");
          setErrorMessage(
            "This sign-in link is missing information. Please return to Circles and try again.",
          );
          return;
        }

        const result = await exchangeNativeOAuthCode(code, state);
        if (!result.app_session_id) {
          throw new Error("Secure sign in did not return a session");
        }

        capturedBearer = result.app_session_id;
        await Auth.setSessionToken(capturedBearer);
        const authenticated = await completeNativeLogin();
        if (!authenticated) {
          throw new Error("Unable to verify the new secure session");
        }

        setStatus("success");
        setTimeout(() => router.replace("/(tabs)"), 1_000);
      } catch (error) {
        const cleanup = capturedBearer
          ? await cleanupFailedNativeLoginConfirmation({
              capturedBearer,
              clearLocalCredentials: async () => {
                await Promise.all([
                  Auth.removeSessionToken(),
                  Auth.clearUserInfo(),
                ]);
              },
              remoteLogout: Api.logout,
            })
          : null;
        setStatus("error");
        const message = friendlyOAuthError(
          error instanceof Error ? error.message : null,
        );
        if (cleanup?.localCleanupFailed) {
          setErrorMessage(
            `${message} This device could not clear the incomplete sign-in. Please close and reopen Circles before trying again.`,
          );
        } else if (cleanup?.remoteRevocationFailed) {
          setErrorMessage(
            `${message} This device was cleared, but secure sign-out could not be confirmed. Please try signing in again shortly.`,
          );
        } else {
          setErrorMessage(message);
        }
      }
    };

    handleCallback();
  }, [completeNativeLogin, params.code, params.state, params.error, router]);

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
              <T style={{ color: C.secondary, textAlign: "center" }}>
                Completing secure sign-in…
              </T>
            </>
          )}
          {status === "success" && (
            <T style={{ color: C.secondary, textAlign: "center" }}>
              Signed in. Opening your circles…
            </T>
          )}
          {status === "error" && (
            <>
              <T
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
              <T
                style={{
                  color: C.secondary,
                  textAlign: "center",
                  maxWidth: 400,
                }}
              >
                {errorMessage}
              </T>
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
