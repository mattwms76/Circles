import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/auth-context";
import { apiGet, apiPost, apiPut } from "@/src/api/client";
import { useToast } from "@/src/components/toast";
import { Body, Button, Display, Loading } from "@/src/components/ui";
import { CircleCard, type Circle } from "@/src/components/circle-card";
import { Icon } from "@/src/components/icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const INTERESTS = [
  "Writing", "Wellness", "Photography", "Food", "Fitness", "Craft",
  "Music", "Books", "Travel", "Art", "Design", "Nature",
];

export default function Onboarding() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, updateUser } = useAuth();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const circlesQuery = useQuery({
    queryKey: ["circles", "onboarding"],
    queryFn: () => apiGet<Circle[]>("/api/circles"),
    enabled: step === 1,
  });

  const toggleInterest = (i: string) =>
    setSelected((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  const join = async (c: Circle) => {
    try {
      await apiPost(`/api/circles/${c.id}/join`, {});
      circlesQuery.refetch();
      toast.show(`Joined ${c.name}`, "success");
    } catch {
      toast.show("Could not join", "error");
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await apiPut("/api/users/me", { interests: selected, onboarded: true });
      updateUser({ interests: selected, onboarded: true });
      router.replace("/(tabs)");
    } catch {
      toast.show("Something went wrong", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.progress}>
        <View style={[styles.dot, { backgroundColor: colors.brandPrimary }]} />
        <View style={[styles.dot, { backgroundColor: step >= 1 ? colors.brandPrimary : colors.border }]} />
      </View>

      {step === 0 ? (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Display size={30} weight="semibold">
              Hi {user?.name?.split(" ")[0] ?? "there"} 👋
            </Display>
            <Body size={15} color={colors.muted} style={{ marginBottom: spacing.xl }}>
              What are you drawn to? Pick a few interests so we can suggest circles you will love.
            </Body>
            <View style={styles.chips}>
              {INTERESTS.map((i) => {
                const on = selected.includes(i);
                return (
                  <Pressable
                    key={i}
                    testID={`interest-${i}`}
                    onPress={() => toggleInterest(i)}
                    style={[
                      styles.interest,
                      { borderColor: on ? colors.brandPrimary : colors.border, backgroundColor: on ? colors.brandTertiary : colors.surface },
                    ]}
                  >
                    {on ? <Icon name="check" size={15} color={colors.onBrandTertiary} /> : null}
                    <Body size={14} weight="medium" color={on ? colors.onBrandTertiary : colors.onSurfaceSecondary} style={{ fontFamily: fonts.textMedium }}>
                      {i}
                    </Body>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Button
              testID="onboarding-next"
              label={selected.length ? `Continue with ${selected.length}` : "Continue"}
              onPress={() => setStep(1)}
              disabled={selected.length === 0}
            />
          </View>
        </>
      ) : (
        <>
          <View style={styles.contentHeader}>
            <Display size={30} weight="semibold">
              Join your first circles
            </Display>
            <Body size={15} color={colors.muted}>
              Here are some warm communities to get you started.
            </Body>
          </View>
          {circlesQuery.isLoading ? (
            <Loading />
          ) : (
            <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
              {(circlesQuery.data ?? []).map((c) => (
                <CircleCard key={c.id} circle={c} onToggleJoin={join} />
              ))}
            </ScrollView>
          )}
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Button testID="onboarding-finish" label="Enter Circles" onPress={finish} loading={busy} icon="arrow-right" />
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  progress: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  dot: { flex: 1, height: 4, borderRadius: radius.pill },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  contentHeader: { paddingHorizontal: spacing.xl, gap: spacing.xs, marginBottom: spacing.lg },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  interest: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
}));
