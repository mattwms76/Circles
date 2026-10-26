import { View } from "react-native";
import { useRouter } from "expo-router";
import { ActivityPreferencesPanel } from "@/components/activity-preferences";
import { AppShell } from "@/components/app-shell";
import { useCircles } from "@/hooks/circles-context";
import { activityScopeKey } from "@/lib/activity-ui";
import {
  Button,
  C,
  Empty,
  IconButton,
  Loading,
  s,
  T,
} from "@/components/circles-ui";

export default function ActivityPreferencesScreen() {
  const router = useRouter();
  const { authState, refresh, showLogin, user } = useCircles();

  return (
    <AppShell>
      {authState === "checking" ? (
        <Loading />
      ) : authState === "error" || !user ? (
        authState === "guest" ? (
          <Empty
            icon="options-outline"
            title="Choose your Updates after signing in."
            text="Sign in to decide which future activity belongs in your inbox."
            action="Sign in"
            onAction={showLogin}
          />
        ) : (
          <Empty
            icon="alert-circle-outline"
            title="We couldn’t check your sign-in."
            text="Check your connection, then try again before changing update preferences."
            action="Try again"
            onAction={refresh}
          />
        )
      ) : (
        <View style={{ gap: 18 }}>
          <View style={[s.between, { gap: 12 }]}>
            <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
              <T style={s.eyebrow}>YOUR ACTIVITY</T>
              <T style={s.title}>Update preferences</T>
            </View>
            <IconButton
              icon="close"
              label="Back to Updates"
              onPress={() => router.replace("/updates")}
            />
          </View>
          <T style={{ color: C.secondary, fontSize: 14, lineHeight: 21 }}>
            Make Updates fit the way you want to keep up with your circles.
          </T>
          <ActivityPreferencesPanel
            key={activityScopeKey({ viewerId: user.id })}
            viewerId={user.id}
          />
          <Button
            title="Back to Updates"
            secondary
            onPress={() => router.replace("/updates")}
            style={{ alignSelf: "flex-start" }}
          />
        </View>
      )}
    </AppShell>
  );
}
