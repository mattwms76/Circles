import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  View,
  Pressable,
  Platform,
} from "react-native";
import Constants from "expo-constants";
import { Image } from "@/components/media-image";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import { StatusMessage } from "@/components/status-message";
import { assetBase64, supportedMime } from "@/lib/media";
import { validateA26PickedComposerMedia } from "../lib/a26-circle-ui";
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
  canPublishToCreateRecipient,
  canRetryCreateRecipient,
  createRootSafeAreaInsets,
  resolveCreateRecipient,
} from "@/lib/design31-create";
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
import { VideoRecorder } from "@/components/video-recorder";
import { RecordedVideoPreview } from "@/components/recorded-video-preview";
import type { RecordedVideoDraft } from "@/shared/recorded-video";
import {
  deleteRecordedVideo,
  recordedVideoBase64,
} from "@/lib/recorded-video-files";
import {
  createPostPublishAttemptTracker,
  isDefinitivePostPublishError,
} from "@/lib/post-publish-attempt";
import { postPublishErrorMessage } from "@/lib/post-publish-error";

type ComposerPublishSnapshot = {
  mode: CreateMode;
  text: string;
  name: string;
  category: string;
  privacy: "public" | "private";
  circleId: number | undefined;
  asset: ImagePicker.ImagePickerAsset | null;
  recordedDraft: RecordedVideoDraft | null;
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
  const params = useLocalSearchParams();
  const routeKey = JSON.stringify([params.mode, params.circleId, params.intro]);
  return (
    <CreateScreenForAccount key={`${user?.id ?? "anonymous"}:${routeKey}`} />
  );
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
  const [recordedDraft, setRecordedDraft] = useState<RecordedVideoDraft | null>(
    null,
  );
  const recordedDraftRef = useRef<RecordedVideoDraft | null>(null);
  const [recorderScope, setRecorderScope] =
    useState<Batch1OperationScope | null>(null);
  const focusedRef = useRef(false);
  const foregroundRef = useRef(AppState.currentState === "active");
  const [postAttempt] = useState(() => createPostPublishAttemptTracker());
  const [publishUncertain, setPublishUncertain] = useState(false);
  const [publishStage, setPublishStage] = useState<
    "uploading" | "publishing" | null
  >(null);
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
  const isDraftLocked = isPublishing || publishUncertain;

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      mountedRef.current = true;
      const scope = operationInstance.activate(composerIdentity);
      scopeRef.current = scope;
      return () => {
        focusedRef.current = false;
        mountedRef.current = false;
        operationInstance.deactivate(scope);
        if (scopeRef.current?.instanceId === scope?.instanceId) {
          scopeRef.current = null;
        }
        const owned = recordedDraftRef.current;
        recordedDraftRef.current = null;
        if (owned)
          void deleteRecordedVideo(owned.localUri).catch(() => undefined);
        setRecordedDraft(null);
        setAsset((current) => (owned ? null : current));
        setRecorderScope(null);
      };
    }, [composerIdentity, operationInstance, setRecorderScope]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      foregroundRef.current = state === "active";
      if (state !== "active") setRecorderScope(null);
    });
    return () => subscription.remove();
  }, []);

  const circles = trpc.social.circles.useQuery({});
  const recipient = resolveCreateRecipient({
    circleId,
    circles: circles.data,
    isResolving: circles.isPending || circles.isFetching,
    isError: circles.isError,
  });
  const recipientAllowsPublish =
    mode === "circle" || canPublishToCreateRecipient(recipient);
  const recipientCanRetry = canRetryCreateRecipient(recipient);
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
  const publicationStatus = trpc.social.publicationStatus.useQuery(undefined, {
    enabled: authState === "authenticated" && mode === "post",
    retry: false,
    staleTime: 0,
  });
  const publicationIssue =
    mode === "post" && user
      ? !publicationStatus.isFetchedAfterMount || publicationStatus.isFetching
        ? "Checking retry-safe publishing…"
        : publicationStatus.isError || publicationStatus.data?.ready !== true
          ? "Retry-safe publishing is not enabled yet. You can record and preview locally; Publish is unavailable until the reviewed database update is installed."
          : null
      : null;
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
    return (
      mountedRef.current &&
      focusedRef.current &&
      operationInstance.isCurrent(scope)
    );
  }

  function draftEditingLocked(): boolean {
    const scope = scopeRef.current;
    return (
      postAttempt.isUnsettled() || (!!scope && publishGuard.isActive(scope))
    );
  }

  function changeText(value: string) {
    if (draftEditingLocked()) return;
    setText(value);
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
    if (value !== circleId) {
      clearSelectedMedia();
      setRecorderScope(null);
      setComposerRevision((current) => current + 1);
    }
    setCircleId(value);
  }

  function clearSelectedMedia() {
    const owned = recordedDraftRef.current;
    recordedDraftRef.current = null;
    if (owned) void deleteRecordedVideo(owned.localUri).catch(() => undefined);
    setRecordedDraft(null);
    setAsset(null);
    setReusableUpload(null);
    postAttempt.clear();
  }

  function recordVideo() {
    if (
      draftEditingLocked() ||
      mode !== "post" ||
      authState !== "authenticated"
    )
      return;
    const scope = scopeRef.current;
    if (!scope || !foregroundRef.current || !publishScopeIsCurrent(scope))
      return;
    const issue = platformCreationIssue(visiblePlatformStatus, "post", true);
    if (issue) {
      notify(issue, "error");
      return;
    }
    setRecorderScope(scope);
  }

  function acceptRecording(
    draft: RecordedVideoDraft,
    scope: Batch1OperationScope,
  ) {
    if (
      !foregroundRef.current ||
      !publishScopeIsCurrent(scope) ||
      draftEditingLocked()
    ) {
      void deleteRecordedVideo(draft.localUri).catch(() => undefined);
      return;
    }
    clearSelectedMedia();
    recordedDraftRef.current = draft;
    setRecordedDraft(draft);
    setAsset({
      uri: draft.localUri,
      type: "video",
      mimeType: draft.mimeType,
      fileSize: draft.fileSize,
      duration: draft.durationMs,
      width: draft.width,
      height: draft.height,
    });
    setRecorderScope(null);
  }

  function selectMode(nextMode: CreateMode) {
    if (draftEditingLocked()) return;
    const issue = platformCreationIssue(
      visiblePlatformStatus,
      nextMode,
      !!asset,
    );
    if (issue) {
      notify(issue, "error");
      return;
    }
    if (nextMode === "circle" && asset) {
      try {
        if (!isCircleCoverMime(supportedMime(asset))) {
          clearSelectedMedia();
          notify(
            "Circle covers need a JPEG, PNG, or WebP photo. The video was removed.",
            "error",
          );
        }
      } catch {
        clearSelectedMedia();
        notify("Choose a supported cover photo for your circle.", "error");
      }
    }
    if (nextMode !== mode) {
      if (recordedDraftRef.current) clearSelectedMedia();
      setRecorderScope(null);
      setComposerRevision((current) => current + 1);
    }
    setMode(nextMode);
  }

  async function pickMedia() {
    if (draftEditingLocked()) return;
    const issue = platformCreationIssue(visiblePlatformStatus, mode, true);
    if (issue) {
      notify(issue, "error");
      return;
    }
    const scope = scopeRef.current;
    if (!scope) return;
    const pickerSnapshot = {
      scope,
      mode,
      maxUploadMb,
    };
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes:
          pickerSnapshot.mode === "circle" ? ["images"] : ["images", "videos"],
        quality: 0.8,
        base64: true,
      });
    } catch {
      if (!publishScopeIsCurrent(pickerSnapshot.scope)) return;
      notify(
        "Photo library could not open. Check your device permissions.",
        "error",
      );
      return;
    }

    if (!publishScopeIsCurrent(pickerSnapshot.scope)) return;
    if (!result.canceled) {
      const nextAsset = result.assets[0];
      const validation = validateA26PickedComposerMedia({
        asset: nextAsset,
        mode: pickerSnapshot.mode,
        maxUploadMb: pickerSnapshot.maxUploadMb,
      });
      if (validation.kind === "invalid") {
        notify(validation.message, "error");
        return;
      }
      clearSelectedMedia();
      setAsset(nextAsset);
      // A changed selection cannot safely reuse the prior upload URL.
      setReusableUpload(null);
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

    const base64 = snapshot.recordedDraft
      ? await recordedVideoBase64(
          snapshot.recordedDraft,
          maxUploadMb * 1024 * 1024,
        )
      : await assetBase64(snapshot.asset);
    if (!publishScopeIsCurrent(scope)) return null;
    const result = await upload.mutateAsync({
      base64,
      mimeType,
      ...(snapshot.recordedDraft
        ? {
            recording: {
              maxDurationSeconds: snapshot.recordedDraft.maxDurationSeconds,
            },
          }
        : {}),
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
        notify(validationError, "error");
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
        notify(message, "error");
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
      if (snapshot.mode === "post") {
        const status = await publicationStatus.refetch();
        if (!publishScopeIsCurrent(scope)) return;
        if (status.isError || status.data?.ready !== true) {
          throw new Error(
            "Retry-safe publishing is temporarily unavailable. Your local draft has been kept.",
          );
        }
      }
      setPublishStage("uploading");
      const media = await uploadAsset(snapshot, scope);
      if (media === null || !publishScopeIsCurrent(scope)) return;
      if (snapshot.mode === "post") {
        const attempt = postAttempt.prepare(
          {
            text: snapshot.text.trim(),
            media,
            mediaType: snapshot.asset
              ? snapshot.asset.type === "video"
                ? "video"
                : "photo"
              : "text",
            circleId: snapshot.circleId,
          },
          () => Crypto.randomUUID(),
        );
        postAttempt.markSubmitted();
        setPublishUncertain(true);
        setPublishStage("publishing");
        await post.mutateAsync(attempt);
        if (!publishScopeIsCurrent(scope)) return;
        postAttempt.clear();
        setPublishUncertain(false);
        clearSelectedMedia();
        void invalidatePostFeeds(utils);
        notify("Your moment is out in the world.", "success");
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
        notify("A new circle. A new beginning.", "success");
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
    } catch (error) {
      if (!publishScopeIsCurrent(scope)) return;
      const uncertain =
        snapshot.mode === "post" &&
        postAttempt.isUnsettled() &&
        !isDefinitivePostPublishError(error);
      if (!uncertain) postAttempt.reject();
      setPublishUncertain(uncertain);
      const message = uncertain
        ? "Publication hasn't been confirmed. Your draft is locked so Retry checks the same publication without creating another post."
        : postPublishErrorMessage(error);
      setPublishError({ scope, message });
      notify(message, "error");
    }
  }

  function publish() {
    if (!recipientAllowsPublish) return;

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
        recordedDraft,
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
          setPublishStage(null);
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
    <View
      style={[
        { flex: 1, backgroundColor: C.bg },
        createRootSafeAreaInsets(insets),
      ]}
    >
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
          disabled={isDraftLocked}
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
              disabled={isDraftLocked}
            />
            <ComposerPill
              title="Circle"
              icon="ellipse-outline"
              selected={mode === "circle"}
              onPress={() => selectMode("circle")}
              disabled={isDraftLocked}
            />
            <ComposerPill
              title="Go live"
              icon="radio-outline"
              selected={mode === "live"}
              onPress={() => selectMode("live")}
              disabled={isDraftLocked}
            />
          </View>
          {creationIssue && user && (
            <View style={[s.card, { padding: 14, gap: 8 }]}>
              <StatusMessage message={creationIssue} tone="error" />
              <Button
                title="Check availability"
                secondary
                onPress={() => {
                  void platformStatus.refetch();
                }}
                disabled={isDraftLocked}
              />
            </View>
          )}
          {publicationIssue && user && (
            <View style={[s.card, { padding: 14, gap: 8 }]}>
              <StatusMessage
                message={publicationIssue}
                tone={
                  publicationStatus.isFetching ||
                  !publicationStatus.isFetchedAfterMount
                    ? "info"
                    : "error"
                }
                testID="create-publication-readiness"
              />
              <Button
                title="Check publishing availability"
                secondary
                disabled={isPublishing || publicationStatus.isFetching}
                onPress={() => {
                  void publicationStatus.refetch();
                }}
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
                  editable={!isDraftLocked}
                  accessibilityState={{ disabled: isDraftLocked }}
                />
              )}
              <Input
                value={text}
                onChangeText={changeText}
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
                editable={!isDraftLocked}
                accessibilityState={{ disabled: isDraftLocked }}
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
                        disabled={isDraftLocked}
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
                      disabled={isDraftLocked}
                    />
                    <ComposerPill
                      title="Private · approval needed"
                      icon="lock-closed-outline"
                      selected={privacy === "private"}
                      onPress={() => changePrivacy("private")}
                      disabled={isDraftLocked}
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
                      disabled={isDraftLocked}
                    />
                    {circles.data
                      ?.filter((item) => item.joined)
                      .map((item) => (
                        <ComposerPill
                          key={item.id}
                          title={item.name}
                          selected={circleId === item.id}
                          onPress={() => changeCircleId(item.id)}
                          disabled={isDraftLocked}
                        />
                      ))}
                  </ScrollView>
                  {recipient.kind === "selected" && (
                    <T style={{ color: C.secondary, fontSize: 12 }}>
                      Selected circle: {recipient.name}.
                    </T>
                  )}
                  {recipient.kind === "resolving" && (
                    <StatusMessage
                      message="Finding your selected circle…"
                      tone="info"
                      testID="create-recipient-status"
                    />
                  )}
                  {recipient.kind === "error" && (
                    <View style={{ gap: 10 }}>
                      <StatusMessage
                        message="Couldn't load the selected circle. Retry or choose Everyone."
                        tone="error"
                        testID="create-recipient-status"
                      />
                      <Button
                        title="Retry selected circle"
                        secondary
                        disabled={isPublishing || !recipientCanRetry}
                        onPress={() => {
                          void circles.refetch();
                        }}
                      />
                    </View>
                  )}
                  {recipient.kind === "unavailable" && (
                    <StatusMessage
                      message="Selected circle is unavailable. Choose Everyone or another circle."
                      tone="error"
                      testID="create-recipient-status"
                    />
                  )}
                </>
              )}
              {mode === "post" && (
                <View style={{ gap: 10 }}>
                  {Platform.OS !== "web" ? (
                    <Button
                      title="Record video"
                      icon="videocam-outline"
                      secondary
                      disabled={isDraftLocked || !!creationIssue}
                      onPress={recordVideo}
                    />
                  ) : (
                    <T style={{ color: C.secondary, fontSize: 13 }}>
                      Record a 30- or 60-second clip in the iOS or Android app.
                      On web, upload an existing MP4 video.
                    </T>
                  )}
                  <T style={{ color: C.secondary, fontSize: 12 }}>
                    30s or 60s · 720p where supported · up to{" "}
                    {Math.min(20, maxUploadMb)} MiB. Capture may stop sooner at
                    the size limit.
                  </T>
                </View>
              )}
              {mode !== "live" && asset?.type === "video" && (
                <View style={[s.card, { padding: 14, gap: 12 }]}>
                  <RecordedVideoPreview
                    key={asset.uri}
                    uri={asset.uri}
                    disabled={isDraftLocked || recorderScope !== null}
                  />
                  {recordedDraft && (
                    <T style={{ fontSize: 12, color: C.secondary }}>
                      {(recordedDraft.durationMs / 1000).toFixed(1)}s ·{" "}
                      {recordedDraft.width} × {recordedDraft.height} ·{" "}
                      {(recordedDraft.fileSize / (1024 * 1024)).toFixed(1)} MiB
                    </T>
                  )}
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}
                  >
                    <Button
                      title="Change video"
                      secondary
                      disabled={isDraftLocked}
                      onPress={pickMedia}
                    />
                    {recordedDraft && Platform.OS !== "web" && (
                      <Button
                        title="Retake video"
                        secondary
                        disabled={isDraftLocked}
                        onPress={() => {
                          if (draftEditingLocked()) return;
                          clearSelectedMedia();
                          recordVideo();
                        }}
                      />
                    )}
                    <Button
                      title="Remove video"
                      secondary
                      disabled={isDraftLocked}
                      onPress={() => {
                        if (!draftEditingLocked()) clearSelectedMedia();
                      }}
                    />
                  </View>
                </View>
              )}
              {mode !== "live" && asset?.type !== "video" && (
                <Pressable
                  onPress={pickMedia}
                  accessibilityRole="button"
                  accessibilityLabel={
                    asset
                      ? "Change selected photo"
                      : `Add ${mode === "circle" ? "a cover photo" : "a photo or video"}`
                  }
                  accessibilityState={{ disabled: isDraftLocked }}
                  disabled={isDraftLocked}
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
                    opacity: isDraftLocked ? 0.55 : 1,
                  }}
                >
                  {asset ? (
                    <>
                      <Image
                        source={{ uri: asset.uri }}
                        style={{ width: "100%", height: 210 }}
                        contentFit="cover"
                      />
                      <T style={{ padding: 12, color: C.action, fontSize: 12 }}>
                        Change photo
                      </T>
                    </>
                  ) : (
                    <>
                      <Icon name="images-outline" color={C.action} size={27} />
                      <T style={{ fontWeight: "600", color: C.action }}>
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
              {mode !== "live" && asset && asset.type !== "video" && (
                <Button
                  title="Remove photo"
                  secondary
                  disabled={isDraftLocked}
                  onPress={() => {
                    if (!draftEditingLocked()) clearSelectedMedia();
                  }}
                />
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
                  <T style={{ color: C.secondary, fontSize: 12 }}>
                    Live video uses your camera and microphone. On iOS and
                    Android, a native development or release build is required;
                    Expo Go cannot broadcast WebRTC video.
                  </T>
                </View>
              )}
              {visiblePublishError && (
                <View style={[s.card, { padding: 14, gap: 10 }]}>
                  <StatusMessage
                    message={visiblePublishError}
                    tone="error"
                    style={{ fontSize: 13, lineHeight: 19 }}
                  />
                  <Button
                    title="Retry publication"
                    secondary
                    disabled={isPublishing || !!publicationIssue}
                    onPress={publish}
                  />
                </View>
              )}
              <Button
                title={
                  mode === "post"
                    ? publishUncertain
                      ? "Retry publication"
                      : "Publish your moment"
                    : mode === "circle"
                      ? "Create your circle"
                      : "Start live session"
                }
                icon={mode === "live" ? "radio-outline" : "arrow-up-outline"}
                loading={isPublishing}
                disabled={
                  !!creationIssue ||
                  !!publicationIssue ||
                  isPublishing ||
                  !recipientAllowsPublish
                }
                onPress={publish}
              />
              {isPublishing && (
                <StatusMessage
                  message={
                    publishStage === "publishing"
                      ? "Publishing your moment…"
                      : "Preparing and uploading encrypted media…"
                  }
                  tone="info"
                />
              )}
              <T style={{ color: C.muted, fontSize: 12, textAlign: "center" }}>
                A kind word goes a long way. Keep your circle welcoming.
              </T>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        visible={
          recorderScope !== null &&
          batch1OperationIdentityMatches(recorderScope, composerIdentity)
        }
        animationType="slide"
        onRequestClose={() => setRecorderScope(null)}
      >
        {recorderScope &&
          batch1OperationIdentityMatches(recorderScope, composerIdentity) && (
            <View
              style={{
                flex: 1,
                backgroundColor: C.bg,
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
                paddingLeft: insets.left,
                paddingRight: insets.right,
              }}
            >
              <ScrollView
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  padding: 14,
                  maxWidth: 620,
                  width: "100%",
                  alignSelf: "center",
                }}
              >
                <VideoRecorder
                  key={batch1OperationKey(recorderScope)}
                  maxBytes={Math.min(20, maxUploadMb) * 1024 * 1024}
                  onUse={(draft) => acceptRecording(draft, recorderScope)}
                  onClose={() => setRecorderScope(null)}
                />
              </ScrollView>
            </View>
          )}
      </Modal>
    </View>
  );
}
