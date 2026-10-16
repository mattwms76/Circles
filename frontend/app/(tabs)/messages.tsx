import { FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";

import { apiGet } from "@/src/api/client";
import { Avatar, Body, Display, EmptyState, Loading } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon } from "@/src/components/icon";
import { usesNativeTabs } from "@/src/navigation";
import { makeStyles, spacing, useTheme } from "@/src/theme";
import { timeAgo } from "@/src/lib/time";

type Conversation = {
  id: string;
  type: "direct" | "circle";
  title: string;
  avatar: string | null;
  last_message: string;
  last_at: string | null;
  unread: number;
};

export default function Messages() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => apiGet<Conversation[]>("/api/conversations"),
  });

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Messages" large />
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          onRefresh={refetch}
          refreshing={false}
          renderItem={({ item }) => (
            <Pressable testID={`conv-${item.id}`} style={styles.row} onPress={() => router.push(`/chat/${item.id}?title=${encodeURIComponent(item.title)}`)}>
              <View style={styles.avatarWrap}>
                <Avatar uri={item.avatar} name={item.title} size={52} />
                {item.type === "circle" ? (
                  <View style={styles.circleBadge}>
                    <Icon name="users" size={11} color={colors.onBrandPrimary} />
                  </View>
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Display size={16} weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                    {item.title}
                  </Display>
                  <Body size={12} color={item.unread > 0 ? colors.brandPrimary : colors.muted}>{timeAgo(item.last_at)}</Body>
                </View>
                <View style={styles.snippetRow}>
                  <Body size={13} weight={item.unread > 0 ? "medium" : "regular"} color={item.unread > 0 ? colors.onSurface : colors.muted} numberOfLines={1} style={{ flex: 1 }}>
                    {item.last_message || "No messages yet"}
                  </Body>
                  {item.unread > 0 ? (
                    <View style={styles.unreadDot} testID={`unread-${item.id}`}>
                      <Body size={11} weight="medium" color={colors.onBrandPrimary}>
                        {item.unread}
                      </Body>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          )}
          contentContainerStyle={{ paddingBottom: bottomChrome + spacing["3xl"] }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ marginTop: spacing["3xl"] }}>
              <EmptyState
                icon="message-circle"
                title="No conversations yet"
                message="Join a circle to unlock its group chat, or message someone from their profile."
              />
            </View>
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  avatarWrap: { position: "relative" },
  circleBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 2 },
  snippetRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  unreadDot: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
}));
