import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/src/api/client";
import { Body, Display, Divider, Loading, Overline } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Transparency = {
  generated_at: string;
  totals: { reports_received: number; reports_resolved: number; actions_taken: number };
  months: { month: string; received: number; resolved: number; actions_taken: number; by_category: Record<string, number> }[];
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const idx = parseInt(m, 10) - 1;
  return idx >= 0 && idx < 12 ? `${MONTH_NAMES[idx]} ${y}` : ym;
}

export default function TransparencyScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useQuery({ queryKey: ["transparency"], queryFn: () => apiGet<Transparency>("/api/moderation/transparency") });

  return (
    <View style={styles.root}>
      <ScreenHeader title="Transparency report" showBack />
      {isLoading || !data ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"], gap: spacing.lg }} showsVerticalScrollIndicator={false}>
          <Body size={13} color={colors.muted}>
            A plain summary of content moderation on Circles. We publish this so the community can see how reports are handled.
          </Body>

          <View style={styles.totals}>
            <View style={styles.totalCard}>
              <Display size={28} weight="semibold">{data.totals.reports_received}</Display>
              <Body size={12} color={colors.muted}>Reports received</Body>
            </View>
            <View style={styles.totalCard}>
              <Display size={28} weight="semibold">{data.totals.reports_resolved}</Display>
              <Body size={12} color={colors.muted}>Reports reviewed</Body>
            </View>
            <View style={styles.totalCard}>
              <Display size={28} weight="semibold">{data.totals.actions_taken}</Display>
              <Body size={12} color={colors.muted}>Actions taken</Body>
            </View>
          </View>

          <Overline>By month</Overline>
          {data.months.length === 0 ? (
            <Body size={13} color={colors.muted}>No activity yet.</Body>
          ) : (
            data.months.map((m) => (
              <View key={m.month} style={styles.monthCard} testID={`month-${m.month}`}>
                <Body size={15} weight="medium" color={colors.onSurface}>{monthLabel(m.month)}</Body>
                <Divider />
                <View style={styles.statRow}>
                  <Body size={13} color={colors.onSurfaceSecondary}>Reports received</Body>
                  <Body size={13} weight="medium" color={colors.onSurface}>{m.received}</Body>
                </View>
                <View style={styles.statRow}>
                  <Body size={13} color={colors.onSurfaceSecondary}>Reviewed</Body>
                  <Body size={13} weight="medium" color={colors.onSurface}>{m.resolved}</Body>
                </View>
                <View style={styles.statRow}>
                  <Body size={13} color={colors.onSurfaceSecondary}>Moderator actions</Body>
                  <Body size={13} weight="medium" color={colors.onSurface}>{m.actions_taken}</Body>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  totals: { flexDirection: "row", gap: spacing.sm },
  totalCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs, alignItems: "center" },
  monthCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  statRow: { flexDirection: "row", justifyContent: "space-between" },
}));
