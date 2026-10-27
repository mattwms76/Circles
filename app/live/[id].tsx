import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { createSingleFlightSubmitter } from "@/lib/single-flight-submit";
import {
  createA26LiveMediaState,
  isA26LiveParticipantReady,
  transitionA26LiveMediaState,
  type A26LiveMediaPhaseChange,
} from "@/lib/a26-live-media-state";
import { useCircles } from "@/hooks/circles-context";
import { resolveFnd001QueryDisplayState } from "@/lib/fnd001-query-display-state";
import {
  createLiveOperationScope,
  isCurrentLiveOperationScope,
  type LiveOperationScope,
} from "@/lib/batch4-live-operation-scope";
import { AppShell } from "@/components/app-shell";
import { StatusMessage } from "@/components/status-message";
import { UserAvatar } from "@/components/user-avatar";
import {
  Avatar,
  Button,
  C,
  Empty,
  Icon,
  IconButton,
  Loading,
  s,
  T,
} from "@/components/circles-ui";
import {
  acceptCurrentLiveHostLease,
  currentLiveHostEndInput,
  type LiveHostLease,
} from "@/components/design31-live-ui";
import LiveMedia from "@/components/live-media";

function RetryableLiveError({
  title,
  text,
  retrying,
  onRetry,
}: {
  title: string;
  text: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ alignItems: "center", paddingVertical: 32, gap: 12 }}
    >
      <View
        style={{
          width: 66,
          height: 66,
          borderRadius: 33,
          backgroundColor: C.soft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="radio-outline" size={28} color={C.action} />
      </View>
      <T style={{ fontSize: 19, fontWeight: "700", textAlign: "center" }}>
        {title}
      </T>
      <T style={{ color: C.secondary, textAlign: "center", maxWidth: 330 }}>
        {text}
      </T>
      <Button
        title="Try again"
        secondary
        loading={retrying}
        onPress={onRetry}
      />
    </View>
  );
}

export default function LiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const streamId = Number(id);

  // A new account or route owns fresh pending/error state as well as a fresh
  // effect lifecycle. This avoids showing an old account's pending mutation if
  // an account changes and later changes back.
  const { user } = useCircles();
  const liveSessionKey = `${user?.id ?? "guest"}:${id}`;

  return (
    <LiveSessionScreen key={liveSessionKey} streamId={streamId} routeId={id} />
  );
}

