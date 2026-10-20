import { ThemedView } from "@/components/themed-view";
import {
  clearNativeOAuthFlowToken,
  getApiBaseUrl,
  getNativeOAuthFlowToken,
} from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type MobileExchangeResponse = {
  app_session_id?: string;
  user?: {
    id: number;
    openId: string;
    name: string | null;
    email: string | null;
    loginMethod: string | null;
    lastSignedIn: string;
  };
  error?: string;
};

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
          setErrorMessage(error);
          return;
        }
        if (!code || !state) {
          setStatus("error");
          setErrorMessage("Missing OAuth callback parameters");
          return;
        }

        const result = await exchangeNativeOAuthCode(code, state);
        if (!result.app_session_id) {
          throw new Error("Secure sign in did not return a session");
        }

        await Auth.setSessionToken(result.app_session_id);
        if (result.user) {
          await Auth.setUserInfo({
            id: result.user.id,
            openId: result.user.openId,
            name: result.user.name,
            email: result.user.email,
            loginMethod: result.user.loginMethod,
            lastSignedIn: new Date(result.user.lastSignedIn || Date.now()),
          });
        }

        setStatus("success");
        setTimeout(() => router.replace("/(tabs)"), 1_000);
      } catch (error) {
        setStatus("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to complete secure sign in",
        );
      }
    };

    handleCallback();
  }, [params.code, params.state, params.error, router]);

  return (
    <SafeAreaView className="flex-1" edges={["top", "bottom", "left", "right"]}>
      <ThemedView className="flex-1 items-center justify-center gap-4 p-5">
        {status === "processing" && (
          <>
            <ActivityIndicator size="large" />
            <Text className="mt-4 text-base leading-6 text-center text-foreground">
              Completing authentication...
            </Text>
          </>
        )}
        {status === "success" && (
          <>
            <Text className="text-base leading-6 text-center text-foreground">
              Authentication successful!
            </Text>
            <Text className="text-base leading-6 text-center text-foreground">
              Redirecting...
            </Text>
          </>
        )}
        {status === "error" && (
          <>
            <Text className="mb-2 text-xl font-bold leading-7 text-error">
              Authentication failed
            </Text>
            <Text className="text-base leading-6 text-center text-foreground">
              {errorMessage}
            </Text>
          </>
        )}
      </ThemedView>
    </SafeAreaView>
  );
}
