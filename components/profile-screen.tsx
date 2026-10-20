import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "@/components/media-image";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppShell } from "./app-shell";
import { PostCard } from "./post-card";
import {
  Avatar,
  Button,
  C,
  Empty,
  IconButton,
  Input,
  Loading,
  photo,
  Pill,
  s,
  T,
} from "./circles-ui";

export default function ProfileScreen({ personId }: { personId?: number }) {
  const router = useRouter();
  const { user, requireAuth, notify, showLogin, refresh } = useCircles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const editorOuterPadding = width <= 360 ? 16 : 24;
  const own = !personId || personId === user?.id;
  const profile = trpc.social.profile.useQuery(
    personId ? { id: personId } : {},
    { enabled: !!personId || !!user },
  );
  const [tab, setTab] = useState("Moments");
  const feed = trpc.social.feed.useQuery(
    {
      filter: own && tab === "Saved" ? "saved" : "for-you",
      authorId: own && tab === "Saved" ? undefined : profile.data?.id,
    },
    { enabled: !!profile.data },
  );
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  useEffect(() => {
    if (profile.data) {
      setName(profile.data.name);
      setHandle(profile.data.handle);
      setBio(profile.data.bio);
    }
  }, [profile.data]);
  const utils = trpc.useUtils();
  const update = trpc.social.updateProfile.useMutation({
    onSuccess: () => {
      setEdit(false);
      void profile.refetch();
      void utils.social.profiles.invalidate();
      notify("Your profile feels a little more you.");
    },
    onError: (e) => notify(e.message),
  });
  const follow = trpc.social.follow.useMutation({
    onSuccess: () => {
      void profile.refetch();
      void utils.social.profiles.invalidate();
    },
    onError: (e) => notify(e.message),
  });
  const message = trpc.social.openDirect.useMutation({
    onSuccess: (result) =>
      router.push(
        `/chat/${result.id}?name=${encodeURIComponent(profile.data?.name || "Conversation")}`,
      ),
    onError: (e) => notify(e.message),
  });
  const p = profile.data;
  const posts =
    feed.data?.filter(
      (post) => (own && tab === "Saved") || post.author.id === p?.id,
    ) || [];
  return (
    <AppShell>
      {!personId && !user ? (
        <Empty
          icon="person-outline"
          title="A space that’s all you."
          text="Sign in to create your profile, connect with people, and keep your favourite moments."
          action="Make yourself at home"
          onAction={showLogin}
        />
      ) : profile.isLoading ? (
        <Loading />
      ) : !p ? (
        <Empty
          title="This person couldn’t be found."
          text={profile.error?.message || "Try exploring other creators."}
          action="Discover people"
          onAction={() => router.push("/discover")}
        />
      ) : (
        <>
          <View style={[s.between, { marginBottom: 17 }]}>
            <T style={s.eyebrow}>
              {own ? "YOUR LITTLE CORNER" : "MEET YOUR PEOPLE"}
            </T>
            {own && (
              <IconButton
                icon="log-out-outline"
                onPress={async () => {
                  try {
                    await Api.logout();
                    await Auth.removeSessionToken();
                    await Auth.clearUserInfo();
                    utils.auth.me.setData(undefined, null);
                    void utils.invalidate();
                    refresh();
                    notify("You’re signed out. See you soon.");
                  } catch {
                    notify("Could not sign out. Try again.");
                  }
                }}
                label="Sign out"
              />
            )}
          </View>
          <View
            style={{
              borderRadius: 19,
              overflow: "hidden",
              height: 150,
              backgroundColor: C.sage,
            }}
          >
            <Image
              source={{ uri: p.cover || photo.mountains }}
              style={{ width: "100%", height: "100%", opacity: 0.8 }}
              contentFit="cover"
            />
          </View>
          <View style={[s.between, { marginTop: -37, paddingHorizontal: 18 }]}>
            <View
              style={{ backgroundColor: C.bg, borderRadius: 50, padding: 5 }}
            >
              <Avatar uri={p.avatar} name={p.name} size={79} />
            </View>
            {own && (
              <Button
                title="Edit profile"
                secondary
                onPress={() => setEdit(true)}
                style={{ marginTop: 36, borderRadius: 9 }}
              />
            )}
          </View>
          <View style={{ paddingVertical: 16, gap: 10, minWidth: 0 }}>
            <T style={[s.title, { flexShrink: 1 }]} numberOfLines={2}>
              {p.name}
            </T>
            <T style={{ color: C.muted, fontSize: 12 }}>@{p.handle}</T>
            <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
              {p.bio || "A new face. A new connection."}
            </T>
            <View style={[s.row, { gap: 25, marginVertical: 8 }]}>
              {[
                [posts.length, "moments"],
                [p.followers, "followers"],
                [p.following, "following"],
              ].map(([count, label]) => (
                <View key={String(label)}>
                  <T style={{ fontWeight: "800", fontSize: 20 }}>{count}</T>
                  <T style={{ color: C.muted, fontSize: 12 }}>{label}</T>
                </View>
              ))}
            </View>
            {!own && (
              <View style={[s.row, { gap: 9 }]}>
                <Button
                  title={p.isFollowing ? "Following" : "Follow"}
                  secondary={p.isFollowing}
                  onPress={() =>
                    requireAuth(() => follow.mutate({ userId: p.id }))
                  }
                  style={{ flex: 1 }}
                />
                <Button
                  title="Say hello"
                  icon="chatbubble-outline"
                  secondary
                  onPress={() =>
                    requireAuth(() => message.mutate({ userId: p.id }))
                  }
                  style={{ flex: 1 }}
                />
              </View>
            )}
          </View>
          <View style={[s.row, { gap: 9, marginBottom: 22, paddingTop: 8 }]}>
            <Pill
              title="Moments"
              selected={tab === "Moments"}
              onPress={() => setTab("Moments")}
            />
            {own && (
              <Pill
                title="Saved"
                icon="bookmark-outline"
                selected={tab === "Saved"}
                onPress={() => setTab("Saved")}
              />
            )}
          </View>
          {feed.isLoading ? (
            <Loading />
          ) : !posts.length ? (
            <Empty
              icon="images-outline"
              title={
                tab === "Saved"
                  ? "Keep a little inspiration."
                  : own
                    ? "Your first moment awaits."
                    : "More moments to come."
              }
              text={
                tab === "Saved"
                  ? "Tap the bookmark on a post to keep it here."
                  : "A photo, a thought, a small part of your day."
              }
              action={own && tab !== "Saved" ? "Share a moment" : undefined}
              onAction={() => router.push("/create")}
            />
          ) : (
            posts.map((post) => <PostCard key={post.id} post={post} />)
          )}
        </>
      )}
      <Modal
        visible={edit}
        transparent
        animationType="fade"
        onRequestClose={() => setEdit(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "#19201B88",
              justifyContent: "center",
              alignItems: "center",
              paddingHorizontal: editorOuterPadding,
              paddingVertical: Math.max(16, insets.top),
            }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              style={{
                width: "100%",
                maxWidth: 420,
                maxHeight: "100%",
                backgroundColor: C.paper,
                borderRadius: 23,
              }}
              contentContainerStyle={{
                padding: 20,
                gap: 16,
                paddingBottom: Math.max(20, insets.bottom + 20),
              }}
            >
              <View style={s.between}>
                <T style={{ fontWeight: "700", fontSize: 20 }}>Make it you.</T>
                <IconButton icon="close" onPress={() => setEdit(false)} />
              </View>
              <Input label="YOUR NAME" value={name} onChangeText={setName} />
              <Input
                label="YOUR HANDLE"
                value={handle}
                onChangeText={setHandle}
                placeholder="letters, numbers, underscores"
              />
              <Input
                label="A LITTLE ABOUT YOU"
                value={bio}
                onChangeText={setBio}
                multiline
              />
              <Button
                title="Save profile"
                onPress={() =>
                  update.mutate({
                    name: name.trim(),
                    handle: handle.trim(),
                    bio: bio.trim(),
                  })
                }
                loading={update.isPending}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </AppShell>
  );
}
