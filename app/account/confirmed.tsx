import { useEffect } from "react";
import { Platform, View } from "react-native";
import { AppShell } from "@/components/app-shell";
import { Button, C, Heading, Icon, T } from "@/components/circles-ui";
import { useCircles } from "@/hooks/circles-context";

/** Email confirmation never treats a provider fragment as a Circles session. */
export default function EmailConfirmationScreen() {
  const { showLogin, user } = useCircles();

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
      <View style={{ alignItems: "center", gap: 18, paddingVertical: 36 }}>
        <Icon name="mail-open-outline" size={40} color={C.action} />
        <Heading
          style={{ fontSize: 25, fontWeight: "700", textAlign: "center" }}
        >
          {user ? "You’re already signed in." : "Finish signing in."}
        </Heading>
        <T style={{ color: C.secondary, maxWidth: 380, textAlign: "center" }}>
          {user
            ? "You can return to your people and circles."
            : "Your email link has opened. Sign in with your email and password to continue. If the link has expired, return to account creation to request a fresh confirmation."}
        </T>
        {!user && <Button title="Sign in to Circles" onPress={showLogin} />}
      </View>
    </AppShell>
  );
}
