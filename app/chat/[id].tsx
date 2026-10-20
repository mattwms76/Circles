import { useMediaSource } from "@/components/media-image";
import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Image } from "@/components/media-image";
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

function ChatVideo({ uri }: { uri: string }) {
  const source = useMediaSource(uri);
  const player = useVideoPlayer(source);
  return (
    <VideoView
      player={player}
      style={{ width: 230, height: 180 }}
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
  const scroll = useRef<ScrollView>(null);
  const [text, setText] = useState("");
  const [sendingMedia, setSendingMedia] = useState(false);
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const messages = trpc.social.messages.useQuery(
    { conversationId },
    { enabled: !!user, refetchInterval: 2000 },
  );
  const read = trpc.social.markRead.useMutation();
  const utils = trpc.useUtils();
  const send = trpc.social.sendMessage.useMutation({
    onSuccess: () => {
      setText("");
      setAsset(null);
      void messages.refetch();
      void utils.social.conversations.invalidate();
    },
    onError: (e) => notify(e.message),
  });
  const upload = trpc.social.upload.useMutation();
  useEffect(() => {
    if (messages.data && user) read.mutate({ conversationId });
  }, [messages.data?.length, conversationId, user?.id]);
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [messages.data?.length]);
  async function selectMedia() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled) setAsset(result.assets[0]);
    } catch {
      notify("Your photo library could not open.");
    }
  }
  async function sendMessage() {
    if (!user || (!text.trim() && !asset) || send.isPending || sendingMedia)
      return;
    setSendingMedia(true);
    try {
      let media: string | undefined;
      if (asset) {
        media = (
          await upload.mutateAsync({
            base64: await assetBase64(asset),
            mimeType: supportedMime(asset),
          })
        ).url;
      }
      await send.mutateAsync({ conversationId, text: text.trim(), media });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Message could not send.");
    } finally {
      setSendingMedia(false);
    }
  }
  return (
    <AppShell scroll={false} sidebar={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
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
          <View style={{ flex: 1 }}>
            <T style={{ fontSize: 18, fontWeight: "700" }}>
              {name || "Your conversation"}
            </T>
            <T style={{ fontSize: 11, color: C.muted }}>
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
              ref={scroll}
              onContentSizeChange={() =>
                scroll.current?.scrollToEnd({ animated: false })
              }
              contentContainerStyle={{ padding: 22, gap: 20, flexGrow: 1 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={{ alignItems: "center", marginBottom: 15 }}>
                <T style={s.eyebrow}>GOOD CONVERSATIONS START WITH KINDNESS</T>
              </View>
              {!messages.data?.length && (
                <Empty
                  icon="chatbubble-outline"
                  title="A hello goes a long way."
                  text="You’re connected. Start the conversation."
                />
              )}
              {messages.data?.map((message) => {
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
                            <ChatVideo uri={message.media} />
                          ) : (
                            <Image
                              source={{ uri: message.media }}
                              style={{
                                width: 220,
                                height: 170,
                                borderRadius: 9,
                              }}
                              contentFit="cover"
                            />
                          ))}
                        {!!message.text && (
                          <T
                            style={{
                              color: own ? "#fff" : C.ink,
                              fontSize: 13,
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
                <IconButton icon="close" onPress={() => setAsset(null)} />
              </View>
            )}
            <View
              style={[
                s.row,
                {
                  gap: 8,
                  padding: 14,
                  paddingBottom: Math.max(14, insets.bottom),
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
              />
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Say something kind…"
                placeholderTextColor={C.muted}
                onSubmitEditing={sendMessage}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: 24,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: C.paper,
                  fontSize: 13,
                  color: C.ink,
                }}
              />
              <Pressable
                disabled={send.isPending || sendingMedia}
                onPress={sendMessage}
                accessibilityLabel="Send message"
                style={{
                  width: 42,
                  height: 42,
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
