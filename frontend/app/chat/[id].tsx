import { useRef, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import { apiGet, apiPost } from "@/src/api/client";
import { Avatar, Body, EmptyState, Loading } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { timeAgo } from "@/src/lib/time";

type Message = {
  id: string;
  text: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  mine: boolean;
  created_at: string;
};

export default function Chat() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const toast = useToast();
  const qc = useQueryClient();
  const listRef = useRef<FlatList<Message>>(null);

  const [text, setText] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["messages", id],
    queryFn: () => apiGet<Message[]>(`/api/conversations/${id}/messages`),
    refetchInterval: 4000,
  });

  const { data: typing } = useQuery({
    queryKey: ["typing", id],
    queryFn: () => apiGet<{ names: string[] }>(`/api/conversations/${id}/typing`),
    refetchInterval: 3000,
  });

  const lastTypingSent = useRef(0);
  const onChangeText = (t: string) => {
    setText(t);
    const now = Date.now();
    if (now - lastTypingSent.current > 3000) {
      lastTypingSent.current = now;
      apiPost(`/api/conversations/${id}/typing`, {}).catch(() => {});
    }
  };

  const send = async () => {
    if (!text.trim()) return;
    const body = text.trim();
    setText("");
    try {
      await apiPost(`/api/conversations/${id}/messages`, { text: body });
      qc.invalidateQueries({ queryKey: ["messages", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch {
      toast.show("Could not send", "error");
      setText(body);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title={title || "Chat"} showBack />
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          ref={listRef}
          data={data ?? []}
          keyExtractor={(m) => m.id}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View style={[styles.bubbleRow, item.mine ? styles.mineRow : styles.theirsRow]} testID={`msg-${item.id}`}>
              {!item.mine ? <Avatar uri={item.author_avatar} name={item.author_name} size={30} /> : null}
              <View style={[styles.bubble, item.mine ? styles.mineBubble : styles.theirsBubble]}>
                {!item.mine ? (
                  <Body size={11} weight="medium" color={colors.brandPrimary} style={{ fontFamily: fonts.textMedium, marginBottom: 2 }}>
                    {item.author_name}
                  </Body>
                ) : null}
                <Body size={15} color={item.mine ? colors.onBrandTertiary : colors.onSurface}>
                  {item.text}
                </Body>
                <Body size={10} color={colors.muted} style={{ marginTop: 2, alignSelf: "flex-end" }}>
                  {timeAgo(item.created_at)}
                </Body>
              </View>
            </View>
          )}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ marginTop: spacing["3xl"] }}>
              <EmptyState icon="message-circle" title="Say hello" message="No messages yet. Start the conversation." />
            </View>
          }
        />
      )}

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        {typing && typing.names.length > 0 ? (
          <View style={styles.typingRow}>
            <Body size={12} color={colors.muted}>
              {typing.names.length === 1 ? `${typing.names[0]} is typing…` : "Several people are typing…"}
            </Body>
          </View>
        ) : null}
        <View style={styles.composer}>
          <TextInput
            testID="chat-input"
            value={text}
            onChangeText={onChangeText}
            placeholder="Message…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
          />
          <Pressable testID="chat-send" onPress={send} style={styles.sendBtn}>
            <Icon name="arrow-up" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, maxWidth: "88%" },
  mineRow: { alignSelf: "flex-end" },
  theirsRow: { alignSelf: "flex-start" },
  bubble: { borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  mineBubble: { backgroundColor: colors.brandTertiary },
  theirsBubble: { backgroundColor: colors.surfaceSecondary },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  typingRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, backgroundColor: colors.surface },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    fontFamily: fonts.textRegular,
    fontSize: 15,
    color: colors.onSurface,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
}));
