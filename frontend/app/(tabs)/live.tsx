import { useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { apiGet, apiPost } from "@/src/api/client";
import { Avatar, Body, Button, Display, EmptyState, Loading } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Room = {
  id: string;
  title: string;
  status: string;
  host_name: string;
  host_avatar: string | null;
  participant_count: number;
  scheduled_at: string | null;
};

export default function Live() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["rooms"],
    queryFn: () => apiGet<Room[]>("/api/rooms"),
  });

  const startRoom = async () => {
    if (!title.trim()) return toast.show("Give your room a title", "error");
    setBusy(true);
    try {
      const room = await apiPost<{ id: string }>("/api/rooms", { title: title.trim() });
      setTitle("");
      setComposing(false);
      qc.invalidateQueries({ queryKey: ["rooms"] });
      router.push(`/room/${room.id}`);
    } catch {
      toast.show("Could not start room", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Live Rooms"
        large
        right={
          <Pressable testID="start-room" onPress={() => setComposing((v) => !v)} hitSlop={8}>
            <Icon name={composing ? "x" : "plus-circle"} size={24} color={colors.brandPrimary} />
          </Pressable>
        }
      />

      {composing ? (
        <View style={styles.composer}>
          <TextInput
            testID="room-title"
            value={title}
            onChangeText={setTitle}
            placeholder="What's this room about?"
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoFocus
          />
          <Button testID="room-go-live" label="Go live" icon="radio" onPress={startRoom} loading={busy} />
        </View>
      ) : null}

      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => r.id}
          onRefresh={refetch}
          refreshing={false}
          renderItem={({ item }) => (
            <Pressable testID={`room-${item.id}`} style={styles.card} onPress={() => router.push(`/room/${item.id}`)}>
              <View style={styles.badgeRow}>
                <View style={[styles.badge, { backgroundColor: item.status === "live" ? colors.error : colors.surfaceTertiary }]}>
                  <Body size={11} weight="medium" color={item.status === "live" ? colors.onError : colors.onSurfaceTertiary} style={{ fontFamily: fonts.textMedium }}>
                    {item.status === "live" ? "● LIVE" : "SCHEDULED"}
                  </Body>
                </View>
                <View style={styles.participants}>
                  <Icon name="users" size={14} color={colors.muted} />
                  <Body size={12} color={colors.muted}>{item.participant_count}</Body>
                </View>
              </View>
              <Display size={20} weight="medium" numberOfLines={2}>
                {item.title}
              </Display>
              <View style={styles.hostRow}>
                <Avatar uri={item.host_avatar} name={item.host_name} size={28} />
                <Body size={13} color={colors.onSurfaceSecondary}>Hosted by {item.host_name}</Body>
              </View>
            </Pressable>
          )}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: bottomChrome + spacing["3xl"] }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ marginTop: spacing["2xl"] }}>
              <EmptyState
                icon="radio"
                title="No rooms live right now"
                message="Start your own room and invite your circles to join the conversation."
                action={<Button label="Start a room" icon="plus" onPress={() => setComposing(true)} />}
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
  composer: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    fontFamily: fonts.textRegular,
    fontSize: 15,
    color: colors.onSurface,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  badgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  participants: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  hostRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
}));