function LiveSessionScreen({
  streamId,
  routeId,
}: {
  streamId: number;
  routeId: string;
}) {
  const router = useRouter();
  const { user, showLogin, notify } = useCircles();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [liveChatSubmitter] = useState(createSingleFlightSubmitter);
  const [isLiveChatSubmitting, setIsLiveChatSubmitting] = useState(false);
  const [liveReactionSubmitter] = useState(createSingleFlightSubmitter);
  const [isLiveReactionSubmitting, setIsLiveReactionSubmitting] =
    useState(false);
  const [mediaState, setMediaState] = useState(createA26LiveMediaState);
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const [hostMediaSession, setHostMediaSession] =
    useState<LiveHostLease | null>(null);
  const [endConfirm, setEndConfirm] = useState(false);
  const { width, height } = useWindowDimensions();
  const wide = width >= 900;
  const lives = trpc.live.list.useQuery({}, { refetchInterval: 4000 });
  const live = lives.data?.find((item) => item.id === streamId);
  const livesDisplayState = resolveFnd001QueryDisplayState({
    isLoading: lives.isLoading,
    isError: lives.isError,
    hasContent: !!lives.data,
  });
  const host = !!user && live?.host.id === user.id;
  const hostEndInput = currentLiveHostEndInput({
    host,
    streamId,
    lease: hostMediaSession,
  });
  const hostGeneration = hostEndInput?.generation ?? null;
  const ready = mediaState.phase === "ready";
  const mediaError = mediaState.error;
  const participantReady = isA26LiveParticipantReady(mediaState);
  const hostExitActionTitle = ready ? "End live session" : "Leave camera setup";
  const awaitingHostLease = hostGeneration === null;
  // This descriptor remains useful for source-level account/stream diagnostics,
  // but is never the completion authority on its own.
  const liveScope = `${user?.id ?? "guest"}:${streamId}`;
  const liveOperationGenerationRef = useRef(0);
  const currentLiveOperationScopeRef = useRef<LiveOperationScope | null>(null);
  const contentBottomInset = Math.max(32, insets.bottom + 16);
  const modalTopInset = Math.max(25, insets.top + 16);
  const modalBottomInset = Math.max(25, insets.bottom + 16);
  const endModalMaxHeight = Math.max(
    1,
    height - modalTopInset - modalBottomInset,
  );
  useLayoutEffect(() => {
    liveOperationGenerationRef.current += 1;
    const activeScope = createLiveOperationScope({
      accountId: user?.id ?? null,
      routeId: `${routeId}:${liveScope}`,
      generation: liveOperationGenerationRef.current,
    });
    currentLiveOperationScopeRef.current = activeScope;
    return () => {
      if (
        isCurrentLiveOperationScope(
          activeScope,
          currentLiveOperationScopeRef.current,
        )
      ) {
        currentLiveOperationScopeRef.current = null;
      }
    };
  }, [liveScope, routeId, user]);
  const captureLiveOperationScope = useCallback(
    () => currentLiveOperationScopeRef.current,
    [],
  );
  const isCurrentLiveScope = useCallback(
    (operationScope: LiveOperationScope | null) =>
      isCurrentLiveOperationScope(
        operationScope,
        currentLiveOperationScopeRef.current,
      ),
    [],
  );
  const chat = trpc.live.chat.useQuery(
    { streamId },
    {
      enabled: !!user && !!live && participantReady,
      refetchInterval: 2000,
      retry: false,
    },
  );
  const chatDisplayState = resolveFnd001QueryDisplayState({
    isLoading: chat.isLoading,
    isError: chat.isError,
    hasContent: !!chat.data?.length,
  });
  const refetchLiveList = useCallback(
    async (
      operationScope: LiveOperationScope | null = captureLiveOperationScope(),
    ) => {
      if (!isCurrentLiveScope(operationScope)) return;
      try {
        await lives.refetch();
        if (!isCurrentLiveScope(operationScope)) return;
      } catch {
        if (!isCurrentLiveScope(operationScope)) return;
      } finally {
        if (!isCurrentLiveScope(operationScope)) return;
      }
    },
    [captureLiveOperationScope, isCurrentLiveScope, lives],
  );
  const refetchChat = useCallback(
    async (
      operationScope: LiveOperationScope | null = captureLiveOperationScope(),
    ) => {
      if (!isCurrentLiveScope(operationScope)) return;
      try {
        await chat.refetch();
        if (!isCurrentLiveScope(operationScope)) return;
      } catch {
        if (!isCurrentLiveScope(operationScope)) return;
      } finally {
        if (!isCurrentLiveScope(operationScope)) return;
      }
    },
    [captureLiveOperationScope, chat, isCurrentLiveScope],
  );
  const retryLiveList = useCallback(() => {
    void refetchLiveList();
  }, [refetchLiveList]);
  const retryChat = useCallback(() => {
    void refetchChat();
  }, [refetchChat]);
  const livesRetrying = lives.isFetching && !lives.isLoading;
  const chatRetrying = chat.isFetching && !chat.isLoading;
  const send = trpc.live.sendChat.useMutation();
  const submitLiveChatMessage = useCallback(() => {
    const message = text.trim();
    if (!participantReady || !message || liveChatSubmitter.isBusy) {
      return;
    }

    const operationScope = captureLiveOperationScope();
    if (!isCurrentLiveScope(operationScope)) return;
    void liveChatSubmitter.run(async () => {
      if (!isCurrentLiveScope(operationScope)) return;
      setIsLiveChatSubmitting(true);
      try {
        await send.mutateAsync({ streamId, text: message });
        if (!isCurrentLiveScope(operationScope)) return;
        setText("");
        void refetchChat(operationScope);
      } catch {
        if (!isCurrentLiveScope(operationScope)) return;
        notify("We couldn’t send your message. Try again.", "error");
      } finally {
        if (isCurrentLiveScope(operationScope)) {
          setIsLiveChatSubmitting(false);
        }
      }
    });
  }, [
    captureLiveOperationScope,
    isCurrentLiveScope,
    liveChatSubmitter,
    notify,
    participantReady,
    refetchChat,
    send,
    streamId,
    text,
  ]);
  const react = trpc.live.react.useMutation();
  const sendLiveReaction = useCallback(() => {
    if (!participantReady || liveReactionSubmitter.isBusy) return;

    const operationScope = captureLiveOperationScope();
    if (!isCurrentLiveScope(operationScope)) return;
    void liveReactionSubmitter.run(async () => {
      if (!isCurrentLiveScope(operationScope)) return;
      setIsLiveReactionSubmitting(true);
      try {
        await react.mutateAsync({ streamId });
        if (!isCurrentLiveScope(operationScope)) return;
        void refetchChat(operationScope);
      } catch {
        if (!isCurrentLiveScope(operationScope)) return;
        notify("We couldn’t send that reaction. Try again.", "error");
      } finally {
        if (isCurrentLiveScope(operationScope)) {
          setIsLiveReactionSubmitting(false);
        }
      }
    });
  }, [
    captureLiveOperationScope,
    isCurrentLiveScope,
    liveReactionSubmitter,
    notify,
    participantReady,
    react,
    refetchChat,
    streamId,
  ]);
  const end = trpc.live.end.useMutation();
  const endLiveSession = useCallback(() => {
    if (hostGeneration === null) return;

    const operationScope = captureLiveOperationScope();
    if (!isCurrentLiveScope(operationScope)) return;
    const generation = hostGeneration;
    end.mutate(
      { streamId, generation },
      {
        onSuccess: () => {
          if (!isCurrentLiveScope(operationScope)) return;
          notify("Your live moment is complete.", "success");
          router.replace("/live");
        },
        onError: () => {
          if (!isCurrentLiveScope(operationScope)) return;
          notify("We couldn’t end this live moment. Try again.", "error");
        },
        onSettled: () => {
          if (!isCurrentLiveScope(operationScope)) return;
        },
      },
    );
  }, [
    captureLiveOperationScope,
    end,
    hostGeneration,
    isCurrentLiveScope,
    notify,
    router,
    streamId,
  ]);
  const handleLiveMediaPhaseChange = useCallback(
    (change: A26LiveMediaPhaseChange) => {
      const operationScope = captureLiveOperationScope();
      if (!isCurrentLiveScope(operationScope)) return;
      setMediaState((current) => transitionA26LiveMediaState(current, change));
      if (change.phase === "ready") {
        void refetchChat(operationScope);
      }
    },
    [captureLiveOperationScope, isCurrentLiveScope, refetchChat],
  );
  const handleLiveMediaError = useCallback(
    (message: string) => {
      const operationScope = captureLiveOperationScope();
      if (!isCurrentLiveScope(operationScope)) return;
      setMediaState((current) =>
        transitionA26LiveMediaState(current, {
          phase: "error",
          generation: current.generation,
          message,
        }),
      );
    },
    [captureLiveOperationScope, isCurrentLiveScope],
  );
  const rejoinLiveMedia = useCallback(() => {
    const operationScope = captureLiveOperationScope();
    if (!isCurrentLiveScope(operationScope)) return;
    // A backgrounded adapter is intentionally terminal. A new keyed attempt is
    // created only from this user action, retaining the account/route fence.
    setHostMediaSession(null);
    setMediaState(createA26LiveMediaState());
    setMediaAttempt((attempt) => attempt + 1);
  }, [captureLiveOperationScope, isCurrentLiveScope]);
  const handleLiveHostLease = useCallback(
    (lease: LiveHostLease) => {
      const operationScope = captureLiveOperationScope();
      if (!isCurrentLiveScope(operationScope) || !host) return;
      setHostMediaSession((currentLease) =>
        acceptCurrentLiveHostLease({
          streamId,
          currentLease,
          candidate: lease,
        }),
      );
    },
    [captureLiveOperationScope, host, isCurrentLiveScope, streamId],
  );
  return (
    <AppShell sidebar={false} scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: wide ? 30 : 20,
            paddingBottom: contentBottomInset,
          }}
        >
          <View style={[s.between, { marginBottom: 20 }]}>
            <IconButton
              icon="arrow-back"
              onPress={() =>
                host
                  ? setEndConfirm(true)
                  : router.canGoBack()
                    ? router.back()
                    : router.replace("/live")
              }
              label="Leave live stream"
            />
            <T style={s.eyebrow}>A MOMENT TOGETHER</T>
            <Icon name="radio-outline" color={C.coral} />
          </View>
          {!user ? (
            <Empty
              title="Come join the moment."
              text="Sign in to watch live video and join the conversation."
              action="Sign in"
              onAction={showLogin}
            />
          ) : livesDisplayState === "loading" ? (
            <Loading />
          ) : livesDisplayState === "error" ? (
            <RetryableLiveError
              title="We couldn’t load this live moment."
              text="Check your connection and try again."
              retrying={livesRetrying}
              onRetry={retryLiveList}
            />
          ) : !live ? (
            <Empty
              icon="radio-outline"
              title="This live moment has ended."
              text="Some moments are best enjoyed as they happen. Find another connection."
              action="Find live streams"
              onAction={() => router.replace("/live")}
            />
          ) : (
            <>
              <View
                style={{
                  backgroundColor: "#20261F",
                  borderRadius: 19,
                  overflow: "hidden",
                }}
              >
                <LiveMedia
                  key={mediaAttempt}
                  streamId={streamId}
                  host={host}
                  currentUserId={user?.id ?? null}
                  onError={handleLiveMediaError}
                  onHostLease={handleLiveHostLease}
                  onMediaPhaseChange={handleLiveMediaPhaseChange}
                />
                <View
                  style={{
                    position: "absolute",
                    top: 14,
                    left: 14,
                    backgroundColor: ready ? C.action : C.secondary,
                    paddingHorizontal: 9,
                    paddingVertical: 5,
                    borderRadius: 6,
                  }}
                >
                  <T
                    style={{
                      color: C.actionText,
                      fontSize: 10,
                      fontWeight: "700",
                    }}
                  >
                    {ready ? "LIVE" : "CONNECTING"} · {live.viewers} watching
                  </T>
                </View>
              </View>
              <T style={{ color: C.muted, fontSize: 13, lineHeight: 19 }}>
                This room is direct. It holds the host and up to four viewers.
              </T>
              {!!mediaError && (
                <View
                  style={{
                    backgroundColor: C.soft,
                    borderRadius: 12,
                    padding: 15,
                    marginTop: 15,
                  }}
                >
                  <StatusMessage
                    message={mediaError}
                    tone="error"
                    announce={false}
                    style={{ fontSize: 12 }}
                  />
                </View>
              )}
              {mediaState.phase === "error" ? (
                <Button
                  title="Rejoin live video"
                  secondary
                  onPress={rejoinLiveMedia}
                />
              ) : null}
              <View style={[s.row, { gap: 13, marginVertical: 20 }]}>
                <UserAvatar
                  uri={live.host.avatar}
                  name={live.host.name}
                  size={43}
                  userId={live.host.id}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T
                    numberOfLines={3}
                    style={{
                      fontSize: 19,
                      lineHeight: 24,
                      fontWeight: "700",
                      letterSpacing: -0.3,
                    }}
                  >
                    {live.title}
                  </T>
                  <T style={{ color: C.secondary, fontSize: 12 }}>
                    With {live.host.name}
                  </T>
                </View>
                <IconButton
                  icon="heart"
                  color={C.coral}
                  size={28}
                  onPress={sendLiveReaction}
                  disabled={!participantReady || isLiveReactionSubmitting}
                  loading={isLiveReactionSubmitting}
                  label={
                    !participantReady
                      ? "Live reactions will be available after video connects"
                      : isLiveReactionSubmitting
                        ? "Sending live reaction"
                        : "Send live reaction"
                  }
                  style={{
                    width: 44,
                    height: 44,
                    minWidth: 44,
                    minHeight: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                />
              </View>
              {host && (
                <Button
                  title={hostExitActionTitle}
                  secondary
                  icon="stop-circle-outline"
                  onPress={() => setEndConfirm(true)}
                />
              )}
              <View style={[s.card, { padding: 16, marginTop: 20, gap: 12 }]}>
                <View style={s.between}>
                  <T style={{ fontWeight: "700", fontSize: 15 }}>
                    In the conversation
                  </T>
                  <Icon
                    name="chatbubble-ellipses-outline"
                    size={19}
                    color={C.green}
                  />
                </View>
                <ScrollView
                  showsHorizontalScrollIndicator={false}
                  style={{ maxHeight: 270 }}
                  contentContainerStyle={{ gap: 13 }}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {!participantReady ? (
                    <T
                      style={{
                        color: C.secondary,
                        fontSize: 14,
                        lineHeight: 21,
                        paddingVertical: 15,
                      }}
                    >
                      {mediaState.phase === "error"
                        ? "Live chat will be available after video reconnects."
                        : "Joining live video before chat is available."}
                    </T>
                  ) : chatDisplayState === "loading" ? (
                    <Loading />
                  ) : chatDisplayState === "error" ? (
                    <RetryableLiveError
                      title="We couldn’t load the conversation."
                      text="Check your connection and try again."
                      retrying={chatRetrying}
                      onRetry={retryChat}
                    />
                  ) : chatDisplayState === "content" ? (
                    (chat.data ?? []).map((message) => (
                      <View
                        key={message.id}
                        style={[s.row, { gap: 9, alignItems: "flex-start" }]}
                      >
                        <Avatar
                          uri={message.avatar}
                          name={message.userName}
                          size={25}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <T style={{ fontSize: 11, fontWeight: "700" }}>
                            {message.userName}
                          </T>
                          <T
                            style={{
                              fontSize: 14,
                              lineHeight: 21,
                              color: C.secondary,
                            }}
                          >
                            {message.text}
                          </T>
                        </View>
                      </View>
                    ))
                  ) : (
                    <T
                      style={{
                        color: C.secondary,
                        fontSize: 14,
                        lineHeight: 21,
                        paddingVertical: 15,
                      }}
                    >
                      Say hello. You’re part of this moment.
                    </T>
                  )}
                </ScrollView>
                <View
                  style={[
                    s.row,
                    {
                      gap: 7,
                      borderTopWidth: 1,
                      borderColor: C.border,
                      paddingTop: 12,
                    },
                  ]}
                >
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    editable={participantReady && !isLiveChatSubmitting}
                    placeholder={
                      participantReady
                        ? "Join the conversation…"
                        : "Waiting for live video…"
                    }
                    placeholderTextColor={C.secondary}
                    accessibilityLabel="Live chat message"
                    multiline
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: C.ink,
                      fontSize: 14,
                      lineHeight: 21,
                      backgroundColor: C.bg,
                      borderRadius: 12,
                      minHeight: 48,
                      maxHeight: 126,
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      textAlignVertical: "top",
                    }}
                    onSubmitEditing={submitLiveChatMessage}
                  />
                  <IconButton
                    icon="arrow-up-circle"
                    size={30}
                    color={C.coral}
                    disabled={
                      !participantReady || isLiveChatSubmitting || !text.trim()
                    }
                    loading={isLiveChatSubmitting}
                    onPress={submitLiveChatMessage}
                    label={
                      !participantReady
                        ? "Live chat will be available after video connects"
                        : isLiveChatSubmitting
                          ? "Sending live chat message"
                          : text.trim()
                            ? "Send live chat message"
                            : "Enter a live chat message to send"
                    }
                  />
                </View>
              </View>
            </>
          )}
        </ScrollView>
        <Modal
          visible={endConfirm}
          transparent
          animationType="fade"
          onRequestClose={() => setEndConfirm(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "#19201B88",
              justifyContent: "center",
              alignItems: "center",
              paddingHorizontal: 25,
              paddingTop: modalTopInset,
              paddingBottom: modalBottomInset,
            }}
          >
            <ScrollView
              style={{
                width: "100%",
                maxWidth: 360,
                maxHeight: endModalMaxHeight,
              }}
              contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View
                style={{
                  width: "100%",
                  backgroundColor: C.paper,
                  borderRadius: 22,
                  padding: 25,
                  gap: 17,
                }}
              >
                <T style={{ fontWeight: "700", fontSize: 20 }}>
                  {ready ? "Wrap up the moment?" : "Leave camera setup?"}
                </T>
                <T style={{ color: C.secondary }}>
                  {awaitingHostLease
                    ? "We’re securing your live session. Leave camera setup will be available as soon as your current session is ready."
                    : ready
                      ? "Ending this broadcast disconnects your viewers and turns off your camera and microphone."
                      : "Leaving camera setup disconnects your viewers and turns off your camera and microphone."}
                </T>
                {awaitingHostLease ? (
                  <StatusMessage
                    message="Waiting for your secure live-session lease before camera setup can be cancelled."
                    tone="info"
                    style={{ fontSize: 13, lineHeight: 19 }}
                  />
                ) : null}
                <Button
                  title={hostExitActionTitle}
                  onPress={endLiveSession}
                  disabled={end.isPending || awaitingHostLease}
                  loading={end.isPending}
                />
                <Button
                  title="Keep connecting"
                  secondary
                  onPress={() => setEndConfirm(false)}
                />
              </View>
            </ScrollView>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </AppShell>
  );
}
