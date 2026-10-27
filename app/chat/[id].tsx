import {
  Image,
  MediaPlaceholder,
  useMediaSource,
} from "@/components/media-image";
import { StatusMessage } from "@/components/status-message";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import { AppShell } from "@/components/app-shell";
import { UserAvatar } from "@/components/user-avatar";
import {
  ago,
  C,
  Empty,
  Icon,
  IconButton,
  Loading,
  s,
  T,
} from "@/components/circles-ui";
import { useVideoPlayer, VideoView } from "expo-video";
import { assetBase64, supportedMime } from "@/lib/media";
import {
  createMessageCompositionRetryId,
  readReceiptRetryDelayMs,
} from "@/lib/message-composition";
import {
  canSendMessage,
  createMessageCompositionSingleFlight,
  isCurrentMessageCompositionOperation,
  type MessageCompositionOperation,
} from "@/lib/batch2-message-accessibility";
import {
  mergeMessageHistoryPages,
  MESSAGE_PAGE_DEFAULT_LIMIT,
  olderMessagePageCursor,
} from "@/shared/message-pagination";
import {
  authorizedConversationMetadata,
  isDefinitiveMessageApplicationError,
  MAX_MESSAGE_TEXT_LENGTH,
  messageTextIsWithinLimit,
  positiveSafeConversationId,
} from "@/lib/a26-messaging-state";
import {
  canReleaseChatEditorAuthorityLatch,
  createChatEditorAuthorityLatch,
  isExplicitChatEditorAuthorityError,
  type ChatEditorAuthorityLatch,
} from "../../lib/parity27-chat-editor-state";

type ReadReceiptState = {
  scope: string;
  acknowledgedThrough: number;
  targetMessageId: number;
  failedAttempts: number;
  inFlight: boolean;
};

function ChatVideo({ uri, width }: { uri: string; width: number }) {
  const [retryAttempt, setRetryAttempt] = useState(0);
  return (
    <ChatVideoSource
      key={`${uri}:${retryAttempt}`}
      uri={uri}
      width={width}
      onRetry={
        retryAttempt === 0
          ? () => setRetryAttempt((attempt) => attempt + 1)
          : undefined
      }
    />
  );
}

function ChatVideoSource({
  uri,
  width,
  onRetry,
}: {
  uri: string;
  width: number;
  onRetry?: () => void;
}) {
  const source = useMediaSource(uri);
  const player = useVideoPlayer(source);
  const [failed, setFailed] = useState(() => player.status === "error");

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status }) => {
      if (status === "error") setFailed(true);
    });
    return () => subscription.remove();
  }, [player]);

  if (source === null) {
    return (
      <MediaPlaceholder
        label="Video attachment loading"
        style={{ width, aspectRatio: 1.38 }}
      />
    );
  }

  if (failed) {
    return (
      <MediaPlaceholder
        label="Video unavailable"
        style={{ width, aspectRatio: 1.38 }}
        retryLabel="Retry video"
        onRetry={onRetry}
      >
        <StatusMessage
          message="Video unavailable."
          tone="error"
          style={{ fontSize: 12, fontWeight: "700", textAlign: "center" }}
        />
      </MediaPlaceholder>
    );
  }

  return (
    <VideoView
      player={player}
      accessible
      accessibilityLabel="Video attachment"
      style={{ width, aspectRatio: 1.38 }}
      nativeControls
      contentFit="contain"
    />
  );
}
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const { user } = useCircles();
  const conversationId = positiveSafeConversationId(id);
  if (!conversationId) {
    return (
      <AppShell>
        <Empty
          icon="chatbubble-ellipses-outline"
          title="This conversation link is invalid."
          text="Open a conversation from your inbox instead."
          action="Back to inbox"
          onAction={() => router.replace("/messages")}
        />
      </AppShell>
    );
  }
  const compositionKey = `${user?.id ?? "guest"}:${conversationId}`;

  return (
    <ChatScreenInstance key={compositionKey} conversationId={conversationId} />
  );
}

