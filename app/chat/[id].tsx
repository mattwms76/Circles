import { Image, useMediaSource } from "@/components/media-image";
import { useEffect, useRef, useState } from "react";
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
import {
  ago,
  Avatar,
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
  mergeMessageHistoryPages,
  MESSAGE_PAGE_DEFAULT_LIMIT,
  olderMessagePageCursor,
} from "@/shared/message-pagination";

type ReadReceiptState = {
  scope: string;
  acknowledgedThrough: number;
  targetMessageId: number;
  failedAttempts: number;
  inFlight: boolean;
};

function ChatVideo({ uri, width }: { uri: string; width: number }) {
  const source = useMediaSource(uri);
  const player = useVideoPlayer(source);
  return (
    <VideoView
      player={player}
      style={{ width, aspectRatio: 1.38 }}
      nativeControls
      contentFit="contain"
    />
  );
}
export default function ChatScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const conversationId = Number(id);
  const router = useRouter();
  const { user, showLogin, notify } = useCircles();
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
  const [uncertainDeliveryScope, setUncertainDeliveryScope] = useState<
    string | null
  >(null);
  const deliveryUncertain = uncertainDeliveryScope === compositionScope;
  const chatMediaWidth = Math.min(
    220,
    Math.max(120, Math.floor((windowWidth - 44) * 0.8) - 26),
  );
  const messages = trpc.social.messages.useInfiniteQuery(
    { conversationId, limit: MESSAGE_PAGE_DEFAULT_LIMIT },
    {
      enabled: !!user,
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
  const send = trpc.social.sendMessage.useMutation({
    onSuccess: () => {
      compositionRetryId.current = null;
      uploadedMediaUrl.current = null;
      compositionRetryScope.current = null;
      setUncertainDeliveryScope(null);
      setText("");
      setAsset(null);
      void messages.refetch();
      void utils.social.conversations.invalidate();
    },
  });
  const upload = trpc.social.upload.useMutation();
  useEffect(() => {
    if (!userId || !newestDeliveredMessageId) return;
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
      } catch {
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
  }, [conversationId, markRead, newestDeliveredMessageId, userId]);
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [newestDeliveredMessageId]);

  function loadEarlierMessages() {
    void messages.fetchNextPage();
  }

  async function selectMedia() {
    if (deliveryUncertain) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled) {
        compositionRetryId.current = null;
        uploadedMediaUrl.current = null;
        compositionRetryScope.current = compositionScope;
        setAsset(result.assets[0]);
      }
    } catch {
      notify("Your photo library could not open.");
    }
  }
  async function sendMessage() {
    if (!user || (!text.trim() && !asset) || send.isPending || sendingMedia)
      return;
    setSendingMedia(true);
    try {
      if (compositionRetryScope.current !== compositionScope) {
        compositionRetryId.current = null;
        uploadedMediaUrl.current = null;
        compositionRetryScope.current = compositionScope;
      }
      const clientMessageId =
        compositionRetryId.current ?? createMessageCompositionRetryId();
      compositionRetryId.current = clientMessageId;
      let media = uploadedMediaUrl.current ?? undefined;
      if (asset && !media) {
        media = (
          await upload.mutateAsync({
            base64: await assetBase64(asset),
            mimeType: supportedMime(asset),
          })
        ).url;
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
      await send.mutateAsync(messageInput);
    } catch {
      setUncertainDeliveryScope(compositionScope);
      notify(
        "We couldn’t confirm this message. Retry sends the same message, not a duplicate.",
      );
    } finally {
      setSendingMedia(false);
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
            <T style={{ fontSize: 18, fontWeight: "700" }} numberOfLines={2}>
              {name || "Your conversation"}
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
        {!user ? (
          <Empty
            title="Your conversations are private."
            text="Sign in to open this conversation."
            action="Sign in"
            onAction={showLogin}
          />
        ) : messages.isLoading ? (
          <Loading />
        ) : messages.error ? (
          <Empty
            title="This conversation is unavailable."
            text={messages.error.message}
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
                if (!messages.isFetchingNextPage)
                  scroll.current?.scrollToEnd({ animated: false });
              }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={{ padding: 22, gap: 20, flexGrow: 1 }}
            >
              <View style={{ alignItems: "center", marginBottom: 15 }}>
                <T style={s.eyebrow}>GOOD CONVERSATIONS START WITH KINDNESS</T>
              </View>
              {messages.hasNextPage && (
                <Pressable
                  disabled={messages.isFetchingNextPage}
                  onPress={loadEarlierMessages}
                  accessibilityLabel="Load earlier messages"
                  style={{
                    alignSelf: "center",
                    opacity: messages.isFetchingNextPage ? 0.5 : 1,
                  }}
                >
                  <T
                    style={{ color: C.green, fontSize: 12, fontWeight: "700" }}
                  >
                    {messages.isFetchingNextPage
                      ? "Loading earlier messages…"
                      : "Load earlier messages"}
                  </T>
                </Pressable>
              )}
              {messages.isFetchNextPageError && (
                <Pressable
                  onPress={loadEarlierMessages}
                  accessibilityLabel="Retry loading earlier messages"
                  style={{ alignSelf: "center" }}
                >
                  <T
                    style={{ color: C.coral, fontSize: 12, fontWeight: "700" }}
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
                      <Avatar
                        uri={message.author.avatar}
                        name={message.author.name}
                        size={27}
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
                          backgroundColor: own ? C.coral : C.paper,
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
                              style={{
                                width: chatMediaWidth,
                                aspectRatio: 1.38,
                                borderRadius: 9,
                              }}
                              contentFit="cover"
                            />
                          ))}
                        {!!message.text && (
                          <T
                            style={{
                              color: own ? "#fff" : C.ink,
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
            {asset && (
              <View
                style={[
                  s.row,
                  { paddingHorizontal: 22, gap: 10, paddingVertical: 8 },
                ]}
              >
                <Image
                  source={{ uri: asset.uri }}
                  style={{ width: 54, height: 54, borderRadius: 8 }}
                />
                <T style={{ color: C.muted, fontSize: 12, flex: 1 }}>
                  Ready to share{" "}
                  {asset.type === "video" ? "a video" : "a photo"}
                </T>
                <IconButton
                  icon="close"
                  disabled={deliveryUncertain}
                  onPress={() => {
                    uploadedMediaUrl.current = null;
                    compositionRetryId.current = null;
                    compositionRetryScope.current = null;
                    setAsset(null);
                  }}
                />
              </View>
            )}
            {deliveryUncertain && (
              <View style={{ paddingHorizontal: 22, paddingBottom: 8 }}>
                <T style={{ color: C.coral, fontSize: 12, lineHeight: 18 }}>
                  Delivery is unconfirmed. Retry sends this same message and
                  attachment without creating a new one.
                </T>
              </View>
            )}
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
                disabled={deliveryUncertain}
              />
              <TextInput
                value={text}
                onChangeText={setText}
                editable={!deliveryUncertain}
                placeholder="Say something kind…"
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
                disabled={send.isPending || sendingMedia}
                onPress={sendMessage}
                accessibilityLabel={
                  deliveryUncertain ? "Retry message delivery" : "Send message"
                }
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 15,
                  backgroundColor: C.coral,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: send.isPending || sendingMedia ? 0.5 : 1,
                }}
              >
                <Icon name="arrow-up" color="#fff" size={22} />
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </AppShell>
  );
}
