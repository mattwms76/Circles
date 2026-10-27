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
import type { StatusTone } from "@/lib/status-announcement";
import { resolvePagedDisplayState } from "@/lib/a26-paged-display";
import {
  getA26OwnProfileQueryInput,
  isA26CurrentActorProfile,
} from "@/lib/a26-directory-ui";
import {
  A26_PROFILE_BIO_MAX_LENGTH,
  A26_PROFILE_HANDLE_MAX_LENGTH,
  A26_PROFILE_NAME_MAX_LENGTH,
  a26ProfileMomentStat,
  a26ProfileStatsLayout,
  a26ProfileUpdateErrorMessage,
  formatA26ProfileStatCount,
  flattenA26ProfilePages,
  hasA26ProfileDraftErrors,
  normalizeA26ProfileDraft,
  validateA26ProfileDraft,
} from "@/lib/a26-profile";
import {
  batch1OperationIdentityMatches,
  batch1OperationKey,
  createBatch1OperationGuard,
  createBatch1OperationInstance,
  type Batch1OperationScope,
} from "@/lib/batch1-mutation-feedback";
import { ownProfileEditorScope } from "../lib/parity27-chat-editor-state";
import { invalidateProfileViews } from "@/lib/source-query-invalidation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppShell } from "./app-shell";
import { PostCard } from "./post-card";
import { StatusMessage } from "./status-message";
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
  saveError,
  onClose,
  onSave,
  onDraftChange,
}: {
  profile: { name: string; handle: string; bio?: string | null };
  editorOuterPadding: number;
  topInset: number;
  bottomInset: number;
  saving: boolean;
  saveError: string | null;
  onClose: () => void;
  onSave: (draft: { name: string; handle: string; bio: string }) => void;
  onDraftChange: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [handle, setHandle] = useState(profile.handle);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [errors, setErrors] = useState<{
    name?: string;
    handle?: string;
    bio?: string;
  }>({});

  function updateDraftField(field: "name" | "handle" | "bio", value: string) {
    if (field === "name") setName(value);
    if (field === "handle") setHandle(value);
    if (field === "bio") setBio(value);
    setErrors((current) =>
      current[field] ? { ...current, [field]: undefined } : current,
    );
    onDraftChange();
  }

  function submitDraft() {
    const draft = normalizeA26ProfileDraft({ name, handle, bio });
    const nextErrors = validateA26ProfileDraft(draft);
    setErrors(nextErrors);
    if (hasA26ProfileDraftErrors(nextErrors)) return;
    onSave(draft);
  }

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
            <Input
              label="YOUR NAME"
              value={name}
              onChangeText={(value) => updateDraftField("name", value)}
              maxLength={A26_PROFILE_NAME_MAX_LENGTH}
              accessibilityHint={
                errors.name ?? "Required. Up to 120 characters."
              }
            />
            <StatusMessage message={errors.name} tone="error" />
            <Input
              label="YOUR HANDLE"
              value={handle}
              onChangeText={(value) => updateDraftField("handle", value)}
              placeholder="letters, numbers, underscores"
              maxLength={A26_PROFILE_HANDLE_MAX_LENGTH}
              accessibilityHint={
                errors.handle ??
                "Two to 48 characters. Use letters, numbers, underscores, periods, or hyphens."
              }
            />
            <StatusMessage message={errors.handle} tone="error" />
            <Input
              label="A LITTLE ABOUT YOU"
              value={bio}
              onChangeText={(value) => updateDraftField("bio", value)}
              multiline
              maxLength={A26_PROFILE_BIO_MAX_LENGTH}
              accessibilityHint={errors.bio ?? "Up to 2,000 characters."}
            />
            <StatusMessage message={errors.bio} tone="error" />
            <StatusMessage message={saveError} tone="error" />
            <Button
              title="Save profile"
              onPress={submitDraft}
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
  onRefetch,
  requireAuth,
  notify,
}: {
  accountId: number | null;
  target: FollowTarget;
  onRefetch: () => void;
  requireAuth: (action: () => void) => void;
  notify: (message: string, tone?: StatusTone) => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const follow = trpc.social.follow.useMutation();
  const direct = trpc.social.openDirect.useMutation();
  const mountedRef = useRef(false);
  const scopeRef = useRef<Batch1OperationScope | null>(null);
  const [operationInstance] = useState(() => createBatch1OperationInstance());
  const [followGuard] = useState(() => createBatch1OperationGuard());
  const [directGuard] = useState(() => createBatch1OperationGuard());
  const [pendingFollowScope, setPendingFollowScope] =
    useState<Batch1OperationScope | null>(null);
  const [pendingDirectScope, setPendingDirectScope] =
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

  function requestDirectMessage() {
    const startDirectMessage = () => {
      const scope = scopeRef.current;
      if (!scope) return;

      void directGuard.run(scope, async () => {
        setPendingDirectScope(scope);
        try {
          const result = await direct.mutateAsync({ userId: target.id });
          if (!followScopeIsCurrent(scope)) return;
          router.push(
            `/chat/${result.id}?name=${encodeURIComponent(target.name || "Conversation")}`,
          );
        } catch {
          if (!followScopeIsCurrent(scope)) return;
          notify(
            "We couldn’t open a conversation. Check your connection and try again.",
            "error",
          );
        } finally {
          if (!followScopeIsCurrent(scope)) return;
          setPendingDirectScope((current) =>
            current && batch1OperationKey(current) === batch1OperationKey(scope)
              ? null
              : current,
          );
        }
      });
    };

    requireAuth(startDirectMessage);
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
  const directPending =
    pendingDirectScope !== null &&
    batch1OperationIdentityMatches(pendingDirectScope, identity);
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
          disabled={followPending || directPending}
          onPress={requestFollow}
          style={{ flex: 1 }}
        />
        <Button
          title={directPending ? "Opening conversation…" : "Say hello"}
          accessibilityLabel={`Open a direct conversation with ${target.name}`}
          icon="chatbubble-outline"
          secondary
          loading={directPending}
          disabled={followPending || directPending}
          onPress={requestDirectMessage}
          style={{ flex: 1 }}
        />
      </View>
      {visibleFollowError && (
        <StatusMessage
          message={visibleFollowError}
          tone="error"
          style={{ color: C.secondary, fontSize: 12, lineHeight: 18 }}
        />
      )}
    </View>
  );
}

