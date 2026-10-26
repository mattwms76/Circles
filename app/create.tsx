import { useEffect, useMemo, useRef, useState } from "react";
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
  batch1OperationIdentityMatches,
  batch1OperationKey,
  createBatch1OperationGuard,
  createBatch1OperationInstance,
  type Batch1OperationScope,
} from "@/lib/batch1-mutation-feedback";
import {
  isCircleCoverMime,
  mediaUploadKey,
  normalizeCreateMode,
  parsePositiveSafeId,
  reusableUploadUrl,
  validateComposerDraft,
  type CreateMode,
  type ReusableUpload,
} from "@/lib/feed-ui-helpers";
import {
  Button,
  C,
  Empty,
  Icon,
  IconButton,
  Input,
  photo,
  s,
  T,
  Wordmark,
  type IconName,
} from "@/components/circles-ui";
import { UserAvatar } from "@/components/user-avatar";
import { INTRODUCTION_DRAFT } from "@/shared/onboarding";
import { canPrefillIntroduction } from "@/lib/onboarding-introduction";
import {
  invalidateCircleDirectories,
  invalidatePostFeeds,
} from "@/lib/source-query-invalidation";
import {
  platformCreationIssue,
  platformUploadLimitMb,
} from "@/lib/platform-feature-ui";

type ComposerPublishSnapshot = {
  mode: CreateMode;
  text: string;
  name: string;
  category: string;
  privacy: "public" | "private";
  circleId: number | undefined;
  asset: ImagePicker.ImagePickerAsset | null;
  reusableUpload: ReusableUpload | null;
  liveThumbnail: string;
};

type ComposerPublishError = {
  scope: Batch1OperationScope;
  message: string;
};

function composerResourceId(mode: CreateMode, circleId: number | undefined) {
  return `composer:${mode}:${circleId ?? "everyone"}`;
}

function ComposerPill({
  title,
  selected = false,
  onPress,
  icon,
  disabled = false,
}: {
  title: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          paddingHorizontal: 15,
          paddingVertical: 9,
          minHeight: 44,
          borderRadius: 24,
          backgroundColor: selected ? C.ink : C.paper,
          borderWidth: 1,
          borderColor: selected ? C.ink : C.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          opacity: disabled ? 0.55 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon && (
        <Icon name={icon} size={15} color={selected ? "#fff" : C.secondary} />
      )}
      <T
        style={{
          fontSize: 12,
          fontWeight: "600",
          lineHeight: 18,
          color: selected ? "#fff" : C.secondary,
        }}
      >
        {title}
      </T>
    </Pressable>
  );
}

export default function CreateScreen() {
  const { user } = useCircles();

  return <CreateScreenForAccount key={user?.id ?? "anonymous"} />;
}

