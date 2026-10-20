import { useMediaSource } from "@/components/media-image";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from "react-native";
import { Image } from "@/components/media-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import { trpc } from "@/lib/trpc";
import type { Post } from "@/shared/social";
import { useCircles } from "@/hooks/circles-context";
import {
  ago,
  Avatar,
  Button,
  C,
  Icon,
  IconButton,
  Loading,
  s,
  T,
} from "./circles-ui";

function PostVideo({ uri }: { uri: string }) {
  const source = useMediaSource(uri);
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
  });
  return (
    <VideoView
      player={player}
      style={{ width: "100%", aspectRatio: 1.38 }}
      nativeControls
      contentFit="cover"
    />
  );
}
export function PostCard({ post }: { post: Post }) {
  const router = useRouter();
  const { user, requireAuth, notify } = useCircles();
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [overrideLike, setOverrideLike] = useState<boolean | null>(null);
  const [overrideSave, setOverrideSave] = useState<boolean | null>(null);
  const liked = overrideLike ?? post.liked;
  const saved = overrideSave ?? post.saved;
  const like = trpc.social.likePost.useMutation({
    onSuccess: (result) => {
      setOverrideLike(result.liked);
      void utils.social.feed.invalidate();
    },
    onError: (e) => notify(e.message),
  });
  const save = trpc.social.savePost.useMutation({
    onSuccess: (result) => {
      setOverrideSave(result.saved);
      notify(
        result.saved
          ? "Saved to your collection."
          : "Removed from saved posts.",
      );
      void utils.social.feed.invalidate();
    },
    onError: (e) => notify(e.message),
  });
  const comments = trpc.social.comments.useQuery(
    { postId: post.id },
    { enabled: commentsOpen },
  );
  const addComment = trpc.social.comment.useMutation({
    onSuccess: () => {
      setCommentText("");
      void comments.refetch();
      void utils.social.feed.invalidate();
    },
    onError: (e) => notify(e.message),
  });
  const report = trpc.social.report.useMutation({
    onSuccess: () => {
      setMenu(false);
      notify("Report received. Thank you for looking out for your circle.");
    },
    onError: (e) => notify(e.message),
  });
  const remove = trpc.social.deletePost.useMutation({
    onSuccess: () => {
      setMenu(false);
      void utils.social.feed.invalidate();
      notify("Post removed.");
    },
    onError: (e) => notify(e.message),
  });
  return (
    <View style={[s.card, { marginBottom: 20, overflow: "hidden" }]}>
      <View style={[s.between, { padding: 15, gap: 10 }]}>
        <Pressable
          onPress={() => router.push(`/person/${post.author.id}`)}
          style={[s.row, { gap: 10, flex: 1, minHeight: 44 }]}
        >
          <Avatar uri={post.author.avatar} name={post.author.name} size={37} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={[s.row, { gap: 6 }]}>
              <T style={{ fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                {post.author.name}
              </T>
              <Icon name="checkmark-circle" color={C.green} size={12} />
              <T style={{ color: C.muted, fontSize: 12 }}>
                · {ago(post.createdAt)}
              </T>
            </View>
            <T style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>
              @{post.author.handle}
            </T>
          </View>
        </Pressable>
        <IconButton
          icon="ellipsis-horizontal"
          size={20}
          onPress={() => setMenu(true)}
          label="Post options"
        />
      </View>
      {post.circleName && (
        <Pressable
          onPress={() => router.push(`/circle/${post.circleId}`)}
          style={{
            alignSelf: "flex-start",
            marginHorizontal: 15,
            marginBottom: 13,
            paddingHorizontal: 10,
            paddingVertical: 4,
            minHeight: 44,
            borderRadius: 7,
            backgroundColor: C.sage,
            flexDirection: "row",
            gap: 5,
            alignItems: "center",
          }}
        >
          <Icon name="ellipse-outline" size={11} color={C.green} />
          <T
            style={{
              color: "#6D7D61",
              fontSize: 10,
              lineHeight: 16,
              fontWeight: "600",
            }}
          >
            {post.circleName}
          </T>
        </Pressable>
      )}
      {post.media &&
        (post.mediaType === "video" ? (
          <PostVideo uri={post.media} />
        ) : (
          <Image
            source={{ uri: post.media }}
            style={{ width: "100%", aspectRatio: 1.38 }}
            contentFit="cover"
            transition={180}
          />
        ))}
      <View
        style={{
          paddingHorizontal: 15,
          paddingTop: 10,
          paddingBottom: 15,
          gap: 9,
        }}
      >
        <View style={s.between}>
          <View style={[s.row, { gap: 15 }]}>
            <Pressable
              disabled={like.isPending}
              onPress={() =>
                requireAuth(() => like.mutate({ postId: post.id }))
              }
              style={[s.row, { gap: 5, paddingVertical: 5, minHeight: 44 }]}
            >
              <Icon
                name={liked ? "heart" : "heart-outline"}
                size={23}
                color={liked ? C.coral : C.ink}
              />
              <T style={{ fontSize: 12, fontWeight: "600" }}>
                {post.likes + (liked !== post.liked ? (liked ? 1 : -1) : 0)}
              </T>
            </Pressable>
            <Pressable
              onPress={() => setCommentsOpen(true)}
              style={[s.row, { gap: 5, paddingVertical: 5, minHeight: 44 }]}
            >
              <Icon name="chatbubble-outline" size={21} />
              <T style={{ fontSize: 12 }}>{post.comments}</T>
            </Pressable>
            <IconButton
              icon="paper-plane-outline"
              size={20}
              onPress={async () => {
                try {
                  await Share.share({
                    message: `${post.author.name} on Circles: ${post.text}${post.media ? `\n${post.media}` : ""}`,
                  });
                } catch {
                  notify("Sharing could not open.");
                }
              }}
              label="Share post"
            />
          </View>
          <IconButton
            icon={saved ? "bookmark" : "bookmark-outline"}
            color={saved ? C.coral : C.ink}
            size={20}
            onPress={() => requireAuth(() => save.mutate({ postId: post.id }))}
            label="Save post"
          />
        </View>
        <T style={{ fontSize: 14, lineHeight: 21 }}>
          <T style={{ fontSize: 14, lineHeight: 21, fontWeight: "700" }}>
            {post.author.name.split(" ")[0]}{" "}
          </T>
          {post.text}
        </T>
        {post.comments > 0 && (
          <Pressable
            onPress={() => setCommentsOpen(true)}
            style={{
              minHeight: 44,
              justifyContent: "center",
              alignSelf: "flex-start",
            }}
          >
            <T style={{ fontSize: 12, color: C.muted }}>
              View all {post.comments} comments
            </T>
          </Pressable>
        )}
      </View>
      <Modal
        visible={commentsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCommentsOpen(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "#19201B88",
              justifyContent: "flex-end",
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: "100%",
                maxWidth: 570,
                backgroundColor: C.paper,
                borderTopLeftRadius: 25,
                borderTopRightRadius: 25,
                paddingHorizontal: 20,
                paddingTop: 20,
                paddingBottom: Math.max(20, insets.bottom + 12),
                gap: 16,
                maxHeight: "85%",
              }}
            >
              <View style={s.between}>
                <T style={{ fontSize: 19, fontWeight: "700" }}>
                  The conversation
                </T>
                <IconButton
                  icon="close"
                  onPress={() => setCommentsOpen(false)}
                />
              </View>
              {comments.isLoading ? (
                <Loading />
              ) : !comments.data?.length ? (
                <T
                  style={{
                    color: C.muted,
                    paddingVertical: 30,
                    textAlign: "center",
                  }}
                >
                  Be the first to say something kind.
                </T>
              ) : (
                <ScrollView
                  showsHorizontalScrollIndicator={false}
                  style={{ flexGrow: 0, flexShrink: 1 }}
                  contentContainerStyle={{ gap: 16 }}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="interactive"
                  showsVerticalScrollIndicator={false}
                >
                  {comments.data.map((comment) => (
                    <View
                      key={comment.id}
                      style={[s.row, { alignItems: "flex-start", gap: 12 }]}
                    >
                      <Avatar
                        uri={comment.author.avatar}
                        name={comment.author.name}
                        size={30}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T style={{ fontWeight: "700", fontSize: 14 }}>
                          {comment.author.name}
                          <T style={{ fontSize: 12, color: C.muted }}>
                            {" "}
                            · {ago(comment.createdAt)}
                          </T>
                        </T>
                        <T style={{ fontSize: 14, lineHeight: 21 }}>
                          {comment.text}
                        </T>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
              <View
                style={[
                  s.row,
                  {
                    gap: 10,
                    borderTopWidth: 1,
                    borderColor: C.border,
                    paddingTop: 15,
                  },
                ]}
              >
                <TextInput
                  value={commentText}
                  onChangeText={setCommentText}
                  placeholder="Add to the conversation…"
                  placeholderTextColor={C.muted}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    backgroundColor: C.bg,
                    borderRadius: 12,
                    fontSize: 14,
                    lineHeight: 21,
                    color: C.ink,
                  }}
                />
                <IconButton
                  icon="arrow-up-circle"
                  color={C.coral}
                  size={32}
                  onPress={() =>
                    requireAuth(
                      () =>
                        commentText.trim() &&
                        addComment.mutate({
                          postId: post.id,
                          text: commentText.trim(),
                        }),
                    )
                  }
                  label="Send comment"
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={menu}
        transparent
        animationType="fade"
        onRequestClose={() => setMenu(false)}
      >
        <Pressable
          onPress={() => setMenu(false)}
          style={{
            flex: 1,
            backgroundColor: "#19201B88",
            justifyContent: "center",
            alignItems: "center",
            padding: 30,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 350,
              backgroundColor: C.paper,
              borderRadius: 20,
              padding: 22,
              gap: 12,
            }}
          >
            <T style={{ fontSize: 18, fontWeight: "700", marginBottom: 5 }}>
              Keep your circle kind.
            </T>
            <Button
              title="Report inappropriate content"
              icon="flag-outline"
              secondary
              onPress={() =>
                requireAuth(() =>
                  report.mutate({
                    postId: post.id,
                    reason: "Inappropriate or harmful content",
                  }),
                )
              }
            />
            {user?.id === post.author.id && (
              <Button
                title="Remove my post"
                icon="trash-outline"
                secondary
                onPress={() => remove.mutate({ postId: post.id })}
              />
            )}
            <Button title="Close" secondary onPress={() => setMenu(false)} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
