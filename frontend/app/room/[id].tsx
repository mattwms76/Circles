import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";

import { apiGet, apiPost } from "@/src/api/client";
import { Avatar, Body, Display, Loading } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";
import { GiftSheet } from "@/src/components/gift-sheet";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Participant = { id: string; name: string; avatar_url: string | null; role: string; hand_raised: boolean };
type Room = {
  id: string;
  title: string;
  status: string;
  host_id: string;
  host_name: string;
  is_host: boolean;
  joined: boolean;
  participant_count: number;
  my_role: string | null;
  my_hand_raised: boolean;
  cohost_count: number;
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
  const [gifting, setGifting] = useState(false);

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

  const { data: liveConfig } = useQuery({
    queryKey: ["live-config"],
    queryFn: () => apiGet<{ enabled: boolean }>("/api/live/config"),
    staleTime: 300000,
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

  const toggleHand = async () => {
    try {
      const res = await apiPost<{ hand_raised: boolean }>(`/api/rooms/${id}/raise_hand`, {});
      qc.invalidateQueries({ queryKey: ["room", id] });
      toast.show(res.hand_raised ? "Hand raised ✋" : "Hand lowered", "info");
    } catch {
      toast.show("Could not raise hand", "error");
    }
  };

  const tapParticipant = async (p: Participant) => {
    if (!room?.is_host || p.role === "host") return;
    try {
      if (p.role === "listener") {
        await apiPost(`/api/rooms/${id}/participants/${p.id}/promote`, {});
        toast.show(`${p.name.split(" ")[0]} is now a co-host`, "success");
      } else {
        await apiPost(`/api/rooms/${id}/participants/${p.id}/demote`, {});
        toast.show(`${p.name.split(" ")[0]} moved to audience`, "info");
      }
      qc.invalidateQueries({ queryKey: ["room", id] });
    } catch (e: any) {
      toast.show(e?.message ?? "Could not update seat", "error");
    }
  };

  if (isLoading || !room) return <View style={styles.root}><Loading /></View>;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <View style={styles.liveBadge}>
          <Body size={11} weight="medium" color={colors.onError}>● LIVE</Body>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {!room.is_host ? (
            <Pressable testID="room-cheer" onPress={() => setGifting(true)} hitSlop={8}>
              <Icon name="gift" size={22} color={colors.brandPrimary} />
            </Pressable>
          ) : null}
          <Pressable testID="room-leave" onPress={leave} hitSlop={8}>
            <Icon name="x" size={24} color={colors.onSurface} />
          </Pressable>
        </View>
      </View>

      <View style={styles.stage}>
        <Display size={24} weight="semibold" style={{ textAlign: "center", marginBottom: spacing.xs }}>
          {room.title}
        </Display>
        <Body size={12} color={colors.muted} style={{ textAlign: "center", marginBottom: spacing.lg }}>
          {room.is_host ? "Tap a listener to invite them up · " : ""}{room.cohost_count}/3 co-host seats
        </Body>
        <View style={styles.voiceChip}>
          <Icon name={liveConfig?.enabled ? "volume-2" : "headphones"} size={13} color={colors.onSurfaceSecondary} />
          <Body size={11} color={colors.onSurfaceSecondary}>
            {liveConfig?.enabled ? "Live voice on" : "Voice preview — live audio activates on a native build"}
          </Body>
        </View>
        <View style={styles.speakers}>
          {room.participants.map((p) => {
            const isSpeaker = p.role === "host" || p.role === "cohost";
            return (
              <Pressable key={p.id} testID={`participant-${p.id}`} style={styles.speaker} onPress={() => tapParticipant(p)}>
                <View style={[styles.speakerRing, isSpeaker && { borderColor: colors.brandPrimary }]}>
                  <Avatar uri={p.avatar_url} name={p.name} size={60} />
                  {p.hand_raised ? (
                    <View style={styles.handBadge}>
                      <Body size={12}>✋</Body>
                    </View>
                  ) : null}
                </View>
                <Body size={12} color={colors.onSurfaceSecondary} numberOfLines={1} style={{ maxWidth: 72, textAlign: "center" }}>
                  {p.name.split(" ")[0]}
                </Body>
                {p.role === "host" ? (
                  <Body size={10} weight="medium" color={colors.brandPrimary}>HOST</Body>
                ) : p.role === "cohost" ? (
                  <Body size={10} weight="medium" color={colors.brandPrimary}>CO-HOST</Body>
                ) : null}
              </Pressable>
            );
          })}
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
              <Body size={13} weight="medium" color={colors.brandPrimary}>
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
          {room.my_role === "listener" || room.my_role === null ? (
            <Pressable
              testID="room-raise-hand"
              onPress={toggleHand}
              style={[styles.micBtn, { backgroundColor: room.my_hand_raised ? colors.brandPrimary : colors.surfaceSecondary }]}
            >
              <Body size={18}>✋</Body>
            </Pressable>
          ) : (
            <Pressable
              testID="room-mic"
              onPress={() => { setMicOn((v) => !v); toast.show(micOn ? "Mic off" : "Mic on (demo)", "info"); }}
              style={[styles.micBtn, { backgroundColor: micOn ? colors.brandPrimary : colors.surfaceSecondary }]}
            >
              <Icon name={micOn ? "mic" : "mic-off"} size={20} color={micOn ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
            </Pressable>
          )}
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

      <GiftSheet
        visible={gifting}
        onClose={() => setGifting(false)}
        recipientId={room.host_id}
        recipientName={room.host_name}
        roomId={room.id}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  liveBadge: { backgroundColor: colors.error, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  stage: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  voiceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "center",
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  speakers: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.lg },
  speaker: { alignItems: "center", gap: 4, width: 76 },
  speakerRing: { padding: 3, borderRadius: 36, borderWidth: 2, borderColor: "transparent" },
  handBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.warning,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface,
  },
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