function OwnProfileActions({
  accountId,
  profile,
  profileEditorScope,
  compactOwnProfileActions,
  editorOuterPadding,
  topInset,
  bottomInset,
  requireAuth,
  notify,
  refetchProfile,
}: {
  accountId: number;
  profile: { id: number; name: string; handle: string; bio?: string | null };
  profileEditorScope: string;
  compactOwnProfileActions: boolean;
  editorOuterPadding: number;
  topInset: number;
  bottomInset: number;
  requireAuth: (action: () => void) => void;
  notify: (message: string, tone?: StatusTone) => void;
  refetchProfile: () => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [editScope, setEditScope] = useState<string | null>(null);
  const [profileUpdateError, setProfileUpdateError] = useState<{
    scope: Batch1OperationScope;
    message: string;
  } | null>(null);
  const [pendingProfileUpdateScope, setPendingProfileUpdateScope] =
    useState<Batch1OperationScope | null>(null);
  const [profileUpdateInstance] = useState(() =>
    createBatch1OperationInstance(),
  );
  const [profileUpdateGuard] = useState(() => createBatch1OperationGuard());
  const profileUpdateScopeRef = useRef<Batch1OperationScope | null>(null);
  const profileUpdateIdentity = useMemo(
    () =>
      profileUpdateInstance.createIdentity(accountId, `profile:${profile.id}`),
    [accountId, profile.id, profileUpdateInstance],
  );
  const updateMutation = trpc.social.updateProfile.useMutation();

  function profileUpdateScopeIsCurrent(scope: Batch1OperationScope): boolean {
    return profileUpdateInstance.isCurrent(scope);
  }

  useEffect(() => {
    const scope = profileUpdateInstance.activate(profileUpdateIdentity);
    profileUpdateScopeRef.current = scope;

    return () => {
      profileUpdateInstance.deactivate(scope);
      if (
        scope &&
        profileUpdateScopeRef.current?.instanceId === scope.instanceId
      ) {
        profileUpdateScopeRef.current = null;
      }
    };
  }, [profileUpdateIdentity, profileUpdateInstance]);

  function saveOwnProfile(draft: {
    name: string;
    handle: string;
    bio: string;
  }) {
    const scope = profileUpdateScopeRef.current;
    if (!scope || !profileUpdateScopeIsCurrent(scope)) return;

    void profileUpdateGuard.run(scope, async () => {
      if (!profileUpdateScopeIsCurrent(scope)) return;
      setPendingProfileUpdateScope(scope);
      setProfileUpdateError(null);
      try {
        await updateMutation.mutateAsync(draft);
        if (!profileUpdateScopeIsCurrent(scope)) return;
        setEditScope(null);
        setProfileUpdateError(null);
        refetchProfile();
        void invalidateProfileViews(utils);
        notify("Your profile feels a little more you.", "success");
      } catch (error) {
        if (!profileUpdateScopeIsCurrent(scope)) return;
        setProfileUpdateError({
          scope,
          message: a26ProfileUpdateErrorMessage(error),
        });
      } finally {
        if (!profileUpdateScopeIsCurrent(scope)) return;
        setPendingProfileUpdateScope((current) =>
          current && batch1OperationKey(current) === batch1OperationKey(scope)
            ? null
            : current,
        );
      }
    });
  }

  const editorOpen = editScope === profileEditorScope;
  const profileUpdatePending =
    pendingProfileUpdateScope !== null &&
    batch1OperationIdentityMatches(
      pendingProfileUpdateScope,
      profileUpdateIdentity,
    );
  const visibleProfileUpdateError =
    profileUpdateError &&
    batch1OperationIdentityMatches(
      profileUpdateError.scope,
      profileUpdateIdentity,
    )
      ? profileUpdateError.message
      : null;

  return (
    <>
      <View
        testID="profile-own-actions"
        style={{
          marginTop: compactOwnProfileActions ? 12 : 36,
          gap: 7,
          alignItems: compactOwnProfileActions ? "stretch" : "flex-end",
          width: compactOwnProfileActions ? "100%" : undefined,
          minWidth: 0,
        }}
      >
        <Button
          title="Edit profile"
          secondary
          onPress={() => {
            setProfileUpdateError(null);
            setEditScope(profileEditorScope);
          }}
          style={{
            borderRadius: 9,
            width: compactOwnProfileActions ? "100%" : undefined,
          }}
        />
        <Button
          title="Edit interests"
          secondary
          onPress={() => router.push("/onboarding?edit=1")}
          style={{
            borderRadius: 9,
            width: compactOwnProfileActions ? "100%" : undefined,
          }}
        />
        <Button
          title="Connect email sign-in"
          secondary
          onPress={() => requireAuth(() => router.push("/account/email"))}
          style={{
            borderRadius: 9,
            width: compactOwnProfileActions ? "100%" : undefined,
          }}
        />
      </View>
      {editorOpen && (
        <ProfileEditModal
          key={profileEditorScope}
          profile={profile}
          editorOuterPadding={editorOuterPadding}
          topInset={topInset}
          bottomInset={bottomInset}
          saving={profileUpdatePending}
          saveError={visibleProfileUpdateError}
          onClose={() => {
            setEditScope(null);
            setProfileUpdateError(null);
          }}
          onSave={(draft) => requireAuth(() => saveOwnProfile(draft))}
          onDraftChange={() => setProfileUpdateError(null)}
        />
      )}
    </>
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
  const { width, fontScale } = useWindowDimensions();
  const editorOuterPadding = width <= 360 ? 16 : 24;
  const compactOwnProfileActions = width <= 360 || fontScale >= 1.2;
  const own = !personId || personId === user?.id;
  const profile = trpc.social.profile.useQuery(
    personId ? { id: personId } : getA26OwnProfileQueryInput(user?.id),
    { enabled: !invalidPersonRoute && (!!personId || !!user) },
  );
  const [tab, setTab] = useState<"Moments" | "Saved">("Moments");
  const p =
    !own ||
    (profile.data && isA26CurrentActorProfile(user?.id, profile.data.id))
      ? profile.data
      : undefined;
  const feed = trpc.social.feedPage.useInfiniteQuery(
    {
      filter: own && tab === "Saved" ? "saved" : "for-you",
      authorId: own && tab === "Saved" ? undefined : p?.id,
      limit: 20,
    },
    {
      enabled: !!p,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  const accountId = user?.id ?? null;
  const profileResourceId = p ? `profile:${p.id}` : null;
  const profileEditorScope = ownProfileEditorScope({
    accountId,
    profileId: p?.id,
    ownsProfile: own,
  });
  const loadedPosts = flattenA26ProfilePages(feed.data?.pages);
  const posts = loadedPosts.filter(
    (post) => (own && tab === "Saved") || post.author.id === p?.id,
  );
  const feedDisplayState = resolvePagedDisplayState({
    isLoading: feed.isLoading,
    isError: feed.isError,
    hasContent: posts.length > 0 || !!feed.hasNextPage,
    isFetchingNextPage: feed.isFetchingNextPage,
    isFetchNextPageError: feed.isFetchNextPageError,
    isRefetchError: feed.isRefetchError,
    error: feed.error,
  });
  const momentStat = a26ProfileMomentStat({
    tab,
    loadedCount: posts.length,
    hasNextPage: !!feed.hasNextPage,
    isInitialLoading: feed.isLoading && !posts.length,
    hasInitialError: feed.isError && !posts.length,
  });
  const statsLayout = a26ProfileStatsLayout(width, fontScale);
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
                    notify("You’re signed out. See you soon.", "success");
                  } catch {
                    notify(
                      "Signed out locally, but remote session revocation could not be confirmed.",
                      "error",
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
          <View
            testID="profile-hero"
            style={[
              s.between,
              {
                marginTop: -37,
                paddingHorizontal: 18,
                gap: 12,
                flexWrap: compactOwnProfileActions ? "wrap" : "nowrap",
                alignItems: compactOwnProfileActions
                  ? "flex-start"
                  : "flex-end",
              },
            ]}
          >
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
            {own && profileEditorScope && accountId !== null && (
              <OwnProfileActions
                key={profileEditorScope}
                accountId={accountId}
                profile={p}
                profileEditorScope={profileEditorScope}
                compactOwnProfileActions={compactOwnProfileActions}
                editorOuterPadding={editorOuterPadding}
                topInset={insets.top}
                bottomInset={insets.bottom}
                requireAuth={requireAuth}
                notify={notify}
                refetchProfile={() => void profile.refetch()}
              />
            )}
          </View>
          <View style={{ paddingVertical: 16, gap: 10, minWidth: 0 }}>
            <T testID="profile-name" style={[s.title, { flexShrink: 1 }]}>
              {p.name}
            </T>
            <T style={{ color: C.muted, fontSize: 12 }}>@{p.handle}</T>
            <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
              {p.bio || "A new face. A new connection."}
            </T>
            <View
              testID="profile-stats"
              style={{
                marginVertical: 8,
                alignItems: "flex-start",
                ...statsLayout.container,
              }}
            >
              {[
                { key: "moments", ...momentStat },
                {
                  key: "followers",
                  displayValue: formatA26ProfileStatCount(p.followers),
                  label: "followers",
                  accessibilityLabel: `${p.followers} followers`,
                },
                {
                  key: "following",
                  displayValue: formatA26ProfileStatCount(p.following),
                  label: "following",
                  accessibilityLabel: `${p.following} following`,
                },
              ].map((stat) => (
                <View
                  key={stat.key}
                  testID={`profile-stat-${stat.key}`}
                  accessible
                  accessibilityLabel={stat.accessibilityLabel}
                  style={statsLayout.item}
                >
                  <T style={{ fontWeight: "800", fontSize: 20 }}>
                    {stat.displayValue}
                  </T>
                  <T style={{ color: C.muted, fontSize: 12 }}>{stat.label}</T>
                </View>
              ))}
            </View>
            {!own && (
              <ProfileFollowActions
                key={`${accountId ?? "anonymous"}:${profileResourceId ?? "none"}`}
                accountId={accountId}
                target={p}
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
          {feedDisplayState.kind === "loading" ? (
            <Loading />
          ) : feedDisplayState.kind === "error" ? (
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
          ) : feedDisplayState.kind === "empty" ? (
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
            <>
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
              {feedDisplayState.showRetainedError ? (
                <View style={{ gap: 8, marginTop: 14 }}>
                  <StatusMessage
                    testID="profile-feed-retained-error"
                    tone="error"
                    message={
                      feedDisplayState.retryMode === "next"
                        ? "We couldn’t load more moments. Your loaded moments are still here."
                        : "We couldn’t refresh these moments. Your loaded moments are still here."
                    }
                  />
                  <Button
                    title={
                      feedDisplayState.retryMode === "next"
                        ? "Try loading more"
                        : "Refresh moments"
                    }
                    secondary
                    loading={
                      feedDisplayState.retryMode === "next"
                        ? feed.isFetchingNextPage
                        : feed.isRefetching
                    }
                    onPress={() => {
                      if (feedDisplayState.retryMode === "next") {
                        void feed.fetchNextPage();
                        return;
                      }
                      void feed.refetch();
                    }}
                    style={{ alignSelf: "flex-start" }}
                  />
                </View>
              ) : feed.hasNextPage ? (
                <Button
                  title="Load more moments"
                  secondary
                  loading={feed.isFetchingNextPage}
                  onPress={() => void feed.fetchNextPage()}
                  style={{ alignSelf: "center", marginVertical: 14 }}
                />
              ) : (
                <View
                  testID="profile-feed-end"
                  accessible
                  accessibilityLabel={`${posts.length} ${tab === "Saved" ? "saved moments" : "moments"} loaded. End of list.`}
                  style={{ alignItems: "center", paddingVertical: 14 }}
                >
                  <T style={{ color: C.secondary, fontSize: 12 }}>
                    {`All ${posts.length} ${tab === "Saved" ? "saved moments" : "moments"} loaded.`}
                  </T>
                </View>
              )}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
