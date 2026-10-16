import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/src/api/client";
import { Body, Display, EmptyState, Loading, Overline } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { formatDateTime } from "@/src/lib/time";

type Report = { id: string; target_type: string; target_id: string; reason: string; category?: string; priority?: boolean; created_at: string };

export default function Moderation() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const { data, isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: () => apiGet<Report[]>("/api/moderation/reports"),
  });

  return (
    <View style={styles.root}>
      <ScreenHeader title="Moderation" showBack />
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`report-${item.id}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Overline>{item.category ?? item.target_type} · {formatDateTime(item.created_at)}</Overline>
                {item.priority ? (
                  <View style={styles.priorityBadge}>
                    <Body size={10} weight="medium" color={colors.onError}>PRIORITY</Body>
                  </View>
                ) : null}
              </View>
              <Display size={16} weight="medium">{item.reason || item.target_type}</Display>
              <Body size={12} color={colors.muted}>Target: {item.target_type} · {item.target_id}</Body>
            </View>
          )}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"], gap: spacing.md }}
          ListEmptyComponent={
            <View style={{ marginTop: spacing["3xl"] }}>
              <EmptyState icon="shield" title="Queue is clear" message="No open reports to review." />
            </View>
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  priorityBadge: { backgroundColor: colors.error, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
}));
