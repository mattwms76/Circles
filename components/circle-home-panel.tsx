import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { trpc } from "@/lib/trpc";
import { createSingleFlightSubmitter } from "@/lib/single-flight-submit";
import {
  boundCircleHomeRulesText,
  CIRCLE_HOME_RULE_MAX,
  CIRCLE_HOME_RULES_MAX,
  CIRCLE_HOME_RULES_TEXT_MAX,
  CIRCLE_HOME_WELCOME_MAX,
  circleHomeRulesToText,
  getCircleHomeRuleMetrics,
  getReadableCircleHomeError,
  isCurrentCircleHomeScope,
  serializeCircleHomeDraft,
  validateCircleHomeDraft,
} from "@/lib/circle-home-ui";
import {
  boundCircleHomeText,
  circleHomeTextLength,
  type CircleHome,
} from "@/shared/circle-home";
import type { Post } from "@/shared/social";
import { PostCard } from "@/components/post-card";
import {
  Heading,
  Button,
  C,
  Empty,
  Icon,
  Loading,
  s,
  T,
} from "@/components/circles-ui";
import { StatusMessage } from "@/components/status-message";

type CircleHomePanelProps = {
  canRead: boolean;
  home?: CircleHome;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  showSetupHints?: boolean;
  onOpenFeed?: () => void;
};

