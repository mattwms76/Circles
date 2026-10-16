import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";

import { apiGet, apiPost } from "@/src/api/client";
import { Avatar, Body, Display, Loading } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Participant = { id: string; name: string; avatar_url: string | null; role: string };
type Room = {
  id: string;
  title: string;
  status: string;
  host_name: string;
  is_host: boolean;
  joined: boolean;
  participant_count: number;
  participants: Participant[];
};
type RoomMsg = { id: string; text: string; author_name: string; author_avatar: string | null; mine: boolean };

export default function RoomScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const listRef = useRef<FlatList<RoomMsg>>(null);

  const [text, setText] = useState("");
  const [micOn, setMicOn] = useState(false);

  const { data: room, isLoading } = useQuery({
    queryKey: ["room", id],
    queryFn: () => apiGet<Room>(`/api/rooms/${id}`),
    refetchInterval: 5000,
  });

  const { data: messages } = useQuery({
    queryKey: ["room-messages", id],
    queryFn: () => apiGet<RoomMsg[]>(`/api/rooms/${id}/messages`),
    refetchInterval: 3500,
  });

  useEffect(() => {
    apiPost(`/api/rooms/${id}/join`, {})
      .then(() => qc.invalidateQueries({ queryKey: ["room", id] }))
      .catch(() => {});
  }, [id, qc]);

  const leave = async () => {
    try {
      await apiPost(`/api/rooms/${id}/leave`, {});
    } catch {
      /* ignore */
    }
    qc.invalidateQueries({ queryKey: ["rooms"] });
    router.back();
  };

  const send = async () => {
    if (!text.trim()) return;
    const body = text.trim();
    setText("");
    try {
      await apiPost(`/api/rooms/${id}/messages`, { text: body });
      qc.invalidateQueries({ queryKey: ["room-messages", id] });
    } catch {
      toast.show("Could not send", "error");
      setText(body);
    }
  };

  if (isLoading || !room) return <View style={styles.root}><Loading /></View>;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <View style={styles.liveBadge}>
          <Body size={11} weight="medium" color={colors.onError} style={{ fontFamily: fonts.textMedium }}>● LIVE</Body>
        </View>
        <Pressable testID="room-leave" onPress={leave} hitSlop={8}>
          <Icon name="x" size={24} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.stage}>
        <Display size={24} weight="semibold" style={{ textAlign: "center", marginBottom: spacing.lg }}>
          {room.title}
        </Display>
        <View style={styles.speakers}>
          {room.participants.map((p) => (
            <View key={p.id} style={styles.speaker}>
              <View style={[styles.speakerRing, p.role === "host" && { borderColor: colors.brandPrimary }]}>
                <Avatar uri={p.avatar_url} name={p.name} size={60} />
              </View>
              <Body size={12} color={colors.onSurfaceSecondary} numberOfLines={1} style={{ maxWidth: 72, textAlign: "center" }}>
                {p.name.split(" ")[0]}
              </Body>
              {p.role === "host" ? (
                <Body size={10} weight="medium" color={colors.brandPrimary} style={{ fontFamily: fonts.textMedium }}>HOST</Body>
              ) : null}
            </View>
          ))}
        </View>
      </View>

      <View style={styles.chatArea}>
        <Body size={12} weight="medium" color={colors.muted} style={styles.chatHeading}>
          LIVE CHAT
        </Body>
        <FlatList
          ref={listRef}
          data={messages ?? []}
          keyExtractor={(m) => m.id}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View style={styles.msgRow} testID={`room-msg-${item.id}`}>
              <Body size={13} weight="medium" color={colors.brandPrimary} style={{ fontFamily: fonts.textMedium }}>
                {item.author_name.split(" ")[0]}
              </Body>
              <Body size={14} color={colors.onSurface} style={{ flex: 1 }}>{item.text}</Body>
            </View>
          )}
          contentContainerStyle={{ paddingVertical: spacing.sm, gap: spacing.sm }}
          showsVerticalScrollIndicator={false}
        />
      </View>

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={[styles.actionBar, { paddingBottom: spacing.md }]}>
          <Pressable
            testID="room-mic"
            onPress={() => { setMicOn((v) => !v); toast.show(micOn ? "Mic off" : "Mic on (demo)", "info"); }}
            style={[styles.micBtn, { backgroundColor: micOn ? colors.brandPrimary : colors.surfaceSecondary }]}
          >
            <Icon name={micOn ? "mic" : "mic-off"} size={20} color={micOn ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
          </Pressable>
          <TextInput
            testID="room-chat-input"
            value={text}
            onChangeText={setText}
            placeholder="Say something…"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Pressable testID="room-chat-send" onPress={send} style={styles.sendBtn}>
            <Icon name="arrow-up" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  liveBadge: { backgroundColor: colors.error, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  stage: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  speakers: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.lg },
  speaker: { alignItems: "center", gap: 4, width: 76 },
  speakerRing: { padding: 3, borderRadius: 36, borderWidth: 2, borderColor: "transparent" },
  chatArea: { flex: 1, paddingHorizontal: spacing.lg },
  chatHeading: { letterSpacing: 1.2, fontFamily: fonts.textMedium, marginTop: spacing.md },
  msgRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  micBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.textRegular,
    fontSize: 15,
    color: colors.onSurface,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
}));
