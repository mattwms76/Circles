import { Image, useMediaSource } from "@/components/media-image";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import { trpc } from "@/lib/trpc";
import { createSingleFlightSubmitter } from "@/lib/single-flight-submit";
import type { Post } from "@/shared/social";
import { useCircles } from "@/hooks/circles-context";
import { resolveFnd001QueryDisplayState } from "@/lib/fnd001-query-display-state";
import {
  invalidateModerationViews,
  invalidatePostFeeds,
} from "@/lib/source-query-invalidation";
import {
  ago,
  Avatar,
  Button,
  C,
  Empty,
  Icon,
  IconButton,
  Loading,
  s,
  T,
} from "./circles-ui";

function PostVideo({
  uri,
  accessibilityLabel,
}: {
  uri: string;
  accessibilityLabel: string;
}) {
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
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    />
  );
}

type ScopedInteractionOptimism = {
  scope: string;
  source: Post;
  value: boolean;
};

type ActivePostSource = {
  scope: string;
  post: Post;
};

export function PostCard({ post }: { post: Post }) {
  const router = useRouter();
  const { user, requireAuth, notify } = useCircles();
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [commentText, setCommentText] = useState("");
  const commentSubmitter = useRef(createSingleFlightSubmitter()).current;
  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);
  const [likeOptimism, setLikeOptimism] =
    useState<ScopedInteractionOptimism | null>(null);
  const [saveOptimism, setSaveOptimism] =
    useState<ScopedInteractionOptimism | null>(null);
  const sourceScope = `${user?.id ?? "guest"}:${post.id}`;
  const mediaAccessibilityLabel = `${post.mediaType === "video" ? "Video" : "Photo"} shared by ${post.author.name}`;
  const currentSourceScope = useRef<ActivePostSource | null>(null);

  // Setup/cleanup keeps late completion checks current across source changes and Strict Mode.
  useEffect(() => {
    const activeSource = { scope: sourceScope, post };
    currentSourceScope.current = activeSource;
    return () => {
      if (currentSourceScope.current === activeSource) {
        currentSourceScope.current = null;
      }
    };
  }, [post, sourceScope]);

  const isCurrentSource = useCallback(
    (operationScope: string, operationPost: Post) => {
      const activeSource = currentSourceScope.current;
      return (
        activeSource?.scope === operationScope &&
        activeSource.post === operationPost
      );
    },
    [],
  );

  // A new DTO, account, or post identity structurally displaces obsolete interaction state.
  const liked =
    likeOptimism?.source === post && likeOptimism.scope === sourceScope
      ? likeOptimism.value
      : post.liked;
  const saved =
    saveOptimism?.source === post && saveOptimism.scope === sourceScope
      ? saveOptimism.value
      : post.saved;
  const like = trpc.social.likePost.useMutation();
  const save = trpc.social.savePost.useMutation();
  const toggleLike = useCallback(() => {
    requireAuth(() => {
      const operationScope = sourceScope;
      const operationPost = post;
      const nextLiked = !liked;
      setLikeOptimism({
        scope: operationScope,
        source: operationPost,
        value: nextLiked,
      });
      like.mutate(
        { postId: post.id, liked: nextLiked },
        {
          onSuccess: (result) => {
            if (!isCurrentSource(operationScope, operationPost)) return;
            setLikeOptimism({
              scope: operationScope,
              source: operationPost,
              value: result.liked,
            });
            void invalidatePostFeeds(utils);
          },
          onError: (error) => {
            if (!isCurrentSource(operationScope, operationPost)) return;
            setLikeOptimism(null);
            notify(error.message);
          },
        },
      );
    });
  }, [
    isCurrentSource,
    like,
    liked,
    notify,
    post,
    requireAuth,
    sourceScope,
    utils,
  ]);
  const toggleSave = useCallback(() => {
    requireAuth(() => {
      const operationScope = sourceScope;
      const operationPost = post;
      const nextSaved = !saved;
      setSaveOptimism({
        scope: operationScope,
        source: operationPost,
        value: nextSaved,
      });
      save.mutate(
        { postId: post.id, saved: nextSaved },
        {
          onSuccess: (result) => {
            if (!isCurrentSource(operationScope, operationPost)) return;
            setSaveOptimism({
              scope: operationScope,
              source: operationPost,
              value: result.saved,
            });
            notify(
              result.saved
                ? "Saved to your collection."
                : "Removed from saved posts.",
            );
            void invalidatePostFeeds(utils);
          },
          onError: (error) => {
            if (!isCurrentSource(operationScope, operationPost)) return;
            setSaveOptimism(null);
            notify(error.message);
          },
        },
      );
    });
  }, [
    isCurrentSource,
    notify,
    post,
    requireAuth,
    save,
    saved,
    sourceScope,
    utils,
  ]);
  const comments = trpc.social.comments.useQuery(
    { postId: post.id },
    { enabled: commentsOpen },
  );
  const commentsDisplayState = resolveFnd001QueryDisplayState({
    isLoading: comments.isLoading,
    isError: comments.isError,
    hasContent: !!comments.data?.length,
  });
  const addComment = trpc.social.comment.useMutation();
  const submitComment = useCallback(() => {
    const text = commentText.trim();
    if (!text || commentSubmitter.isBusy) {
      return;
    }

    const operationScope = sourceScope;
    const operationPost = post;
    requireAuth(() => {
      void commentSubmitter.run(async () => {
        setIsCommentSubmitting(true);
        try {
          await addComment.mutateAsync({ postId: operationPost.id, text });
          if (!isCurrentSource(operationScope, operationPost)) return;
          setCommentText("");
          void comments.refetch();
          void invalidatePostFeeds(utils);
        } catch (error) {
          if (!isCurrentSource(operationScope, operationPost)) return;
          notify(
            error instanceof Error ? error.message : "Unable to add comment.",
          );
        } finally {
          if (isCurrentSource(operationScope, operationPost)) {
            setIsCommentSubmitting(false);
          }
        }
      });
    });
  }, [
    addComment,
    commentSubmitter,
    commentText,
    comments,
    isCurrentSource,
    notify,
    post,
    requireAuth,
    sourceScope,
    utils,
  ]);
  const report = trpc.social.report.useMutation();
  const submitReport = useCallback(() => {
    const operationScope = sourceScope;
    const operationPost = post;
    requireAuth(() => {
      report.mutate(
        {
          postId: operationPost.id,
          reason: "Inappropriate or harmful content",
        },
        {
          onSuccess: () => {
            if (!isCurrentSource(operationScope, operationPost)) return;
            setMenu(false);
            void invalidateModerationViews(utils);
            notify(
              "Report received. Thank you for looking out for your circle.",
            );
          },
          onError: (error) => {
            if (!isCurrentSource(operationScope, operationPost)) return;
            notify(error.message);
          },
        },
      );
    });
  }, [isCurrentSource, notify, post, report, requireAuth, sourceScope, utils]);
  const remove = trpc.social.deletePost.useMutation();
  const removePost = useCallback(() => {
    const operationScope = sourceScope;
    const operationPost = post;
    requireAuth(() => {
      remove.mutate(
        { postId: operationPost.id },
        {
          onSuccess: () => {
            if (!isCurrentSource(operationScope, operationPost)) return;
            setMenu(false);
            void invalidatePostFeeds(utils);
            void invalidateModerationViews(utils);
            notify("Post removed.");
          },
          onError: (error) => {
            if (!isCurrentSource(operationScope, operationPost)) return;
            notify(error.message);
          },
        },
      );
    });
  }, [isCurrentSource, notify, post, remove, requireAuth, sourceScope, utils]);
  return (
    <View style={[s.card, { marginBottom: 20, overflow: "hidden" }]}>
      <View style={[s.between, { padding: 15, gap: 10 }]}>
        <Pressable
          onPress={() => router.push(`/person/${post.author.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${post.author.name}'s profile`}
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
          accessibilityRole="button"
          accessibilityLabel={`Open ${post.circleName} circle`}
          style={{
            alignSelf: "flex-start",
            maxWidth: "90%",
            minWidth: 0,
            flexShrink: 1,
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
            numberOfLines={2}
            ellipsizeMode="tail"
            style={{
              color: C.secondary,
              flexShrink: 1,
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
          <PostVideo
            uri={post.media}
            accessibilityLabel={mediaAccessibilityLabel}
          />
        ) : (
          <Image
            source={{ uri: post.media }}
            style={{ width: "100%", aspectRatio: 1.38 }}
            contentFit="cover"
            transition={180}
            accessible
            accessibilityRole="image"
            accessibilityLabel={mediaAccessibilityLabel}
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
              onPress={toggleLike}
              accessibilityRole="button"
              accessibilityLabel={liked ? "Unlike post" : "Like post"}
              accessibilityState={{
                disabled: like.isPending,
                busy: like.isPending,
                selected: liked,
              }}
              style={[
                s.row,
                {
                  gap: 5,
                  paddingVertical: 5,
                  minWidth: 44,
                  minHeight: 44,
                  opacity: like.isPending ? 0.55 : 1,
                },
              ]}
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
              accessibilityRole="button"
              accessibilityLabel={`Open ${post.comments} comments`}
              accessibilityState={{ selected: commentsOpen }}
              style={[
                s.row,
                { gap: 5, paddingVertical: 5, minWidth: 44, minHeight: 44 },
              ]}
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
            onPress={toggleSave}
            label={saved ? "Remove saved post" : "Save post"}
            disabled={save.isPending}
            loading={save.isPending}
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
            accessibilityRole="button"
            accessibilityLabel={`Open all ${post.comments} comments`}
            style={{
              minWidth: 44,
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
              {commentsDisplayState === "loading" ? (
                <Loading />
              ) : commentsDisplayState === "error" ? (
                <Empty
                  icon="chatbubble-ellipses-outline"
                  title="We couldn’t load the comments."
                  text="Check your connection and try again."
                  action="Try again"
                  onAction={() => void comments.refetch()}
                />
              ) : commentsDisplayState === "empty" ? (
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
                  {(comments.data ?? []).map((comment) => (
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
                  editable={!isCommentSubmitting}
                  placeholder="Add to the conversation…"
                  placeholderTextColor={C.muted}
                  accessibilityLabel="Comment text"
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
                  disabled={isCommentSubmitting || !commentText.trim()}
                  loading={isCommentSubmitting}
                  onPress={submitComment}
                  label={
                    isCommentSubmitting
                      ? "Sending comment"
                      : commentText.trim()
                        ? "Send comment"
                        : "Enter a comment to send"
                  }
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
            {post.circleId !== null && (
              <Button
                title="Report inappropriate content"
                icon="flag-outline"
                secondary
                disabled={remove.isPending}
                loading={report.isPending}
                onPress={submitReport}
              />
            )}
            {user?.id === post.author.id && (
              <Button
                title="Remove my post"
                icon="trash-outline"
                secondary
                disabled={report.isPending}
                loading={remove.isPending}
                onPress={removePost}
              />
            )}
            <Button title="Close" secondary onPress={() => setMenu(false)} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
