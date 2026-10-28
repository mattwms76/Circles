import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { AppShell } from "@/components/app-shell";
import { Button, C, T } from "@/components/circles-ui";
import { EmailAuthForm } from "@/components/email-auth-form";
import { startOAuthLogin } from "@/constants/oauth";
import { useCircles } from "@/hooks/circles-context";
import {
  completeCurrentAuthOperation,
  type CurrentAuthOperation,
} from "../../lib/a26-auth-operation";

export default function AccountEmailScreen() {
  const router = useRouter();
  const { authState, completeNativeLogin, refresh, user } = useCircles();
  const [startingExistingProof, setStartingExistingProof] = useState(false);
  const [existingProofError, setExistingProofError] = useState<string | null>(
    null,
  );

  const returnToProfile = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // The actual tab route is /profile, rather than its filesystem group path.
    router.replace("/profile");
  }, [router]);

  const confirmConnection = useCallback(
    async (operation: CurrentAuthOperation) =>
      completeCurrentAuthOperation(
        operation,
        completeNativeLogin,
        returnToProfile,
      ),
    [completeNativeLogin, returnToProfile],
  );

  const verifyExistingCirclesAccount = useCallback(async () => {
    if (startingExistingProof) return;
    setStartingExistingProof(true);
    setExistingProofError(null);
    try {
      // This retained legacy OAuth entry proves whichever Circles account the
      // old provider returns for migration enrollment. It is not advertised as
      // ordinary primary sign-in; any newly seen legacy identity still follows
      // the existing provider registration policy.
      await startOAuthLogin({ continuation: "/account/email" });
    } catch {
      setExistingProofError(
        "We couldn't open secure verification. Please try again.",
      );
    } finally {
      setStartingExistingProof(false);
    }
  }, [startingExistingProof]);

  if (authState === "checking") {
    return (
      <AppShell scroll={false} sidebar={false}>
        <ScrollView
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1, width: "100%" }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            accessibilityLiveRegion="polite"
            style={{ alignItems: "center", gap: 12 }}
          >
            <ActivityIndicator color={C.coral} />
            <T style={{ color: C.muted }}>Checking your Circles sign-in…</T>
          </View>
        </ScrollView>
      </AppShell>
    );
  }

  if (authState === "error") {
    return (
      <AppShell scroll={false} sidebar={false}>
        <ScrollView
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1, width: "100%" }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View style={{ alignItems: "center", gap: 14 }}>
            <T
              accessibilityRole="header"
              style={{ fontSize: 23, fontWeight: "800", textAlign: "center" }}
            >
              We couldn’t confirm your sign-in
            </T>
            <T style={{ color: C.secondary, textAlign: "center" }}>
              Check your connection, then try again before adding an email
              sign-in method.
            </T>
            <Button title="Try again" onPress={refresh} />
            <Button
              title="Back to profile"
              secondary
              onPress={returnToProfile}
            />
          </View>
        </ScrollView>
      </AppShell>
    );
  }

  if (authState !== "authenticated" || !user) {
    return (
      <AppShell scroll={false} sidebar={false}>
        <ScrollView
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1, width: "100%" }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View style={{ alignItems: "center", gap: 14 }}>
            <T
              accessibilityRole="header"
              style={{ fontSize: 23, fontWeight: "800", textAlign: "center" }}
            >
              Sign in required
            </T>
            <T style={{ color: C.secondary, textAlign: "center" }}>
              Verify your existing Circles account before adding an email
              sign-in method.
            </T>
            {existingProofError && (
              <T accessibilityRole="alert" style={{ color: C.secondary }}>
                {existingProofError}
              </T>
            )}
            <Button
              title="Verify existing Circles account"
              accessibilityLabel="Verify existing Circles account"
              disabled={startingExistingProof}
              loading={startingExistingProof}
              onPress={() => void verifyExistingCirclesAccount()}
            />
            <Button
              title="Back to profile"
              secondary
              onPress={returnToProfile}
            />
          </View>
        </ScrollView>
      </AppShell>
    );
  }

  return (
    <AppShell scroll={false} sidebar={false}>
      <EmailAuthForm
        key={`connect:${user.id}`}
        mode="connect"
        onAuthenticated={confirmConnection}
        onClose={returnToProfile}
      />
    </AppShell>
  );
}
