import React, { useCallback, useRef, useState } from "react";
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
import { trpc } from "@/lib/trpc";
import { createSingleFlightSubmitter } from "@/lib/single-flight-submit";
import { useCircles } from "@/hooks/circles-context";
import { resolveFnd001QueryDisplayState } from "@/lib/fnd001-query-display-state";
import { AppShell } from "@/components/app-shell";
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
import LiveMedia from "@/components/live-media";

export default function LiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const streamId = Number(id);
  const router = useRouter();
  const { user, showLogin, notify } = useCircles();
  const [text, setText] = useState("");
  const liveChatSubmitter = useRef(createSingleFlightSubmitter()).current;
  const [isLiveChatSubmitting, setIsLiveChatSubmitting] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [ready, setReady] = useState(false);
  const [hostMediaSession, setHostMediaSession] = useState<{
    streamId: number;
    generation: number;
  } | null>(null);
  const [endConfirm, setEndConfirm] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const lives = trpc.live.list.useQuery({}, { refetchInterval: 4000 });
  const live = lives.data?.find((item) => item.id === streamId);
  const livesDisplayState = resolveFnd001QueryDisplayState({
    isLoading: lives.isLoading,
    isError: lives.isError,
    hasContent: !!lives.data,
  });
  const host = !!user && live?.host.id === user.id;
  const hostGeneration =
    host && hostMediaSession?.streamId === streamId
      ? hostMediaSession.generation
      : null;
  const chat = trpc.live.chat.useQuery(
    { streamId },
    { enabled: !!user && !!live, refetchInterval: 2000, retry: false },
  );
  const chatDisplayState = resolveFnd001QueryDisplayState({
    isLoading: chat.isLoading,
    isError: chat.isError,
    hasContent: !!chat.data?.length,
  });
  const send = trpc.live.sendChat.useMutation({
    onSuccess: () => {
      setText("");
      void chat.refetch();
    },
    onError: (e) => notify(e.message),
  });
  const submitLiveChatMessage = useCallback(() => {
    const message = text.trim();
    if (!message || liveChatSubmitter.isBusy) {
      return;
    }

    void liveChatSubmitter.run(async () => {
      setIsLiveChatSubmitting(true);
      try {
        await send
          .mutateAsync({ streamId, text: message })
          // The mutation's onError already gives the user the failure feedback.
          .catch(() => undefined);
      } finally {
        setIsLiveChatSubmitting(false);
      }
    });
  }, [liveChatSubmitter, send, streamId, text]);
  const react = trpc.live.react.useMutation({
    onSuccess: () => {
      void chat.refetch();
    },
    onError: (e) => notify(e.message),
  });
  const end = trpc.live.end.useMutation({
    onSuccess: () => {
      notify("Your live moment is complete.");
      router.replace("/live");
    },
    onError: (e) => notify(e.message),
  });
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
            paddingBottom: 32,
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
            <Empty
              icon="radio-outline"
              title="We couldn’t load this live moment."
              text="Check your connection and try again."
              action="Try again"
              onAction={() => void lives.refetch()}
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
                  streamId={streamId}
                  host={host}
                  onError={setMediaError}
                  onReady={(generation) => {
                    setReady(true);
                    if (host && generation !== undefined) {
                      setHostMediaSession({ streamId, generation });
                    }
                  }}
                />
                <View
                  style={{
                    position: "absolute",
                    top: 14,
                    left: 14,
                    backgroundColor: ready ? C.coral : "#6B7564",
                    paddingHorizontal: 9,
                    paddingVertical: 5,
                    borderRadius: 6,
                  }}
                >
                  <T style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>
                    {ready ? "LIVE" : "CONNECTING"} · {live.viewers} watching
                  </T>
                </View>
              </View>
              {!!mediaError && (
                <View
                  style={{
                    backgroundColor: C.soft,
                    borderRadius: 12,
                    padding: 15,
                    marginTop: 15,
                  }}
                >
                  <T style={{ color: C.coral, fontSize: 12 }}>{mediaError}</T>
                </View>
              )}
              <View style={[s.row, { gap: 13, marginVertical: 20 }]}>
                <Avatar
                  uri={live.host.avatar}
                  name={live.host.name}
                  size={43}
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
                  <T style={{ color: C.muted, fontSize: 12 }}>
                    With {live.host.name}
                  </T>
                </View>
                <IconButton
                  icon="heart"
                  color={C.coral}
                  size={28}
                  onPress={() => react.mutate({ streamId })}
                  label="Send live reaction"
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
                  title="End live session"
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
                  {chatDisplayState === "loading" ? (
                    <Loading />
                  ) : chatDisplayState === "error" ? (
                    <Empty
                      icon="chatbubble-ellipses-outline"
                      title="We couldn’t load the conversation."
                      text="Check your connection and try again."
                      action="Try again"
                      onAction={() => void chat.refetch()}
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
                              color: C.muted,
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
                        color: C.muted,
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
                    editable={!isLiveChatSubmitting}
                    placeholder="Join the conversation…"
                    placeholderTextColor={C.muted}
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
                    disabled={isLiveChatSubmitting}
                    loading={isLiveChatSubmitting}
                    onPress={submitLiveChatMessage}
                    label={
                      isLiveChatSubmitting
                        ? "Sending live chat message"
                        : "Send live chat message"
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
              padding: 25,
            }}
          >
            <View
              style={{
                width: "100%",
                maxWidth: 360,
                backgroundColor: C.paper,
                borderRadius: 22,
                padding: 25,
                gap: 17,
              }}
            >
              <T style={{ fontWeight: "700", fontSize: 20 }}>
                Wrap up the moment?
              </T>
              <T style={{ color: C.muted }}>
                Ending this broadcast disconnects your viewers and turns off
                your camera and microphone.
              </T>
              <Button
                title="End live session"
                onPress={() => {
                  if (hostGeneration !== null) {
                    end.mutate({ streamId, generation: hostGeneration });
                  }
                }}
                disabled={end.isPending || hostGeneration === null}
                loading={end.isPending}
              />
              <Button
                title="Keep connecting"
                secondary
                onPress={() => setEndConfirm(false)}
              />
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </AppShell>
  );
}
