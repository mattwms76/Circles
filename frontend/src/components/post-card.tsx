import { memo, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { mediaUrl, apiDelete, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/auth-context";
import { useToast } from "@/src/components/toast";
import { Avatar, Body, Display, Overline } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";
import { GiftSheet } from "@/src/components/gift-sheet";
import { timeAgo } from "@/src/lib/time";

export type Post = {
  id: string;
  text: string;
  image_url: string | null;
  circle_id: string;
  circle_name: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  like_count: number;
  liked: boolean;
  comment_count: number;
  gift_count: number;
  author_is_supporter: boolean;
  created_at: string;
};

function PostCardComponent({
  post,
  onToggleLike,
  canModerate,
}: {
  post: Post;
  onToggleLike: (post: Post) => void;
  canModerate?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [gifting, setGifting] = useState(false);
  const [menu, setMenu] = useState(false);
  const isMine = user?.id === post.author_id;
  const canRemove = isMine || canModerate || user?.is_moderator;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["feed"] });
    qc.invalidateQueries({ queryKey: ["circle-posts", post.circle_id] });
  };

  const removePost = async () => {
    setMenu(false);
    try {
      await apiDelete(`/api/posts/${post.id}`);
      refresh();
      toast.show("Post removed", "success");
    } catch {
      toast.show("Could not remove post", "error");
    }
  };

  const reportPost = async () => {
    setMenu(false);
    try {
      await apiPost("/api/reports", { target_type: "post", target_id: post.id, reason: "Reported from feed" });
      toast.show("Thanks — a moderator will review this", "success");
    } catch {
      toast.show("Could not report", "error");
    }
  };

  return (
    <View style={styles.card} testID={`post-${post.id}`}>
      <View style={styles.header}>
        <Avatar uri={post.author_avatar} name={post.author_name} size={40} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Body size={14} weight="medium" color={colors.onSurface} style={{ fontFamily: fonts.textMedium }}>
              {post.author_name}
            </Body>
            {post.author_is_supporter ? (
              <View style={styles.supporterBadge} testID={`supporter-${post.id}`}>
                <Icon name="star" size={10} color={colors.onWarning} />
                <Body size={10} weight="medium" color={colors.onWarning} style={{ fontFamily: fonts.textMedium }}>Top supporter</Body>
              </View>
            ) : null}
          </View>
          <Pressable onPress={() => router.push(`/circle/${post.circle_id}`)}>
            <Overline>
              {post.circle_name} · {timeAgo(post.created_at)}
            </Overline>
          </Pressable>
        </View>
        <Pressable testID={`post-menu-${post.id}`} onPress={() => setMenu(true)} hitSlop={8} style={{ padding: spacing.xs }}>
          <Icon name="more-horizontal" size={20} color={colors.muted} />
        </Pressable>
      </View>

      {post.text ? (
        <Display size={18} weight="regular" style={styles.body}>
          {post.text}
        </Display>
      ) : null}

      {post.image_url ? (
        <Image
          source={{ uri: mediaUrl(post.image_url) }}
          style={styles.image}
          contentFit="cover"
          transition={200}
        />
      ) : null}

      <View style={styles.actions}>
        <Pressable
          testID={`like-${post.id}`}
          style={styles.action}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            onToggleLike(post);
          }}
        >
          <Icon name="heart" size={18} color={post.liked ? colors.brandPrimary : colors.muted} />
          <Body size={13} color={post.liked ? colors.brandPrimary : colors.muted}>
            {post.like_count > 0 ? post.like_count : "Like"}
          </Body>
        </Pressable>
        <Pressable
          testID={`comment-${post.id}`}
          style={styles.action}
          onPress={() => router.push(`/post/${post.id}`)}
        >
          <Icon name="message-circle" size={18} color={colors.muted} />
          <Body size={13} color={colors.muted}>
            {post.comment_count > 0 ? post.comment_count : "Comment"}
          </Body>
        </Pressable>
        {!isMine ? (
          <Pressable testID={`gift-${post.id}`} style={styles.action} onPress={() => setGifting(true)}>
            <Icon name="gift" size={18} color={post.gift_count > 0 ? colors.brandPrimary : colors.muted} />
            <Body size={13} color={post.gift_count > 0 ? colors.brandPrimary : colors.muted}>
              {post.gift_count > 0 ? post.gift_count : "Gift"}
            </Body>
          </Pressable>
        ) : null}
      </View>

      <GiftSheet
        visible={gifting}
        onClose={() => setGifting(false)}
        recipientId={post.author_id}
        recipientName={post.author_name}
        postId={post.id}
      />

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenu(false)} />
        <View style={styles.menuSheet}>
          <View style={styles.menuHandle} />
          {!isMine ? (
            <Pressable testID={`report-${post.id}`} style={styles.menuItem} onPress={reportPost}>
              <Icon name="flag" size={18} color={colors.onSurface} />
              <Body size={15} color={colors.onSurface}>Report post</Body>
            </Pressable>
          ) : null}
          {canRemove ? (
            <Pressable testID={`remove-${post.id}`} style={styles.menuItem} onPress={removePost}>
              <Icon name="trash-2" size={18} color={colors.error} />
              <Body size={15} color={colors.error}>{isMine ? "Delete post" : "Remove post"}</Body>
            </Pressable>
          ) : null}
          <Pressable style={styles.menuItem} onPress={() => setMenu(false)}>
            <Icon name="x" size={18} color={colors.muted} />
            <Body size={15} color={colors.muted}>Cancel</Body>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  body: { color: colors.onSurface },
  image: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.xl, marginTop: spacing.xs },
  action: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  menuSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing["2xl"],
  },
  menuHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.sm },
  menuItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  supporterBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
  },
}));

export const PostCard = memo(PostCardComponent);