function CreateScreenForAccount() {
  const params = useLocalSearchParams<{
    mode?: string | string[];
    circleId?: string | string[];
    intro?: string | string[];
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, authState, requireAuth, notify, showLogin } = useCircles();
  const [mode, setMode] = useState<CreateMode>(() =>
    normalizeCreateMode(params.mode),
  );
  const [draftText, setDraftText] = useState("");
  const [textEdited, setTextEdited] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Lifestyle");
  const [privacy, setPrivacy] = useState<"public" | "private">("public");
  const [circleId, setCircleId] = useState<number | undefined>(() =>
    parsePositiveSafeId(params.circleId),
  );
  const introductionRequested =
    params.intro === "1" && mode === "post" && !!circleId;
  const introductionTarget = trpc.onboarding.introductionTarget.useQuery(
    { circleId: circleId ?? 1 },
    {
      enabled: introductionRequested && authState === "authenticated",
      staleTime: 0,
      refetchOnMount: "always",
      retry: false,
    },
  );
  const verifiedIntroduction = canPrefillIntroduction({
    requested: introductionRequested,
    accountId: authState === "authenticated" ? user?.id : null,
    circleId,
    target: introductionTarget.data,
    confirmed:
      introductionTarget.isFetchedAfterMount &&
      !introductionTarget.isFetching &&
      !introductionTarget.isError,
  });
  const text =
    !textEdited && verifiedIntroduction ? INTRODUCTION_DRAFT : draftText;
  function setText(value: string) {
    if (draftEditingLocked()) return;
    setTextEdited(true);
    setDraftText(value);
  }
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [reusableUpload, setReusableUpload] = useState<ReusableUpload | null>(
    null,
  );
  const mountedRef = useRef(false);
  const scopeRef = useRef<Batch1OperationScope | null>(null);
  const [operationInstance] = useState(() => createBatch1OperationInstance());
  const [publishGuard] = useState(() => createBatch1OperationGuard());
  const [composerRevision, setComposerRevision] = useState(0);
  const [pendingPublishScope, setPendingPublishScope] =
    useState<Batch1OperationScope | null>(null);
  const [publishError, setPublishError] = useState<ComposerPublishError | null>(
    null,
  );
  const accountId = user?.id ?? null;
  const currentComposerResourceId = composerResourceId(mode, circleId);
  const composerIdentity = useMemo(
    () =>
      operationInstance.createIdentity(
        accountId,
        currentComposerResourceId,
        composerRevision,
      ),
    [accountId, composerRevision, currentComposerResourceId, operationInstance],
  );
  const isPublishing =
    pendingPublishScope !== null &&
    batch1OperationIdentityMatches(pendingPublishScope, composerIdentity);
  const visiblePublishError =
    publishError &&
    batch1OperationIdentityMatches(publishError.scope, composerIdentity)
      ? publishError.message
      : null;

  useEffect(() => {
    mountedRef.current = true;
    const scope = operationInstance.activate(composerIdentity);
    scopeRef.current = scope;
    return () => {
      mountedRef.current = false;
      operationInstance.deactivate(scope);
      if (scopeRef.current?.instanceId === scope?.instanceId) {
        scopeRef.current = null;
      }
    };
  }, [composerIdentity, operationInstance]);

  const circles = trpc.social.circles.useQuery({});
  const profile = trpc.social.profile.useQuery({}, { enabled: !!user });
  const utils = trpc.useUtils();
  const upload = trpc.social.upload.useMutation();
  const post = trpc.social.createPost.useMutation();
  const circle = trpc.social.createCircle.useMutation();
  const live = trpc.live.create.useMutation();
  const platformStatus = trpc.platform.status.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  const visiblePlatformStatus = platformStatus.isError
    ? undefined
    : platformStatus.data;
  const creationIssue = platformCreationIssue(
    visiblePlatformStatus,
    mode,
    !!asset,
  );
  const maxUploadMb = platformUploadLimitMb(visiblePlatformStatus);

  function publishScopeIsCurrent(scope: Batch1OperationScope): boolean {
    return mountedRef.current && operationInstance.isCurrent(scope);
  }

  function draftEditingLocked(): boolean {
    const scope = scopeRef.current;
    return !!scope && publishGuard.isActive(scope);
  }

  function changeName(value: string) {
    if (draftEditingLocked()) return;
    setName(value);
  }

  function changeCategory(value: string) {
    if (draftEditingLocked()) return;
    setCategory(value);
  }

  function changePrivacy(value: "public" | "private") {
    if (draftEditingLocked()) return;
    setPrivacy(value);
  }

  function changeCircleId(value: number | undefined) {
    if (draftEditingLocked()) return;
    if (value !== circleId) setComposerRevision((current) => current + 1);
    setCircleId(value);
  }

  function clearSelectedMedia() {
    setAsset(null);
    setReusableUpload(null);
  }

  function selectMode(nextMode: CreateMode) {
    if (draftEditingLocked()) return;
    const issue = platformCreationIssue(
      visiblePlatformStatus,
      nextMode,
      !!asset,
    );
    if (issue) {
      notify(issue);
      return;
    }
    if (nextMode === "circle" && asset) {
      try {
        if (!isCircleCoverMime(supportedMime(asset))) {
          clearSelectedMedia();
          notify(
            "Circle covers need a JPEG, PNG, or WebP photo. The video was removed.",
          );
        }
      } catch (error) {
        clearSelectedMedia();
        notify(
          error instanceof Error
            ? error.message
            : "Choose a supported cover photo for your circle.",
        );
      }
    }
    if (nextMode !== mode) setComposerRevision((current) => current + 1);
    setMode(nextMode);
  }

  async function pickMedia() {
    if (draftEditingLocked()) return;
    const issue = platformCreationIssue(visiblePlatformStatus, mode, true);
    if (issue) {
      notify(issue);
      return;
    }
    const scope = scopeRef.current;
    if (!scope) return;
    const pickerSnapshot = {
      scope,
      mode,
      maxUploadMb,
    };
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes:
          pickerSnapshot.mode === "circle" ? ["images"] : ["images", "videos"],
        quality: 0.8,
        base64: true,
      });
      if (!publishScopeIsCurrent(pickerSnapshot.scope)) return;
      if (!result.canceled) {
        const nextAsset = result.assets[0];
        if (
          nextAsset.fileSize &&
          nextAsset.fileSize > pickerSnapshot.maxUploadMb * 1024 * 1024
        ) {
          notify(
            `Choose media no larger than ${pickerSnapshot.maxUploadMb} MiB.`,
          );
          return;
        }
        const mimeType = supportedMime(nextAsset);
        if (pickerSnapshot.mode === "circle" && !isCircleCoverMime(mimeType)) {
          notify("Circle covers need a JPEG, PNG, or WebP photo.");
          return;
        }
        setAsset(nextAsset);
        // A changed selection cannot safely reuse the prior upload URL.
        setReusableUpload(null);
      }
    } catch (error) {
      if (!publishScopeIsCurrent(pickerSnapshot.scope)) return;
      notify(
        error instanceof Error
          ? error.message
          : "Photo library could not open. Check your device permissions.",
      );
    }
  }
  async function uploadAsset(
    snapshot: ComposerPublishSnapshot,
    scope: Batch1OperationScope,
  ): Promise<string | undefined | null> {
    if (!snapshot.asset) return undefined;
    const mimeType = supportedMime(snapshot.asset);
    if (snapshot.mode === "circle" && !isCircleCoverMime(mimeType)) {
      throw new Error("Circle covers need a JPEG, PNG, or WebP photo.");
    }
    const key = mediaUploadKey({
      uri: snapshot.asset.uri,
      mimeType,
      fileSize: snapshot.asset.fileSize,
    });
    const previousUrl = reusableUploadUrl(snapshot.reusableUpload, key);
    if (previousUrl) return previousUrl;

    const base64 = await assetBase64(snapshot.asset);
    if (!publishScopeIsCurrent(scope)) return null;
    const result = await upload.mutateAsync({
      base64,
      mimeType,
    });
    if (!publishScopeIsCurrent(scope)) return null;
    // Keep the canonical URL only for this exact selected asset. A failed
    // subsequent publish can retry without duplicating media; the client never
    // deletes an upload because it cannot prove that it is still unreferenced.
    setReusableUpload({ key, url: result.url });
    return result.url;
  }

  async function publishAfterAuth(
    scope: Batch1OperationScope,
    snapshot: ComposerPublishSnapshot,
  ) {
    const validationError = validateComposerDraft({
      mode: snapshot.mode,
      text: snapshot.text,
      name: snapshot.name,
      category: snapshot.category,
      hasMedia: !!snapshot.asset,
    });
    if (validationError) {
      if (publishScopeIsCurrent(scope)) {
        setPublishError({ scope, message: validationError });
        notify(validationError);
      }
      return;
    }
    if (
      snapshot.mode === "live" &&
      Platform.OS !== "web" &&
      Constants.executionEnvironment === "storeClient"
    ) {
      const message =
        "Live broadcasting needs a Circles development or release build. Expo Go can preview the social screens.";
      if (publishScopeIsCurrent(scope)) {
        setPublishError({ scope, message });
        notify(message);
      }
      return;
    }
    try {
      const currentStatus = await platformStatus.refetch();
      if (!publishScopeIsCurrent(scope)) return;
      const issue = platformCreationIssue(
        currentStatus.isError ? undefined : currentStatus.data,
        snapshot.mode,
        !!snapshot.asset,
      );
      if (issue) throw new Error(issue);
      const media = await uploadAsset(snapshot, scope);
      if (media === null || !publishScopeIsCurrent(scope)) return;
      if (snapshot.mode === "post") {
        await post.mutateAsync({
          text: snapshot.text.trim(),
          media,
          mediaType: snapshot.asset
            ? snapshot.asset.type === "video"
              ? "video"
              : "photo"
            : "text",
          circleId: snapshot.circleId,
        });
        if (!publishScopeIsCurrent(scope)) return;
        void invalidatePostFeeds(utils);
        notify("Your moment is out in the world.");
        router.back();
      } else if (snapshot.mode === "circle") {
        const result = await circle.mutateAsync({
          name: snapshot.name.trim(),
          description: snapshot.text.trim(),
          category: snapshot.category,
          privacy: snapshot.privacy,
          image:
            media ||
            (snapshot.category === "Outdoors" ? photo.mountains : photo.coffee),
          color: C.sage,
        });
        if (!publishScopeIsCurrent(scope)) return;
        void invalidateCircleDirectories(utils);
        notify("A new circle. A new beginning.");
        router.replace(`/circle/${result.id}`);
      } else {
        const result = await live.mutateAsync({
          title: snapshot.name.trim(),
          circleId: snapshot.circleId,
          thumbnail: media || snapshot.liveThumbnail,
        });
        if (!publishScopeIsCurrent(scope)) return;
        router.replace(`/live/${result.id}?host=1`);
      }
    } catch (e) {
      if (!publishScopeIsCurrent(scope)) return;
      const message =
        e instanceof Error
          ? e.message
          : snapshot.reusableUpload
            ? "Could not share. Your media is ready to reuse when you try again."
            : "Could not share. Please try again.";
      setPublishError({ scope, message });
      notify(message);
    }
  }

  function publish() {
    const startPublish = () => {
      const scope = scopeRef.current;
      if (!scope) return;
      const snapshot: ComposerPublishSnapshot = {
        mode,
        text,
        name,
        category,
        privacy,
        circleId,
        asset,
        reusableUpload,
        liveThumbnail: profile.data?.avatar || photo.mountains,
      };

      void publishGuard.run(scope, async () => {
        setPendingPublishScope(scope);
        setPublishError((current) =>
          current &&
          batch1OperationKey(current.scope) === batch1OperationKey(scope)
            ? null
            : current,
        );
        try {
          await publishAfterAuth(scope, snapshot);
        } finally {
          if (!publishScopeIsCurrent(scope)) return;
          setPendingPublishScope((current) =>
            current && batch1OperationKey(current) === batch1OperationKey(scope)
              ? null
              : current,
          );
        }
      });
    };
    requireAuth(startPublish);
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
          onPress={() => {
            if (draftEditingLocked()) return;
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/");
            }
          }}
          label="Close composer"
          disabled={isPublishing}
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
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <ComposerPill
              title="Post"
              icon="image-outline"
              selected={mode === "post"}
              onPress={() => selectMode("post")}
              disabled={isPublishing}
            />
            <ComposerPill
              title="Circle"
              icon="ellipse-outline"
              selected={mode === "circle"}
              onPress={() => selectMode("circle")}
              disabled={isPublishing}
            />
            <ComposerPill
              title="Go live"
              icon="radio-outline"
              selected={mode === "live"}
              onPress={() => selectMode("live")}
              disabled={isPublishing}
            />
          </View>
          {creationIssue && user && (
            <View
              style={[s.card, { padding: 14, gap: 8 }]}
              accessibilityLiveRegion="polite"
            >
              <T>{creationIssue}</T>
              <Button
                title="Check availability"
                secondary
                onPress={() => {
                  void platformStatus.refetch();
                }}
                disabled={isPublishing}
              />
            </View>
          )}
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
                <UserAvatar
                  uri={profile.data?.avatar}
                  name={user.name || ""}
                  size={44}
                  userId={user.id}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T
                    style={{ fontWeight: "700", flexShrink: 1 }}
                    numberOfLines={2}
                  >
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
                  onChangeText={changeName}
                  label={
                    mode === "circle" ? "CIRCLE NAME" : "LIVE SESSION TITLE"
                  }
                  placeholder={
                    mode === "circle"
                      ? "e.g. Sunday Coffee Club"
                      : "What are we talking about?"
                  }
                  editable={!isPublishing}
                  accessibilityState={{ disabled: isPublishing }}
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
                editable={!isPublishing}
                accessibilityState={{ disabled: isPublishing }}
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
                      <ComposerPill
                        key={item}
                        title={item}
                        selected={category === item}
                        onPress={() => changeCategory(item)}
                        disabled={isPublishing}
                      />
                    ))}
                  </View>
                  <T style={s.eyebrow}>WHO CAN JOIN?</T>
                  <View style={[s.row, { gap: 9, flexWrap: "wrap" }]}>
                    <ComposerPill
                      title="Public · anyone can join"
                      icon="globe-outline"
                      selected={privacy === "public"}
                      onPress={() => changePrivacy("public")}
                      disabled={isPublishing}
                    />
                    <ComposerPill
                      title="Private · approval needed"
                      icon="lock-closed-outline"
                      selected={privacy === "private"}
                      onPress={() => changePrivacy("private")}
                      disabled={isPublishing}
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
                    <ComposerPill
                      title="Everyone"
                      selected={!circleId}
                      onPress={() => changeCircleId(undefined)}
                      disabled={isPublishing}
                    />
                    {circles.data
                      ?.filter((item) => item.joined)
                      .map((item) => (
                        <ComposerPill
                          key={item.id}
                          title={item.name}
                          selected={circleId === item.id}
                          onPress={() => changeCircleId(item.id)}
                          disabled={isPublishing}
                        />
                      ))}
                  </ScrollView>
                </>
              )}
              {mode !== "live" && (
                <Pressable
                  onPress={pickMedia}
                  accessibilityRole="button"
                  accessibilityLabel={
                    asset
                      ? `Change selected ${asset.type === "video" ? "video" : "photo"}`
                      : `Add ${mode === "circle" ? "a cover photo" : "a photo or video"}`
                  }
                  accessibilityState={{ disabled: isPublishing }}
                  disabled={isPublishing}
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
                    opacity: isPublishing ? 0.55 : 1,
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
                        JPEG, PNG, WebP or MP4 · up to {maxUploadMb} MiB
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
              {visiblePublishError && (
                <View
                  accessibilityLiveRegion="polite"
                  style={[s.card, { padding: 14, gap: 10 }]}
                >
                  <T
                    style={{ color: C.secondary, fontSize: 13, lineHeight: 19 }}
                  >
                    {visiblePublishError}
                  </T>
                  <Button
                    title="Try again"
                    secondary
                    disabled={isPublishing}
                    onPress={publish}
                  />
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
                loading={isPublishing}
                disabled={!!creationIssue || isPublishing}
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
