import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  ScrollView,
  View,
  Pressable,
  Platform,
} from "react-native";
import Constants from "expo-constants";
import { Image } from "@/components/media-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import { assetBase64, supportedMime } from "@/lib/media";
import {
  Avatar,
  Button,
  C,
  Empty,
  Icon,
  IconButton,
  Input,
  photo,
  Pill,
  s,
  T,
  Wordmark,
} from "@/components/circles-ui";

export default function CreateScreen() {
  const params = useLocalSearchParams<{ mode?: string; circleId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, requireAuth, notify, showLogin } = useCircles();
  const [mode, setMode] = useState(params.mode || "post");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Lifestyle");
  const [privacy, setPrivacy] = useState<"public" | "private">("public");
  const [circleId, setCircleId] = useState<number | undefined>(
    params.circleId ? Number(params.circleId) : undefined,
  );
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const circles = trpc.social.circles.useQuery({});
  const profile = trpc.social.profile.useQuery({}, { enabled: !!user });
  const utils = trpc.useUtils();
  const upload = trpc.social.upload.useMutation();
  const post = trpc.social.createPost.useMutation();
  const circle = trpc.social.createCircle.useMutation();
  const live = trpc.live.create.useMutation();
  async function pickMedia() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mode === "circle" ? ["images"] : ["images", "videos"],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled) setAsset(result.assets[0]);
    } catch {
      notify("Photo library could not open. Check your device permissions.");
    }
  }
  async function uploadAsset() {
    if (!asset) return undefined;
    return (
      await upload.mutateAsync({
        base64: await assetBase64(asset),
        mimeType: supportedMime(asset),
      })
    ).url;
  }
  async function publish() {
    if (!requireAuth()) return;
    if (
      mode === "live" &&
      Platform.OS !== "web" &&
      Constants.executionEnvironment === "storeClient"
    ) {
      notify(
        "Live broadcasting needs a Circles development or release build. Expo Go can preview the social screens.",
      );
      return;
    }
    if (mode === "post" && !text.trim() && !asset) {
      notify("Add a moment or a few words first.");
      return;
    }
    if (mode !== "post" && !name.trim()) {
      notify(
        mode === "circle"
          ? "Give your circle a name."
          : "Give your live session a title.",
      );
      return;
    }
    setBusy(true);
    try {
      const media = await uploadAsset();
      if (mode === "post") {
        await post.mutateAsync({
          text: text.trim(),
          media,
          mediaType: asset
            ? asset.type === "video"
              ? "video"
              : "photo"
            : "text",
          circleId,
        });
        void utils.social.feed.invalidate();
        notify("Your moment is out in the world.");
        router.back();
      } else if (mode === "circle") {
        const result = await circle.mutateAsync({
          name: name.trim(),
          description: text.trim(),
          category,
          privacy,
          image:
            media || (category === "Outdoors" ? photo.mountains : photo.coffee),
          color: C.sage,
        });
        void utils.social.circles.invalidate();
        notify("A new circle. A new beginning.");
        router.replace(`/circle/${result.id}`);
      } else {
        const result = await live.mutateAsync({
          title: name.trim(),
          circleId,
          thumbnail: media || profile.data?.avatar || photo.mountains,
        });
        router.replace(`/live/${result.id}?host=1`);
      }
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "Could not share. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View
        style={[
          s.between,
          { padding: 20, borderBottomWidth: 1, borderColor: C.border },
        ]}
      >
        <Wordmark />
        <IconButton
          icon="close"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          label="Close composer"
        />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 20,
            maxWidth: 620,
            width: "100%",
            alignSelf: "center",
            gap: 18,
            paddingBottom: insets.bottom + 30,
          }}
        >
          <T style={s.eyebrow}>MAKE A LITTLE CONNECTION</T>
          <T style={s.title}>
            {mode === "circle"
              ? "Bring your people together."
              : mode === "live"
                ? "A moment, in real time."
                : "What’s your world today?"}
          </T>
          <View style={[s.row, { gap: 8 }]}>
            <Pill
              title="Post"
              icon="image-outline"
              selected={mode === "post"}
              onPress={() => setMode("post")}
            />
            <Pill
              title="Circle"
              icon="ellipse-outline"
              selected={mode === "circle"}
              onPress={() => setMode("circle")}
            />
            <Pill
              title="Go live"
              icon="radio-outline"
              selected={mode === "live"}
              onPress={() => setMode("live")}
            />
          </View>
          {!user ? (
            <Empty
              icon="person-outline"
              title="Make yourself at home."
              text="Sign in to share something, create your own community, or go live."
              action="Sign in"
              onAction={showLogin}
            />
          ) : (
            <>
              <View style={[s.row, { gap: 12 }]}>
                <Avatar
                  uri={profile.data?.avatar}
                  name={user.name || ""}
                  size={44}
                />
                <View>
                  <T style={{ fontWeight: "700" }}>
                    {profile.data?.name || user.name}
                  </T>
                  <T style={{ fontSize: 12, color: C.muted }}>
                    A little more you.
                  </T>
                </View>
              </View>
              {mode !== "post" && (
                <Input
                  value={name}
                  onChangeText={setName}
                  label={
                    mode === "circle" ? "CIRCLE NAME" : "LIVE SESSION TITLE"
                  }
                  placeholder={
                    mode === "circle"
                      ? "e.g. Sunday Coffee Club"
                      : "What are we talking about?"
                  }
                />
              )}
              <Input
                value={text}
                onChangeText={setText}
                multiline
                label={
                  mode === "circle"
                    ? "ABOUT YOUR CIRCLE"
                    : mode === "live"
                      ? "DESCRIPTION"
                      : "YOUR MOMENT"
                }
                placeholder={
                  mode === "circle"
                    ? "What brings your people together?"
                    : "A thought, a story, something worth sharing…"
                }
              />
              {mode === "circle" ? (
                <>
                  <T style={s.eyebrow}>WHAT BRINGS YOU TOGETHER?</T>
                  <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                    {[
                      "Lifestyle",
                      "Outdoors",
                      "Design",
                      "Photography",
                      "Fitness",
                      "Music",
                      "Food",
                    ].map((item) => (
                      <Pill
                        key={item}
                        title={item}
                        selected={category === item}
                        onPress={() => setCategory(item)}
                      />
                    ))}
                  </View>
                  <T style={s.eyebrow}>WHO CAN JOIN?</T>
                  <View style={[s.row, { gap: 9, flexWrap: "wrap" }]}>
                    <Pill
                      title="Public · anyone can join"
                      icon="globe-outline"
                      selected={privacy === "public"}
                      onPress={() => setPrivacy("public")}
                    />
                    <Pill
                      title="Private · approval needed"
                      icon="lock-closed-outline"
                      selected={privacy === "private"}
                      onPress={() => setPrivacy("private")}
                    />
                  </View>
                </>
              ) : (
                <>
                  <T style={s.eyebrow}>SHARE WITH</T>
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8 }}
                  >
                    <Pill
                      title="Everyone"
                      selected={!circleId}
                      onPress={() => setCircleId(undefined)}
                    />
                    {circles.data
                      ?.filter((item) => item.joined)
                      .map((item) => (
                        <Pill
                          key={item.id}
                          title={item.name}
                          selected={circleId === item.id}
                          onPress={() => setCircleId(item.id)}
                        />
                      ))}
                  </ScrollView>
                </>
              )}
              {mode !== "live" && (
                <Pressable
                  onPress={pickMedia}
                  style={{
                    backgroundColor: C.paper,
                    borderWidth: 1,
                    borderStyle: "dashed",
                    borderColor: "#CFD3C5",
                    borderRadius: 16,
                    padding: asset ? 0 : 27,
                    alignItems: "center",
                    gap: 10,
                    overflow: "hidden",
                  }}
                >
                  {asset ? (
                    <>
                      <Image
                        source={{ uri: asset.uri }}
                        style={{ width: "100%", height: 210 }}
                        contentFit="cover"
                      />
                      <T style={{ padding: 12, color: C.coral, fontSize: 12 }}>
                        Change {asset.type === "video" ? "video" : "photo"}
                      </T>
                    </>
                  ) : (
                    <>
                      <Icon name="images-outline" color={C.green} size={27} />
                      <T style={{ fontWeight: "600", color: C.green }}>
                        Add{" "}
                        {mode === "circle"
                          ? "a cover photo"
                          : "a photo or video"}
                      </T>
                      <T style={{ color: C.muted, fontSize: 12 }}>
                        JPEG, PNG, WebP or MP4 · up to 20 MB
                      </T>
                    </>
                  )}
                </Pressable>
              )}
              {mode === "live" && (
                <View
                  style={{
                    padding: 16,
                    backgroundColor: C.sage,
                    borderRadius: 13,
                    gap: 7,
                  }}
                >
                  <T style={{ fontWeight: "600", fontSize: 12 }}>
                    Camera on. Conversation open.
                  </T>
                  <T style={{ color: C.green, fontSize: 12 }}>
                    Live video uses your camera and microphone. On iOS and
                    Android, a native development or release build is required;
                    Expo Go cannot broadcast WebRTC video.
                  </T>
                </View>
              )}
              <Button
                title={
                  mode === "post"
                    ? "Share your moment"
                    : mode === "circle"
                      ? "Create your circle"
                      : "Start live session"
                }
                icon={mode === "live" ? "radio-outline" : "arrow-up-outline"}
                loading={busy}
                onPress={publish}
              />
              <T style={{ color: C.muted, fontSize: 12, textAlign: "center" }}>
                A kind word goes a long way. Keep your circle welcoming.
              </T>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
