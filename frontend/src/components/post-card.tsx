import { memo } from "react";
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { mediaUrl } from "@/src/api/client";
import { Avatar, Body, Display, Overline } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";
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
  created_at: string;
};

function PostCardComponent({
  post,
  onToggleLike,
}: {
  post: Post;
  onToggleLike: (post: Post) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <View style={styles.card} testID={`post-${post.id}`}>
      <View style={styles.header}>
        <Avatar uri={post.author_avatar} name={post.author_name} size={40} />
        <View style={{ flex: 1 }}>
          <Body size={14} weight="medium" color={colors.onSurface} style={{ fontFamily: fonts.textMedium }}>
            {post.author_name}
          </Body>
          <Pressable onPress={() => router.push(`/circle/${post.circle_id}`)}>
            <Overline>
              {post.circle_name} · {timeAgo(post.created_at)}
            </Overline>
          </Pressable>
        </View>
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
      </View>
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
}));

export const PostCard = memo(PostCardComponent);
