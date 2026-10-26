import { useEffect, useMemo, useRef, useState } from "react";
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
import { resolveFnd001QueryDisplayState } from "@/lib/fnd001-query-display-state";
import {
  batch1OperationIdentityMatches,
  batch1OperationKey,
  createBatch1OperationGuard,
  createBatch1OperationInstance,
  type Batch1OperationScope,
} from "@/lib/batch1-mutation-feedback";
import { invalidateProfileViews } from "@/lib/source-query-invalidation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppShell } from "./app-shell";
import { PostCard } from "./post-card";
import { UserAvatar } from "./user-avatar";
import {
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

function ProfileEditModal({
  profile,
  editorOuterPadding,
  topInset,
  bottomInset,
  saving,
  onClose,
  onSave,
}: {
  profile: { name: string; handle: string; bio?: string | null };
  editorOuterPadding: number;
  topInset: number;
  bottomInset: number;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: { name: string; handle: string; bio: string }) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [handle, setHandle] = useState(profile.handle);
  const [bio, setBio] = useState(profile.bio ?? "");

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
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
            paddingVertical: Math.max(16, topInset),
          }}
        >
          <ScrollView
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
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
              paddingBottom: Math.max(20, bottomInset + 20),
            }}
          >
            <View style={s.between}>
              <T style={{ fontWeight: "700", fontSize: 20 }}>Make it you.</T>
              <IconButton icon="close" onPress={onClose} />
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
                onSave({
                  name: name.trim(),
                  handle: handle.trim(),
                  bio: bio.trim(),
                })
              }
              loading={saving}
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type FollowTarget = {
  id: number;
  name: string;
  isFollowing?: boolean;
};

function ProfileFollowActions({
  accountId,
  target,
  onMessage,
  onRefetch,
  requireAuth,
}: {
  accountId: number | null;
  target: FollowTarget;
  onMessage: () => void;
  onRefetch: () => void;
  requireAuth: (action: () => void) => void;
  notify: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const follow = trpc.social.follow.useMutation();
  const mountedRef = useRef(false);
  const scopeRef = useRef<Batch1OperationScope | null>(null);
  const [operationInstance] = useState(() => createBatch1OperationInstance());
  const [followGuard] = useState(() => createBatch1OperationGuard());
  const [pendingFollowScope, setPendingFollowScope] =
    useState<Batch1OperationScope | null>(null);
  const [followError, setFollowError] = useState<{
    scope: Batch1OperationScope;
    message: string;
  } | null>(null);
  const identity = useMemo(
    () => operationInstance.createIdentity(accountId, `profile:${target.id}`),
    [accountId, operationInstance, target.id],
  );

  useEffect(() => {
    mountedRef.current = true;
    const scope = operationInstance.activate(identity);
    scopeRef.current = scope;
    return () => {
      mountedRef.current = false;
      operationInstance.deactivate(scope);
      if (scopeRef.current?.instanceId === scope?.instanceId) {
        scopeRef.current = null;
      }
    };
  }, [identity, operationInstance]);

  function followScopeIsCurrent(scope: Batch1OperationScope): boolean {
    return mountedRef.current && operationInstance.isCurrent(scope);
  }

  function requestFollow() {
    const startFollow = () => {
      const scope = scopeRef.current;
      if (!scope) return;
      const desiredFollowing = !target.isFollowing;

      void followGuard.run(scope, async () => {
        setPendingFollowScope(scope);
        setFollowError((current) =>
          current &&
          batch1OperationKey(current.scope) === batch1OperationKey(scope)
            ? null
            : current,
        );
        try {
          await follow.mutateAsync({
            userId: target.id,
            following: desiredFollowing,
          });
          if (!followScopeIsCurrent(scope)) return;
          onRefetch();
          void invalidateProfileViews(utils);
        } catch {
          if (!followScopeIsCurrent(scope)) return;
          setFollowError({
            scope,
            message: `Couldn’t ${desiredFollowing ? "follow" : "unfollow"} ${target.name}. Check your connection and try again.`,
          });
        } finally {
          if (!followScopeIsCurrent(scope)) return;
          setPendingFollowScope((current) =>
            current && batch1OperationKey(current) === batch1OperationKey(scope)
              ? null
              : current,
          );
        }
      });
    };

    requireAuth(startFollow);
  }

  const followPending =
    pendingFollowScope !== null &&
    batch1OperationIdentityMatches(pendingFollowScope, identity);
  const visibleFollowError =
    followError && batch1OperationIdentityMatches(followError.scope, identity)
      ? followError.message
      : null;

  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { gap: 9 }]}>
        <Button
          title={
            followPending
              ? target.isFollowing
                ? "Unfollowing…"
                : "Following…"
              : target.isFollowing
                ? "Following"
                : "Follow"
          }
          accessibilityLabel={`${target.isFollowing ? "Unfollow" : "Follow"} ${target.name}`}
          secondary={target.isFollowing}
          loading={followPending}
          disabled={followPending}
          onPress={requestFollow}
          style={{ flex: 1 }}
        />
        <Button
          title="Say hello"
          icon="chatbubble-outline"
          secondary
          onPress={onMessage}
          style={{ flex: 1 }}
        />
      </View>
      {visibleFollowError && (
        <T
          accessibilityLiveRegion="polite"
          style={{ color: C.secondary, fontSize: 12, lineHeight: 18 }}
        >
          {visibleFollowError}
        </T>
      )}
    </View>
  );
}

