import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/auth-context";
import { apiGet, apiPost } from "@/src/api/client";
import { PostCard, type Post } from "@/src/components/post-card";
import { Avatar, Body, Button, EmptyState, Loading } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon } from "@/src/components/icon";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { formatDateTime } from "@/src/lib/time";

type Reminder = { id: string; title: string; starts_at: string; circle_id: string; circle_name: string };

export default function HomeFeed() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["feed"],
    queryFn: () => apiGet<Post[]>("/api/feed"),
  });

  const { data: reminders } = useQuery({
    queryKey: ["reminders"],
    queryFn: () => apiGet<Reminder[]>("/api/reminders"),
    refetchInterval: 60000,
  });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const reminder = (reminders ?? []).find((r) => !dismissed.includes(r.id));

  const toggleLike = useCallback(
    async (post: Post) => {
      qc.setQueryData<Post[]>(["feed"], (old) =>
        (old ?? []).map((p) =>
          p.id === post.id
            ? { ...p, liked: !p.liked, like_count: p.like_count + (p.liked ? -1 : 1) }
            : p,
        ),
      );
      try {
        await apiPost(`/api/posts/${post.id}/like`, {});
      } catch {
        refetch();
      }
    },
    [qc, refetch],
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Circles"
        large
        right={
          <>
            <Pressable testID="home-calendar" onPress={() => router.push("/calendar")} hitSlop={8}>
              <Icon name="calendar" size={22} color={colors.onSurface} />
            </Pressable>
            <Pressable testID="home-live" onPress={() => router.push("/(tabs)/live")} hitSlop={8}>
              <Icon name="radio" size={22} color={colors.onSurface} />
            </Pressable>
            <Pressable testID="home-profile" onPress={() => router.push("/profile")} hitSlop={8}>
              <Avatar uri={user?.avatar_url} name={user?.name} size={34} />
            </Pressable>
          </>
        }
      />

      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <PostCard post={item} onToggleLike={toggleLike} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            reminder ? (
              <Pressable
                testID="reminder-banner"
                style={styles.reminder}
                onPress={() => router.push(`/circle/${reminder.circle_id}`)}
              >
                <View style={styles.reminderIcon}>
                  <Icon name="clock" size={18} color={colors.onBrandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Body size={12} weight="medium" color={colors.onBrandTertiary} style={styles.reminderLabel}>
                    STARTING SOON
                  </Body>
                  <Body size={14} weight="medium" color={colors.onSurface} numberOfLines={1}>
                    {reminder.title}
                  </Body>
                  <Body size={12} color={colors.muted}>
                    {reminder.circle_name} · {formatDateTime(reminder.starts_at)}
                  </Body>
                </View>
                <Pressable testID="reminder-dismiss" onPress={() => setDismissed((d) => [...d, reminder.id])} hitSlop={8}>
                  <Icon name="x" size={18} color={colors.muted} />
                </Pressable>
              </Pressable>
            ) : null
          }
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />
          }
          ListEmptyComponent={
            <View style={{ marginTop: spacing["3xl"] }}>
              <EmptyState
                icon="feather"
                title="Your feed is quiet"
                message="Join a few circles and posts from your communities will appear here."
                action={
                  <Button label="Discover circles" icon="compass" onPress={() => router.push("/(tabs)/explore")} />
                }
              />
            </View>
          }
        />
      )}

      <Pressable
        testID="create-post-fab"
        style={[styles.fab, { bottom: bottomChrome + spacing.lg }]}
        onPress={() => router.push("/post/create")}
      >
        <Icon name="edit-2" size={22} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  reminder: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    margin: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.brandTertiary,
  },
  reminderIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  reminderLabel: { letterSpacing: 1, fontFamily: fonts.textMedium },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
}));
