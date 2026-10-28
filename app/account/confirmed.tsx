import { useEffect } from "react";
import { Platform, View } from "react-native";
import { AppShell } from "@/components/app-shell";
import {
  Button,
  C,
  Empty,
  Heading,
  Icon,
  Loading,
  T,
} from "@/components/circles-ui";
import { useCircles } from "@/hooks/circles-context";
import { resolveD28008AuthPresentation } from "../../lib/d28-008-auth-presentation";

/** Email confirmation never treats a provider fragment as a Circles session. */
export default function EmailConfirmationScreen() {
  const { authState, refresh, showLogin, user } = useCircles();
  const authPresentation = resolveD28008AuthPresentation(authState, !!user);
  const signedIn = authPresentation === "authenticated" && !!user;

  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      typeof window === "undefined" ||
      !window.location.hash
    )
      return;
    // A clean same-origin reload removes provider data from both the address and
    // router state. Never log, store or authenticate a provider fragment here.
    window.location.replace("/account/confirmed");
  }, []);

  return (
    <AppShell title="Email confirmation">
      {authPresentation === "checking" ? (
        <View style={{ alignItems: "center", gap: 18, paddingVertical: 36 }}>
          <Loading />
          <T style={{ color: C.secondary, textAlign: "center" }}>
            Checking your sign-in…
          </T>
        </View>
      ) : authPresentation === "error" ? (
        <Empty
          icon="mail-open-outline"
          title="We couldn’t confirm your sign-in."
          text="Check your connection and try again."
          action="Try again"
          onAction={() => void refresh()}
        />
      ) : (
        <View style={{ alignItems: "center", gap: 18, paddingVertical: 36 }}>
          <Icon name="mail-open-outline" size={40} color={C.action} />
          <Heading
            style={{ fontSize: 25, fontWeight: "700", textAlign: "center" }}
          >
            {signedIn ? "You’re already signed in." : "Finish signing in."}
          </Heading>
          <T style={{ color: C.secondary, maxWidth: 380, textAlign: "center" }}>
            {signedIn
              ? "You can return to your people and circles."
              : "Your email link has opened. Sign in with your email and password to continue. If the link has expired, return to account creation to request a fresh confirmation."}
          </T>
          {!signedIn && (
            <Button title="Sign in to Circles" onPress={showLogin} />
          )}
        </View>
      )}
    </AppShell>
  );
}
