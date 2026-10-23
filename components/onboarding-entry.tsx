import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import { Button, C, Icon, T } from "./circles-ui";

/** A small, optional entry for authenticated people who have not finished setup. */
export function OnboardingEntry() {
  const router = useRouter();
  const { user, authState } = useCircles();
  const status = trpc.onboarding.status.useQuery(undefined, {
    enabled: authState === "authenticated" && !!user,
    staleTime: 0,
  });
  const isMatchedIncomplete =
    !!user &&
    status.data?.userId === user.id &&
    status.data.step !== "complete";

  if (!isMatchedIncomplete) return null;

  return (
    <View
      style={{
        backgroundColor: C.sage,
        borderRadius: 16,
        padding: 16,
        gap: 10,
        borderWidth: 1,
        borderColor: "#D8E1D3",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="sparkles-outline" color={C.green} size={19} />
        <T style={{ fontWeight: "800", fontSize: 16 }}>
          Make Circles a little more yours
        </T>
      </View>
      <T style={{ color: C.green, fontSize: 13, lineHeight: 19 }}>
        Optional: pick private interests and explore public-circle suggestions.
        You choose whether to join anything.
      </T>
      <Button
        title="Continue optional setup"
        secondary
        onPress={() => router.push("/onboarding")}
        style={{ alignSelf: "flex-start", borderColor: "#BAC6B3" }}
      />
    </View>
  );
}
