import { useCallback } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/auth-context";
import { apiGet, apiPost } from "@/src/api/client";
import { PostCard, type Post } from "@/src/components/post-card";
import { Avatar, Button, EmptyState, Loading } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon } from "@/src/components/icon";
import { usesNativeTabs } from "@/src/navigation";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

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
