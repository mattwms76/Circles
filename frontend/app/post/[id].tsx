import { useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import { apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/auth-context";
import { Avatar, Body, EmptyState, Loading } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { timeAgo } from "@/src/lib/time";

type Comment = {
  id: string;
  text: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  author_is_supporter?: boolean;
  created_at: string;
};

export default function PostDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["comments", id],
    queryFn: () => apiGet<Comment[]>(`/api/posts/${id}/comments`),
  });

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    const body = text.trim();
    setText("");
    try {
      await apiPost(`/api/posts/${id}/comments`, { text: body });
      await refetch();
      qc.invalidateQueries({ queryKey: ["feed"] });
    } catch {
      toast.show("Could not send", "error");
      setText(body);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Comments" showBack />
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <View style={styles.comment} testID={`comment-${item.id}`}>
              <Avatar uri={item.author_avatar} name={item.author_name} size={36} />
              <View style={{ flex: 1 }}>
                <View style={styles.commentTop}>
                  <Body size={13} weight="medium" color={colors.onSurface} style={{ fontFamily: fonts.textMedium }}>
                    {item.author_name}
                  </Body>
                  {item.author_is_supporter ? (
                    <Icon name="star" size={12} color={colors.warning} />
                  ) : null}
                  <Body size={11} color={colors.muted}>{timeAgo(item.created_at)}</Body>
                </View>
                <Body size={14} color={colors.onSurfaceSecondary}>{item.text}</Body>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingVertical: spacing.md, paddingBottom: spacing["2xl"] }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ marginTop: spacing["2xl"] }}>
              <EmptyState icon="message-circle" title="No comments yet" message="Be the first to respond." />
            </View>
          }
        />
      )}

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={[styles.composer, { paddingBottom: spacing.md }]}>
          <Avatar uri={user?.avatar_url} name={user?.name} size={32} />
          <TextInput
            testID="comment-input"
            value={text}
            onChangeText={setText}
            placeholder="Add a comment…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
          />
          <Pressable testID="comment-send" onPress={send} disabled={sending} hitSlop={8}>
            <Icon name="send" size={22} color={text.trim() ? colors.brandPrimary : colors.muted} />
          </Pressable>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  comment: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  commentTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 2 },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    fontFamily: fonts.textRegular,
    fontSize: 15,
    color: colors.onSurface,
    minHeight: 40,
  },
}));