export default function ProfileScreen({
  personId,
  invalidPersonRoute = false,
  onBack,
}: {
  personId?: number;
  invalidPersonRoute?: boolean;
  onBack?: () => void;
}) {
  const router = useRouter();
  const { user, requireAuth, notify, showLogin, logout } = useCircles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const editorOuterPadding = width <= 360 ? 16 : 24;
  const own = !personId || personId === user?.id;
  const profile = trpc.social.profile.useQuery(
    personId ? { id: personId } : {},
    { enabled: !invalidPersonRoute && (!!personId || !!user) },
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
  const utils = trpc.useUtils();
  const accountId = user?.id ?? null;
  const p = profile.data;
  const profileResourceId = p ? `profile:${p.id}` : null;

  const update = trpc.social.updateProfile.useMutation({
    onSuccess: () => {
      setEdit(false);
      void profile.refetch();
      void invalidateProfileViews(utils);
      notify("Your profile feels a little more you.");
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
  const posts =
    feed.data?.filter(
      (post) => (own && tab === "Saved") || post.author.id === p?.id,
    ) || [];
  const feedDisplayState = resolveFnd001QueryDisplayState({
    isLoading: feed.isLoading,
    isError: feed.isError,
    hasContent: !!posts.length,
  });
  return (
    <AppShell>
      {onBack && (
        <Button
          title="Back"
          accessibilityLabel="Go back from this profile"
          icon="arrow-back"
          secondary
          onPress={onBack}
          style={{ alignSelf: "flex-start", marginBottom: 16 }}
        />
      )}
      {invalidPersonRoute ? (
        <Empty
          icon="person-outline"
          title="This person couldn’t be found."
          text="Try exploring other creators."
          action="Discover people"
          onAction={() => router.push("/discover")}
        />
      ) : !personId && !user ? (
        <Empty
          icon="person-outline"
          title="A space that’s all you."
          text="Sign in to create your profile, connect with people, and keep your favourite moments."
          action="Make yourself at home"
          onAction={showLogin}
        />
      ) : profile.isLoading ? (
        <Loading />
      ) : profile.isError ? (
        <Empty
          icon="person-outline"
          title="We couldn’t load this profile."
          text="Check your connection and try again."
          action="Try again"
          onAction={() => void profile.refetch()}
        />
      ) : !p ? (
        <Empty
          title="This person couldn’t be found."
          text="Try exploring other creators."
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
                    await logout();
                    notify("You’re signed out. See you soon.");
                  } catch {
                    notify(
                      "Signed out locally, but remote session revocation could not be confirmed.",
                    );
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
              <UserAvatar
                uri={p.avatar}
                name={p.name}
                size={79}
                userId={p.id}
              />
            </View>
            {own && (
              <View style={{ marginTop: 36, gap: 7, alignItems: "flex-end" }}>
                <Button
                  title="Edit profile"
                  secondary
                  onPress={() => setEdit(true)}
                  style={{ borderRadius: 9 }}
                />
                <Button
                  title="Edit interests"
                  secondary
                  onPress={() => router.push("/onboarding?edit=1")}
                  style={{ borderRadius: 9 }}
                />
                <Button
                  title="Connect email sign-in"
                  secondary
                  onPress={() =>
                    requireAuth(() => router.push("/account/email"))
                  }
                  style={{ borderRadius: 9 }}
                />
              </View>
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
              <ProfileFollowActions
                key={`${accountId ?? "anonymous"}:${profileResourceId ?? "none"}`}
                accountId={accountId}
                target={p}
                onMessage={() =>
                  requireAuth(() => message.mutate({ userId: p.id }))
                }
                onRefetch={() => void profile.refetch()}
                requireAuth={requireAuth}
                notify={notify}
              />
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
          {feedDisplayState === "loading" ? (
            <Loading />
          ) : feedDisplayState === "error" ? (
            <Empty
              icon="images-outline"
              title={
                tab === "Saved"
                  ? "We couldn’t load your saved moments."
                  : "We couldn’t load these moments."
              }
              text="Check your connection and try again."
              action="Try again"
              onAction={() => void feed.refetch()}
            />
          ) : feedDisplayState === "empty" ? (
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
      {edit && p && (
        <ProfileEditModal
          profile={p}
          editorOuterPadding={editorOuterPadding}
          topInset={insets.top}
          bottomInset={insets.bottom}
          saving={update.isPending}
          onClose={() => setEdit(false)}
          onSave={(draft) => requireAuth(() => update.mutate(draft))}
        />
      )}
    </AppShell>
  );
}
