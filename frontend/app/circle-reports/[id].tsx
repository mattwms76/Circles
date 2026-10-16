import { FlatList, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import { apiGet, apiDelete, apiPost, mediaUrl } from "@/src/api/client";
import { Body, Button, EmptyState, Loading, Overline } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { useToast } from "@/src/components/toast";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { formatDateTime } from "@/src/lib/time";

type Report = {
  id: string;
  target_type: string;
  target_id: string;
  reason: string;
  created_at: string;
  post_text?: string;
  post_image?: string | null;
  post_author?: string;
  post_deleted?: boolean;
};

export default function CircleReports() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["circle-reports", id],
    queryFn: () => apiGet<Report[]>(`/api/circles/${id}/reports`),
  });

  const removePost = async (r: Report) => {
    try {
      await apiDelete(`/api/posts/${r.target_id}`);
      qc.invalidateQueries({ queryKey: ["circle-reports", id] });
      qc.invalidateQueries({ queryKey: ["circle-posts", id] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      toast.show("Post removed", "success");
    } catch {
      toast.show("Could not remove post", "error");
    }
  };

  const dismiss = async (r: Report) => {
    try {
      await apiPost(`/api/reports/${r.id}/resolve`, {});
      qc.invalidateQueries({ queryKey: ["circle-reports", id] });
      toast.show("Report dismissed", "info");
    } catch {
      toast.show("Could not dismiss", "error");
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Reports" showBack />
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`report-${item.id}`}>
              <Overline>Reported · {formatDateTime(item.created_at)}</Overline>
              <Body size={13} color={colors.error}>{item.reason}</Body>
              {item.post_deleted ? (
                <Body size={14} color={colors.muted} style={{ fontStyle: "italic" }}>This post was already removed.</Body>
              ) : (
                <View style={styles.postPreview}>
                  <Body size={12} weight="medium" color={colors.onSurfaceSecondary}>{item.post_author}</Body>
                  {item.post_text ? <Body size={14} color={colors.onSurface}>{item.post_text}</Body> : null}
                  {item.post_image ? (
                    <Image source={{ uri: mediaUrl(item.post_image) }} style={styles.img} contentFit="cover" />
                  ) : null}
                </View>
              )}
              <View style={styles.actions}>
                {!item.post_deleted ? (
                  <Button testID={`remove-reported-${item.id}`} small variant="danger" icon="trash-2" label="Remove post" onPress={() => removePost(item)} style={{ flex: 1 }} />
                ) : null}
                <Button testID={`dismiss-${item.id}`} small variant="ghost" label="Dismiss" onPress={() => dismiss(item)} style={{ flex: 1 }} />
              </View>
            </View>
          )}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"], gap: spacing.md }}
          ListEmptyComponent={
            <View style={{ marginTop: spacing["3xl"] }}>
              <EmptyState icon="shield" title="Nothing to review" message="Reported posts in this circle will show up here." />
            </View>
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  postPreview: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  img: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
}));