/** The read-only Home tab. Its caller passes only response data bound to the active account. */
export function CircleHomePanel({
  canRead,
  home,
  isLoading,
  isError,
  onRetry,
  showSetupHints = false,
  onOpenFeed,
}: CircleHomePanelProps) {
  if (!canRead) {
    return (
      <Empty
        headingLevel={2}
        icon="lock-closed-outline"
        title="A little space, just for members."
        text="Join this circle to see its welcome, guidelines, and pinned moment."
      />
    );
  }

  // An errored fresh read must never fall through to cached Home content.
  if (isError) {
    return (
      <Empty
        headingLevel={2}
        icon="home-outline"
        title="We couldn’t load this circle’s Home."
        text="Check your connection and try again."
        action="Try again"
        onAction={onRetry}
      />
    );
  }

  if (!home && isLoading) return <Loading />;

  if (!home) {
    return (
      <Empty
        headingLevel={2}
        icon="home-outline"
        title="Home is getting ready."
        text="The circle’s welcome and guidelines will appear here when they’re available."
      />
    );
  }

  if (
    !showSetupHints &&
    !home.welcomeMessage &&
    !home.rules.length &&
    !home.pinnedPost
  ) {
    return (
      <Empty
        headingLevel={2}
        icon="people-outline"
        title="Get to know this circle."
        text="Explore shared moments and meet the people who make this circle."
        action={onOpenFeed ? "Explore moments" : undefined}
        onAction={onOpenFeed}
      />
    );
  }

  return (
    <View style={{ gap: 16 }}>
      {(home.welcomeMessage || showSetupHints) && (
        <View style={[s.card, { padding: 20, gap: 10 }]}>
          <Heading level={2} style={s.eyebrow}>
            A NOTE FROM YOUR CIRCLE
          </Heading>
          {home.welcomeMessage ? (
            <T style={{ color: C.muted, fontSize: 15, lineHeight: 23 }}>
              {home.welcomeMessage}
            </T>
          ) : (
            <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
              No welcome message has been set yet.
            </T>
          )}
        </View>
      )}

      {(home.rules.length > 0 || showSetupHints) && (
        <View style={[s.card, { padding: 20, gap: 13 }]}>
          <Heading level={2} style={s.eyebrow}>
            CIRCLE GUIDELINES
          </Heading>
          {home.rules.length ? (
            home.rules.map((rule, index) => (
              <View
                key={`${index}:${rule}`}
                style={[s.row, { alignItems: "flex-start", gap: 9 }]}
              >
                <Icon
                  name="checkmark-circle-outline"
                  size={18}
                  color={C.green}
                />
                <T
                  style={{
                    flex: 1,
                    color: C.muted,
                    fontSize: 14,
                    lineHeight: 21,
                  }}
                >
                  {rule}
                </T>
              </View>
            ))
          ) : (
            <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
              This circle hasn’t configured any circle guidelines yet.
            </T>
          )}
        </View>
      )}

      {(home.pinnedPost || showSetupHints) && (
        <View style={{ gap: 8 }}>
          <View style={[s.row, { gap: 7, paddingHorizontal: 2 }]}>
            <Icon name="pin-outline" color={C.coral} size={17} />
            <Heading level={2} style={s.eyebrow}>
              PINNED MOMENT
            </Heading>
          </View>
          {home.pinnedPost ? (
            <PostCard post={home.pinnedPost} />
          ) : (
            <View style={[s.card, { padding: 20 }]}>
              <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
                No moment is pinned right now.
              </T>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

type CircleHomeEditorProps = {
  scopeKey: string;
  circleId: number;
  /** Undefined only while an already-open editor waits for a trusted response. */
  home?: CircleHome;
  /** Server-confirmed edit authority for the active, fully fresh account scope. */
  canEdit: boolean;
  isAuthorityAvailable: boolean;
  feedItems: Post[];
  hasNextFeedPage: boolean;
  isFetchingNextFeedPage: boolean;
  onLoadMoreFeedItems: () => void;
  onClose: () => void;
};

/**
 * The editor is intentionally mounted only after an explicit Edit Home press and keyed by
 * account/route scope. Initial values therefore never overwrite an active draft on refetch.
 */
export function CircleHomeEditor({
  scopeKey,
  circleId,
  home,
  canEdit,
  isAuthorityAvailable,
  feedItems,
  hasNextFeedPage,
  isFetchingNextFeedPage,
  onLoadMoreFeedItems,
  onClose,
}: CircleHomeEditorProps) {
  const utils = trpc.useUtils();
  const [welcomeMessage, setWelcomeMessage] = useState(
    () => home?.welcomeMessage ?? "",
  );
  const [rulesText, setRulesText] = useState(() =>
    circleHomeRulesToText(home?.rules ?? []),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [isTextSubmitting, setIsTextSubmitting] = useState(false);
  const [isPinSubmitting, setIsPinSubmitting] = useState(false);
  const [desiredPostId, setDesiredPostId] = useState<number | null | undefined>(
    undefined,
  );
  const mounted = useRef(false);
  const mountedScope = useRef(scopeKey);
  const [textSubmitter] = useState(() => createSingleFlightSubmitter());
  const [pinSubmitter] = useState(() => createSingleFlightSubmitter());
  const update = trpc.circleHome.update.useMutation();
  const pin = trpc.circleHome.pin.useMutation();

  useEffect(() => {
    // Setup must set true because React Strict Mode replays setup/cleanup in development.
    mounted.current = true;
    mountedScope.current = scopeKey;
    return () => {
      mounted.current = false;
    };
  }, [scopeKey]);

  const isMountedForScope = useCallback(
    () =>
      mounted.current &&
      isCurrentCircleHomeScope(mountedScope.current, scopeKey),
    [scopeKey],
  );

  const draft = { welcomeMessage, rulesText };
  const validationError = validateCircleHomeDraft(draft);
  const editorError = validationError ?? saveError;
  const ruleMetrics = getCircleHomeRuleMetrics(rulesText);
  const isSavingText = update.isPending || isTextSubmitting;
  const isSavingPin = pin.isPending || isPinSubmitting;

  const refreshCircleHome = useCallback(() => {
    void utils.circleHome.get.invalidate({ circleId });
    void utils.social.feedPage.invalidate({
      filter: "for-you",
      circleId,
      limit: 20,
    });
  }, [circleId, utils]);

  const saveText = useCallback(() => {
    const error = validateCircleHomeDraft({ welcomeMessage, rulesText });
    if (error || !canEdit || !home) {
      setSaveError(
        error ?? "Home editing is unavailable while permissions are refreshed.",
      );
      return;
    }

    void textSubmitter.run(async () => {
      setIsTextSubmitting(true);
      setSaveError(null);
      setSaveMessage(null);
      try {
        await update.mutateAsync({
          circleId,
          viewerScope: home.viewerId,
          ...serializeCircleHomeDraft({ welcomeMessage, rulesText }),
        });
      } catch (caught) {
        if (isMountedForScope())
          setSaveError(getReadableCircleHomeError(caught));
        return;
      } finally {
        if (isMountedForScope()) setIsTextSubmitting(false);
      }

      if (!isMountedForScope()) return;
      setSaveMessage("Home details saved.");
      refreshCircleHome();
    });
  }, [
    canEdit,
    circleId,
    home,
    isMountedForScope,
    refreshCircleHome,
    rulesText,
    textSubmitter,
    update,
    welcomeMessage,
  ]);

  const changePinnedPost = useCallback(
    (postId: number | null) => {
      if (!canEdit || !home) {
        setPinError(
          "Pinned-post changes are unavailable while permissions are refreshed.",
        );
        return;
      }

      void pinSubmitter.run(async () => {
        let didPinChange = false;
        setIsPinSubmitting(true);
        setDesiredPostId(postId);
        setPinError(null);
        try {
          await pin.mutateAsync({
            circleId,
            viewerScope: home.viewerId,
            postId,
          });
          didPinChange = true;
        } catch (caught) {
          if (isMountedForScope())
            setPinError(getReadableCircleHomeError(caught));
          return;
        } finally {
          if (isMountedForScope()) {
            setIsPinSubmitting(false);
            if (didPinChange) setDesiredPostId(undefined);
          }
        }

        if (isMountedForScope()) refreshCircleHome();
      });
    },
    [
      canEdit,
      circleId,
      home,
      isMountedForScope,
      pin,
      pinSubmitter,
      refreshCircleHome,
    ],
  );

  const uniqueFeedItems = useMemo(
    () =>
      feedItems.filter(
        (post, index, items) =>
          post.id !== home?.pinnedPost?.id &&
          items.findIndex((item) => item.id === post.id) === index,
      ),
    [feedItems, home?.pinnedPost?.id],
  );
  const pinActionTitle = home?.pinnedPost
    ? "Replace pinned post"
    : "Pin this post";

  // A fresh, explicit server refusal is final; the parent’s render gate unmounts this editor.
  if (isAuthorityAvailable && home && !home.canManage) return null;

  return (
    <View style={[s.card, { padding: 16, gap: 17 }]}>
      <View style={{ gap: 5 }}>
        <T style={{ fontSize: 18, fontWeight: "700" }}>Edit Circle Home</T>
        <T style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>
          These details appear to people who can view this circle’s Home.
        </T>
      </View>

      <View style={{ gap: 7 }}>
        <View style={s.between}>
          <T style={{ fontSize: 12, fontWeight: "700", color: C.muted }}>
            WELCOME MESSAGE
          </T>
          <T style={{ fontSize: 12, color: C.muted }}>
            {circleHomeTextLength(welcomeMessage)}/
            {CIRCLE_HOME_WELCOME_MAX.toLocaleString()}
          </T>
        </View>
        <TextInput
          accessibilityLabel="Welcome message"
          editable={canEdit && !isSavingText}
          multiline
          maxLength={CIRCLE_HOME_WELCOME_MAX * 2}
          onChangeText={(value) => {
            setWelcomeMessage(
              boundCircleHomeText(value, CIRCLE_HOME_WELCOME_MAX),
            );
            setSaveError(null);
            setSaveMessage(null);
          }}
          placeholder="Write a welcome for your circle…"
          placeholderTextColor={C.secondary}
          textAlignVertical="top"
          value={welcomeMessage}
          style={editorStyles.input}
        />
      </View>

      <View style={{ gap: 7 }}>
        <View style={[s.between, { gap: 8 }]}>
          <T style={{ fontSize: 12, fontWeight: "700", color: C.muted }}>
            RULES — ONE PER LINE
          </T>
          <T style={{ fontSize: 12, color: C.muted, textAlign: "right" }}>
            {ruleMetrics.ruleCount}/{CIRCLE_HOME_RULES_MAX} rules ·{" "}
            {ruleMetrics.longestRuleLength}/{CIRCLE_HOME_RULE_MAX}
          </T>
        </View>
        <TextInput
          accessibilityLabel="Circle rules, one per line"
          editable={canEdit && !isSavingText}
          multiline
          maxLength={CIRCLE_HOME_RULES_TEXT_MAX * 2}
          onChangeText={(value) => {
            setRulesText(boundCircleHomeRulesText(value));
            setSaveError(null);
            setSaveMessage(null);
          }}
          placeholder="Be kind and make room for others.\nRespect privacy."
          placeholderTextColor={C.secondary}
          textAlignVertical="top"
          value={rulesText}
          style={editorStyles.input}
        />
      </View>

      {editorError && (
        <StatusMessage
          message={editorError}
          tone="error"
          style={editorStyles.error}
        />
      )}
      {saveMessage && (
        <StatusMessage
          message={saveMessage}
          tone="success"
          style={editorStyles.success}
        />
      )}

      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          title={isSavingText ? "Saving Home…" : "Save Home details"}
          loading={isSavingText}
          disabled={!canEdit || !!validationError}
          onPress={saveText}
          style={{ flexGrow: 1, flexBasis: 170 }}
        />
        <Button
          title="Cancel"
          secondary
          disabled={isSavingText}
          onPress={onClose}
          style={{ flexGrow: 1, flexBasis: 108 }}
        />
      </View>
      {saveError && !isSavingText && canEdit && (
        <Button
          title="Retry saving Home"
          secondary
          onPress={saveText}
          style={{ alignSelf: "flex-start" }}
        />
      )}

      <View style={[s.divider, { marginVertical: 2 }]} />
      {!isAuthorityAvailable || !home ? (
        <View style={[s.card, { padding: 14 }]}>
          <T style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>
            We’re refreshing Home permissions. Your welcome and guidelines draft
            is still here; pinned-post details return once they’re confirmed.
          </T>
        </View>
      ) : (
        <>
          <View style={{ gap: 5 }}>
            <T style={{ fontSize: 17, fontWeight: "700" }}>Pinned post</T>
            <T style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>
              Pin one existing moment. Choosing a post never changes the welcome
              or rules draft.
            </T>
          </View>

          {home.pinnedPost ? (
            <View style={{ gap: 8 }}>
              <Heading level={2} style={s.eyebrow}>
                CURRENTLY PINNED
              </Heading>
              <PostCard post={home.pinnedPost} />
              <Button
                title={
                  desiredPostId === null && isSavingPin
                    ? "Unpinning…"
                    : "Unpin this post"
                }
                secondary
                loading={desiredPostId === null && isSavingPin}
                disabled={!canEdit || isSavingPin}
                onPress={() => changePinnedPost(null)}
              />
            </View>
          ) : (
            <View style={[s.card, { padding: 14 }]}>
              <T style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>
                Nothing is pinned yet. Choose an existing moment below.
              </T>
            </View>
          )}

          <View style={{ gap: 10 }}>
            <T style={s.eyebrow}>
              {home.pinnedPost
                ? "CHOOSE A REPLACEMENT"
                : "CHOOSE A POST TO PIN"}
            </T>
            {uniqueFeedItems.length ? (
              uniqueFeedItems.map((post) => (
                <View key={post.id} style={{ gap: 7 }}>
                  <PostCard post={post} />
                  <Button
                    title={
                      desiredPostId === post.id && isSavingPin
                        ? "Updating pinned post…"
                        : pinActionTitle
                    }
                    secondary
                    loading={desiredPostId === post.id && isSavingPin}
                    disabled={!canEdit || isSavingPin}
                    onPress={() => changePinnedPost(post.id)}
                  />
                </View>
              ))
            ) : (
              <T style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>
                No loaded circle posts are available to pin.
              </T>
            )}
            {hasNextFeedPage && (
              <Button
                title="Show more circle posts"
                secondary
                loading={isFetchingNextFeedPage}
                disabled={!canEdit || isSavingPin}
                onPress={onLoadMoreFeedItems}
                style={{ alignSelf: "flex-start" }}
              />
            )}
          </View>

          {pinError && (
            <View style={{ gap: 9 }}>
              <StatusMessage
                message={pinError}
                tone="error"
                style={editorStyles.error}
              />
              <Button
                title="Retry pinned-post change"
                secondary
                disabled={
                  !canEdit || desiredPostId === undefined || isSavingPin
                }
                onPress={() =>
                  desiredPostId === undefined
                    ? undefined
                    : changePinnedPost(desiredPostId)
                }
                style={{ alignSelf: "flex-start" }}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
}

const editorStyles = {
  input: {
    backgroundColor: C.bg,
    borderColor: C.border,
    borderRadius: 12,
    borderWidth: 1,
    color: C.ink,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 116,
    padding: 14,
  },
  error: { fontSize: 13, lineHeight: 20 },
  success: { fontSize: 13, lineHeight: 20 },
} as const;