function ChatScreenInstance({ conversationId }: { conversationId: number }) {
  const router = useRouter();
  const { authState, refresh, user, showLogin, notify } = useCircles();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const receiptRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readReceipt = useRef<ReadReceiptState>({
    scope: "",
    acknowledgedThrough: 0,
    targetMessageId: 0,
    failedAttempts: 0,
    inFlight: false,
  });
  const compositionRetryId = useRef<string | null>(null);
  const uploadedMediaUrl = useRef<string | null>(null);
  const compositionRetryScope = useRef<string | null>(null);
  const [text, setText] = useState("");
  const [sendingMedia, setSendingMedia] = useState(false);
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const compositionScope = `${user?.id ?? "guest"}:${conversationId}`;
  const activeCompositionOperation = useRef<MessageCompositionOperation | null>(
    null,
  );
  const compositionGeneration = useRef(0);
  const sendFlight = useRef(createMessageCompositionSingleFlight());
  const chatAuthorityLockScope = useRef<string | null>(null);
  const [uncertainDeliveryOperation, setUncertainDeliveryOperation] =
    useState<MessageCompositionOperation | null>(null);
  const [chatAuthorityLatch, setChatAuthorityLatch] =
    useState<ChatEditorAuthorityLatch | null>(null);
  const deliveryUncertain = uncertainDeliveryOperation !== null;
  const hasSendableMessage = canSendMessage(text, !!asset);
  const canLoadProtectedChat = authState === "authenticated" && !!user;
  const chatMediaWidth = Math.min(
    220,
    Math.max(120, Math.floor((windowWidth - 44) * 0.8) - 26),
  );
  const conversationMetadata = trpc.social.conversations.useQuery(
    { conversationId, viewerScope: user?.id },
    {
      enabled: canLoadProtectedChat,
      refetchInterval: 3000,
    },
  );
  const authorizedConversation = canLoadProtectedChat
    ? authorizedConversationMetadata(conversationMetadata.data, conversationId)
    : null;
  const messages = trpc.social.messages.useInfiniteQuery(
    { conversationId, limit: MESSAGE_PAGE_DEFAULT_LIMIT },
    {
      enabled: canLoadProtectedChat,
      refetchInterval: 2000,
      getNextPageParam: (lastPage) => olderMessagePageCursor(lastPage),
    },
  );
  const { mutateAsync: markRead } = trpc.social.markRead.useMutation();
  const utils = trpc.useUtils();
  const loadedMessages = mergeMessageHistoryPages(messages.data?.pages ?? []);
  const newestLivePage = messages.data?.pages[0] ?? [];
  const newestDeliveredMessageId = newestLivePage.at(-1)?.id;
  const userId = user?.id;
  const send = trpc.social.sendMessage.useMutation();
  const upload = trpc.social.upload.useMutation();
  const isFetchingEarlierMessages = messages.isFetchingNextPage;
  const hasOlderPageError = messages.isFetchNextPageError;
  const messagesError = messages.error;
  const chatAuthorityScope = `${user?.id ?? "guest"}:${conversationId}`;
  const explicitChatAuthorityLoss =
    isExplicitChatEditorAuthorityError(messages.error) ||
    isExplicitChatEditorAuthorityError(conversationMetadata.error);
  const activeChatAuthorityLatch =
    chatAuthorityLatch?.scope === chatAuthorityScope
      ? chatAuthorityLatch
      : null;
  const pendingChatAuthorityLatch =
    explicitChatAuthorityLoss && activeChatAuthorityLatch === null
      ? createChatEditorAuthorityLatch({
          scope: chatAuthorityScope,
          messagesDataUpdatedAt: messages.dataUpdatedAt,
          metadataDataUpdatedAt: conversationMetadata.dataUpdatedAt,
        })
      : activeChatAuthorityLatch;
  const canReleaseChatAuthority = canReleaseChatEditorAuthorityLatch({
    latch: pendingChatAuthorityLatch,
    scope: chatAuthorityScope,
    transcriptAuthorityAvailable:
      !messages.isError && !messages.error && messages.data !== undefined,
    messagesDataUpdatedAt: messages.dataUpdatedAt,
    metadataAuthorityAvailable:
      !conversationMetadata.isError && authorizedConversation !== null,
    metadataDataUpdatedAt: conversationMetadata.dataUpdatedAt,
  });
  const releaseChatAuthorityLatch =
    !explicitChatAuthorityLoss &&
    activeChatAuthorityLatch !== null &&
    canReleaseChatAuthority;
  if (explicitChatAuthorityLoss && activeChatAuthorityLatch === null) {
    // React restarts this render with the latch and clean draft state before
    // committing descendants, so a structured denial has no permissive frame.
    setChatAuthorityLatch(pendingChatAuthorityLatch);
    setText("");
    setAsset(null);
    setSendingMedia(false);
    setUncertainDeliveryOperation(null);
  }
  if (releaseChatAuthorityLatch) {
    // The latch can only leave render state after both newer, authorized query
    // generations are present. Ref cleanup/re-activation happens on commit.
    setChatAuthorityLatch(null);
  }
  const chatAuthorityLocked =
    explicitChatAuthorityLoss ||
    (!!pendingChatAuthorityLatch && !releaseChatAuthorityLatch);
  const clearLockedChatOperations = useCallback(() => {
    if (chatAuthorityLockScope.current === chatAuthorityScope) return;

    chatAuthorityLockScope.current = chatAuthorityScope;
    if (receiptRetryTimer.current) {
      clearTimeout(receiptRetryTimer.current);
      receiptRetryTimer.current = null;
    }
    readReceipt.current = {
      scope: "",
      acknowledgedThrough: 0,
      targetMessageId: 0,
      failedAttempts: 0,
      inFlight: false,
    };
    compositionRetryId.current = null;
    uploadedMediaUrl.current = null;
    compositionRetryScope.current = null;
    activeCompositionOperation.current = null;
  }, [chatAuthorityScope]);
  const lockChatAuthority = useCallback(() => {
    clearLockedChatOperations();
    setText("");
    setAsset(null);
    setSendingMedia(false);
    setUncertainDeliveryOperation(null);
    setChatAuthorityLatch((current) =>
      current?.scope === chatAuthorityScope
        ? current
        : createChatEditorAuthorityLatch({
            scope: chatAuthorityScope,
            messagesDataUpdatedAt: messages.dataUpdatedAt,
            metadataDataUpdatedAt: conversationMetadata.dataUpdatedAt,
          }),
    );
  }, [
    chatAuthorityScope,
    clearLockedChatOperations,
    conversationMetadata.dataUpdatedAt,
    messages.dataUpdatedAt,
  ]);
  useLayoutEffect(() => {
    if (chatAuthorityLocked) {
      clearLockedChatOperations();
      return;
    }
    chatAuthorityLockScope.current = null;
  }, [chatAuthorityLocked, clearLockedChatOperations]);
  const conversationUnavailable = !!messagesError && !hasOlderPageError;
  const sendDisabled =
    chatAuthorityLocked ||
    !hasSendableMessage ||
    send.isPending ||
    sendingMedia;
  useEffect(() => {
    if (chatAuthorityLocked) return;
    const operation = {
      scope: compositionScope,
      generation: compositionGeneration.current + 1,
    };
    compositionGeneration.current = operation.generation;
    activeCompositionOperation.current = operation;

    return () => {
      if (
        isCurrentMessageCompositionOperation(
          activeCompositionOperation.current,
          operation,
        )
      ) {
        activeCompositionOperation.current = null;
      }
    };
  }, [chatAuthorityLocked, compositionScope]);
  useEffect(() => {
    if (chatAuthorityLocked || !userId || !newestDeliveredMessageId) return;
    const scope = `${userId}:${conversationId}`;
    let state = readReceipt.current;
    if (state.scope !== scope) {
      state = {
        scope,
        acknowledgedThrough: 0,
        targetMessageId: newestDeliveredMessageId,
        failedAttempts: 0,
        inFlight: false,
      };
      readReceipt.current = state;
    } else if (newestDeliveredMessageId > state.targetMessageId) {
      // A new delivered message is a new acknowledgement target. Do not let a
      // previous terminal failure suppress its bounded retry budget.
      state.targetMessageId = newestDeliveredMessageId;
      state.failedAttempts = 0;
    }
    if (state.acknowledgedThrough >= state.targetMessageId) return;

    let disposed = false;
    const acknowledgeLatest = async () => {
      if (
        disposed ||
        state.scope !== scope ||
        state.inFlight ||
        state.acknowledgedThrough >= state.targetMessageId
      ) {
        return;
      }
      const throughMessageId = state.targetMessageId;
      state.inFlight = true;
      try {
        await markRead({ conversationId, throughMessageId });
        if (state.scope !== scope) return;
        state.acknowledgedThrough = Math.max(
          state.acknowledgedThrough,
          throughMessageId,
        );
        state.failedAttempts = 0;
      } catch (error) {
        if (isExplicitChatEditorAuthorityError(error)) {
          lockChatAuthority();
          return;
        }
        if (state.scope !== scope || state.targetMessageId !== throughMessageId)
          return;
        state.failedAttempts += 1;
        const retryDelay = readReceiptRetryDelayMs(state.failedAttempts);
        if (retryDelay !== null && !disposed) {
          receiptRetryTimer.current = setTimeout(() => {
            receiptRetryTimer.current = null;
            void acknowledgeLatest();
          }, retryDelay);
        }
      } finally {
        if (state.scope === scope) state.inFlight = false;
      }
    };
    void acknowledgeLatest();
    return () => {
      disposed = true;
      if (receiptRetryTimer.current) {
        clearTimeout(receiptRetryTimer.current);
        receiptRetryTimer.current = null;
      }
    };
  }, [
    chatAuthorityLocked,
    conversationId,
    lockChatAuthority,
    markRead,
    newestDeliveredMessageId,
    userId,
  ]);
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [newestDeliveredMessageId]);

  function loadEarlierMessages() {
    if (!chatAuthorityLocked && !isFetchingEarlierMessages) {
      void messages.fetchNextPage();
    }
  }

  async function selectMedia() {
    if (
      chatAuthorityLocked ||
      deliveryUncertain ||
      sendFlight.current.isActive
    ) {
      return;
    }
    const selectionOperation = activeCompositionOperation.current;
    if (!selectionOperation) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        quality: 0.7,
        base64: true,
      });
      if (
        !result.canceled &&
        isCurrentMessageCompositionOperation(
          activeCompositionOperation.current,
          selectionOperation,
        )
      ) {
        compositionRetryId.current = null;
        uploadedMediaUrl.current = null;
        compositionRetryScope.current = selectionOperation.scope;
        setAsset(result.assets[0]);
      }
    } catch {
      if (
        isCurrentMessageCompositionOperation(
          activeCompositionOperation.current,
          selectionOperation,
        )
      ) {
        notify("Your photo library could not open.", "error");
      }
    }
  }
  async function sendMessage() {
    if (
      chatAuthorityLocked ||
      !user ||
      !canLoadProtectedChat ||
      !hasSendableMessage
    ) {
      return;
    }
    if (!messageTextIsWithinLimit(text)) {
      notify(
        `Messages can be up to ${MAX_MESSAGE_TEXT_LENGTH.toLocaleString()} characters. Edit your draft and try again.`,
        "error",
      );
      return;
    }
    const operation = activeCompositionOperation.current;
    if (!operation || !sendFlight.current.start(operation)) return;
    setSendingMedia(true);
    let sendWasAttempted = false;
    try {
      if (compositionRetryScope.current !== operation.scope) {
        compositionRetryId.current = null;
        uploadedMediaUrl.current = null;
        compositionRetryScope.current = operation.scope;
      }
      const clientMessageId =
        compositionRetryId.current ?? createMessageCompositionRetryId();
      compositionRetryId.current = clientMessageId;
      let media = uploadedMediaUrl.current ?? undefined;
      if (asset && !media) {
        const base64 = await assetBase64(asset);
        if (
          !isCurrentMessageCompositionOperation(
            activeCompositionOperation.current,
            operation,
          )
        ) {
          return;
        }
        media = (
          await upload.mutateAsync({
            base64,
            mimeType: supportedMime(asset),
          })
        ).url;
        if (
          !isCurrentMessageCompositionOperation(
            activeCompositionOperation.current,
            operation,
          )
        ) {
          return;
        }
        uploadedMediaUrl.current = media;
      }
      // `clientMessageId` is deliberately retained through an ambiguous
      // transport failure. The coordinated server contract deduplicates this
      // sender/conversation operation and returns its settled message.
      const messageInput = {
        conversationId,
        text: text.trim(),
        media,
        clientMessageId,
      };
      sendWasAttempted = true;
      await send.mutateAsync(messageInput);
      if (
        !isCurrentMessageCompositionOperation(
          activeCompositionOperation.current,
          operation,
        )
      ) {
        return;
      }
      compositionRetryId.current = null;
      uploadedMediaUrl.current = null;
      compositionRetryScope.current = null;
      setUncertainDeliveryOperation(null);
      setText("");
      setAsset(null);
      void messages.refetch();
      void utils.social.conversations.invalidate();
    } catch (error) {
      if (
        isCurrentMessageCompositionOperation(
          activeCompositionOperation.current,
          operation,
        ) &&
        isExplicitChatEditorAuthorityError(error)
      ) {
        lockChatAuthority();
        return;
      }
      if (
        isCurrentMessageCompositionOperation(
          activeCompositionOperation.current,
          operation,
        )
      ) {
        if (sendWasAttempted && isDefinitiveMessageApplicationError(error)) {
          compositionRetryId.current = null;
          setUncertainDeliveryOperation(null);
          notify(
            "This message was not sent. Update your draft or remove the attachment, then try again.",
            "error",
          );
        } else if (sendWasAttempted) {
          setUncertainDeliveryOperation(operation);
          notify(
            "We couldn’t confirm this message. Retry sends the same message, not a duplicate.",
            "error",
          );
        } else {
          notify(
            "We couldn’t prepare this attachment. Try again when you’re ready.",
            "error",
          );
        }
      }
    } finally {
      sendFlight.current.finish(operation);
      if (
        isCurrentMessageCompositionOperation(
          activeCompositionOperation.current,
          operation,
        )
      ) {
        setSendingMedia(false);
      }
    }
  }
  return (
    <AppShell scroll={false} sidebar={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          style={[
            s.row,
            {
              gap: 13,
              padding: 20,
              borderBottomWidth: 1,
              borderColor: C.border,
            },
          ]}
        >
          <IconButton
            icon="arrow-back"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/messages")
            }
            label="Back to inbox"
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T style={{ fontSize: 18, fontWeight: "700" }}>
              {authorizedConversation?.name || "Your conversation"}
            </T>
            <T
              style={{ fontSize: 12, lineHeight: 18, color: C.muted }}
              numberOfLines={2}
            >
              A space to connect · Private conversation
            </T>
          </View>
          <Icon name="chatbubbles-outline" color={C.green} size={23} />
        </View>
        {authState === "checking" ? (
          <View style={{ alignItems: "center", gap: 12, paddingVertical: 32 }}>
            <Loading />
            <StatusMessage
              message="Checking your sign-in…"
              tone="info"
              style={{ fontSize: 14, textAlign: "center" }}
            />
          </View>
        ) : authState === "error" ? (
          <View style={{ gap: 12 }}>
            <StatusMessage
              message="We couldn’t confirm your sign-in. Try again."
              tone="error"
              style={{ fontSize: 14, textAlign: "center" }}
            />
            <Empty
              icon="cloud-offline-outline"
              title="Your conversation is waiting."
              text="Check your connection, then try the sign-in check again."
              action="Try again"
              onAction={refresh}
            />
          </View>
        ) : authState === "guest" ? (
          <Empty
            title="Your conversations are private."
            text="Sign in to open this conversation."
            action="Sign in"
            onAction={showLogin}
          />
        ) : !user ? (
          <Empty
            icon="cloud-offline-outline"
            title="Your sign-in needs another check."
            text="Try again before opening this conversation."
            action="Try again"
            onAction={refresh}
          />
        ) : chatAuthorityLocked ? (
          <Empty
            title="This conversation is unavailable."
            text="You no longer have access to this conversation."
            action="Back to inbox"
            onAction={() => router.replace("/messages")}
          />
        ) : messages.isLoading ? (
          <Loading />
        ) : conversationUnavailable ? (
          <Empty
            title="This conversation is unavailable."
            text={messagesError?.message ?? "This conversation is unavailable."}
            action="Back to inbox"
            onAction={() => router.replace("/messages")}
          />
        ) : (
          <>
            <ScrollView
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              ref={scroll}
              style={{ flex: 1 }}
              onContentSizeChange={() => {
                if (!isFetchingEarlierMessages)
                  scroll.current?.scrollToEnd({ animated: false });
              }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={{ padding: 22, gap: 20, flexGrow: 1 }}
            >
              <View style={{ alignItems: "center", marginBottom: 15 }}>
                <T style={s.eyebrow}>GOOD CONVERSATIONS START WITH KINDNESS</T>
              </View>
              {messages.hasNextPage && !hasOlderPageError && (
                <Pressable
                  disabled={isFetchingEarlierMessages}
                  onPress={loadEarlierMessages}
                  accessibilityRole="button"
                  accessibilityLabel="Load earlier messages"
                  accessibilityState={{
                    disabled: isFetchingEarlierMessages,
                    busy: isFetchingEarlierMessages,
                  }}
                  style={{
                    alignSelf: "center",
                    minHeight: 44,
                    paddingHorizontal: 12,
                    justifyContent: "center",
                    opacity: isFetchingEarlierMessages ? 0.5 : 1,
                  }}
                >
                  <T
                    style={{ color: C.action, fontSize: 12, fontWeight: "700" }}
                  >
                    {isFetchingEarlierMessages
                      ? "Loading earlier messages…"
                      : "Load earlier messages"}
                  </T>
                </Pressable>
              )}
              {hasOlderPageError && (
                <Pressable
                  disabled={isFetchingEarlierMessages}
                  onPress={loadEarlierMessages}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading earlier messages"
                  accessibilityState={{
                    disabled: isFetchingEarlierMessages,
                    busy: isFetchingEarlierMessages,
                  }}
                  style={{
                    alignSelf: "center",
                    minHeight: 44,
                    paddingHorizontal: 12,
                    justifyContent: "center",
                    opacity: isFetchingEarlierMessages ? 0.5 : 1,
                  }}
                >
                  <T
                    style={{
                      color: C.secondary,
                      fontSize: 12,
                      fontWeight: "700",
                    }}
                  >
                    Could not load earlier messages. Try again.
                  </T>
                </Pressable>
              )}
              {!loadedMessages.length && (
                <Empty
                  icon="chatbubble-outline"
                  title="A hello goes a long way."
                  text="You’re connected. Start the conversation."
                />
              )}
              {loadedMessages.map((message) => {
                const own = message.author.id === user.id;
                return (
                  <View
                    key={message.id}
                    style={{
                      flexDirection: own ? "row-reverse" : "row",
                      alignItems: "flex-end",
                      gap: 8,
                    }}
                  >
                    {!own && (
                      <UserAvatar
                        uri={message.author.avatar}
                        name={message.author.name}
                        size={27}
                        userId={message.author.id}
                      />
                    )}
                    <View
                      style={{
                        maxWidth: "80%",
                        minWidth: 0,
                        alignItems: own ? "flex-end" : "flex-start",
                        gap: 5,
                      }}
                    >
                      {!own && (
                        <T style={{ fontSize: 10, color: C.muted }}>
                          {message.author.name}
                        </T>
                      )}
                      <View
                        style={{
                          backgroundColor: own ? C.action : C.paper,
                          borderWidth: own ? 0 : 1,
                          borderColor: C.border,
                          borderRadius: 17,
                          borderBottomRightRadius: own ? 4 : 17,
                          borderBottomLeftRadius: own ? 17 : 4,
                          padding: 13,
                          gap: 9,
                        }}
                      >
                        {message.media &&
                          (/\.mp4(?:\.enc)?(?:\?|$)/i.test(message.media) ? (
                            <ChatVideo
                              uri={message.media}
                              width={chatMediaWidth}
                            />
                          ) : (
                            <Image
                              source={{ uri: message.media }}
                              accessible
                              accessibilityLabel="Photo attachment"
                              style={{
                                width: chatMediaWidth,
                                aspectRatio: 1.38,
                                borderRadius: 9,
                              }}
                              contentFit="cover"
                              unavailableLabel="Photo unavailable"
                              retryLabel="Retry photo"
                              unavailableContent={
                                <StatusMessage
                                  message="Photo unavailable."
                                  tone="error"
                                  style={{
                                    fontSize: 12,
                                    fontWeight: "700",
                                    textAlign: "center",
                                  }}
                                />
                              }
                            />
                          ))}
                        {!!message.text && (
                          <T
                            style={{
                              color: own ? C.actionText : C.ink,
                              fontSize: 14,
                              lineHeight: 21,
                              flexShrink: 1,
                            }}
                          >
                            {message.text}
                          </T>
                        )}
                      </View>
                      <View style={[s.row, { gap: 5 }]}>
                        <T style={{ color: C.muted, fontSize: 9 }}>
                          {ago(message.createdAt)}
                        </T>
                        {own && (
                          <>
                            <Icon
                              name={
                                message.read ? "checkmark-done" : "checkmark"
                              }
                              color={message.read ? C.green : C.muted}
                              size={12}
                            />
                            <T style={{ color: C.muted, fontSize: 9 }}>
                              {message.read ? "Seen" : "Sent"}
                            </T>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            {!chatAuthorityLocked && asset && (
              <View
                style={[
                  s.row,
                  { paddingHorizontal: 22, gap: 10, paddingVertical: 8 },
                ]}
              >
                <Image
                  source={{ uri: asset.uri }}
                  accessible
                  accessibilityLabel={
                    asset.type === "video"
                      ? "Selected video attachment"
                      : "Selected photo attachment"
                  }
                  style={{ width: 54, height: 54, borderRadius: 8 }}
                />
                <T style={{ color: C.muted, fontSize: 12, flex: 1 }}>
                  Ready to share{" "}
                  {asset.type === "video" ? "a video" : "a photo"}
                </T>
                <IconButton
                  icon="close"
                  disabled={deliveryUncertain || sendingMedia}
                  label="Remove selected attachment"
                  onPress={() => {
                    uploadedMediaUrl.current = null;
                    compositionRetryId.current = null;
                    compositionRetryScope.current = null;
                    setAsset(null);
                  }}
                />
              </View>
            )}
            {!chatAuthorityLocked && deliveryUncertain && (
              <View style={{ paddingHorizontal: 22, paddingBottom: 8 }}>
                <StatusMessage
                  message="Delivery is unconfirmed. Retry sends this same message and attachment without creating a new one."
                  tone="error"
                  style={{ fontSize: 12, lineHeight: 18 }}
                />
              </View>
            )}
            {!chatAuthorityLocked && (
              <View
                style={[
                  s.row,
                  {
                    gap: 8,
                    padding: 14,
                    paddingBottom: Math.max(14, insets.bottom + 8),
                    borderTopWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.bg,
                  },
                ]}
              >
                <IconButton
                  icon="add-circle-outline"
                  color={C.green}
                  onPress={selectMedia}
                  label="Attach photo or video"
                  disabled={deliveryUncertain || sendingMedia}
                />
                <TextInput
                  value={text}
                  onChangeText={setText}
                  editable={!deliveryUncertain && !sendingMedia}
                  maxLength={MAX_MESSAGE_TEXT_LENGTH}
                  placeholder="Say something kind…"
                  accessibilityLabel="Message text"
                  placeholderTextColor={C.muted}
                  onSubmitEditing={sendMessage}
                  returnKeyType="send"
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: 24,
                    paddingHorizontal: 16,
                    paddingVertical: 11,
                    backgroundColor: C.paper,
                    fontSize: 14,
                    lineHeight: 21,
                    minHeight: 44,
                    color: C.ink,
                  }}
                />
                <Pressable
                  disabled={sendDisabled}
                  onPress={sendMessage}
                  accessibilityRole="button"
                  accessibilityLabel={
                    deliveryUncertain
                      ? "Retry message delivery"
                      : "Send message"
                  }
                  accessibilityState={{
                    disabled: sendDisabled,
                    busy: send.isPending || sendingMedia,
                  }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 15,
                    backgroundColor: C.action,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: sendDisabled ? 0.5 : 1,
                  }}
                >
                  <Icon name="arrow-up" color={C.actionText} size={22} />
                </Pressable>
              </View>
            )}
          </>
        )}
      </KeyboardAvoidingView>
    </AppShell>
  );
}
