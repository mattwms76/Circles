import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { trpc } from "@/lib/trpc";
import {
  activityScopeKey,
  isCurrentActivityPreferences,
  isCurrentActivityScope,
  resolveActivityResponseUiState,
} from "@/lib/activity-ui";
import { Button, C, Empty, T } from "./circles-ui";

type CategoryKey = "commentsEnabled" | "membershipApprovalsEnabled";
type CategoryState = Record<CategoryKey, boolean>;

type ActivityToggleProps = {
  label: string;
  description: string;
  value: boolean;
  disabled: boolean;
  pending: boolean;
  onPress: () => void;
};

function ActivityToggle({
  label,
  description,
  value,
  disabled,
  pending,
  onPress,
}: ActivityToggleProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled, busy: pending }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toggle,
        disabled && styles.toggleDisabled,
        pressed && !disabled && styles.togglePressed,
      ]}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T style={styles.toggleLabel}>{label}</T>
        <T style={styles.toggleDescription}>{description}</T>
      </View>
      <View
        accessible={false}
        style={[styles.track, value ? styles.trackOn : styles.trackOff]}
      >
        {pending ? (
          <ActivityIndicator size="small" color={value ? "#fff" : C.green} />
        ) : (
          <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
        )}
      </View>
    </Pressable>
  );
}

function preferencesError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "We couldn’t save that preference. Please try again.";
}

/** Global future-event categories. Existing inbox records deliberately remain unchanged. */
export function ActivityPreferencesPanel({ viewerId }: { viewerId: number }) {
  const scope = { viewerId };
  const scopeKey = activityScopeKey(scope);
  const preferences = trpc.activity.preferences.useQuery(
    { viewerScope: viewerId },
    {
      enabled: Number.isSafeInteger(viewerId) && viewerId > 0,
      refetchOnMount: "always",
      retry: false,
      staleTime: 0,
    },
  );
  const state = resolveActivityResponseUiState({
    value: preferences.data,
    scope,
    queryEnabled: true,
    isError: preferences.isError,
    isFetchedAfterMount: preferences.isFetchedAfterMount,
    isFetching: preferences.isFetching,
  });
  const updateCategories = trpc.activity.updateCategories.useMutation();
  const mounted = useRef(false);
  const mountedScope = useRef(scopeKey);
  const [desired, setDesired] = useState<CategoryState | null>(null);
  const [pendingKey, setPendingKey] = useState<CategoryKey | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    // Strict Mode replays setup/cleanup, so setup must always restore this flag.
    mounted.current = true;
    mountedScope.current = scopeKey;
    return () => {
      mounted.current = false;
    };
  }, [scopeKey]);

  const isCurrent = useCallback(
    (capturedScope: string) =>
      isCurrentActivityScope(capturedScope, scopeKey, mounted.current) &&
      mountedScope.current === scopeKey,
    [scopeKey],
  );
  // `desired` exists only while a deliberate write is in flight. Fresh server data is
  // otherwise rendered directly, so a background response never overwrites an active choice.
  const currentValues = useMemo<CategoryState | undefined>(
    () =>
      desired ??
      (state.value
        ? {
            commentsEnabled: state.value.commentsEnabled,
            membershipApprovalsEnabled: state.value.membershipApprovalsEnabled,
          }
        : undefined),
    [desired, state.value],
  );

  const changeCategory = useCallback(
    (key: CategoryKey) => {
      if (!state.isAuthorityAvailable || !currentValues || pendingKey) return;
      const capturedScope = scopeKey;
      const nextValue = !currentValues[key];
      setDesired({ ...currentValues, [key]: nextValue });
      setPendingKey(key);
      setWriteError(null);
      setSavedMessage(null);

      void (async () => {
        try {
          await updateCategories.mutateAsync({
            viewerScope: viewerId,
            [key]: nextValue,
          });
          if (!isCurrent(capturedScope)) return;
          await preferences.refetch();
          if (!isCurrent(capturedScope)) return;
          setDesired(null);
          setSavedMessage("Update preferences saved.");
        } catch (caught) {
          if (isCurrent(capturedScope)) {
            setDesired(null);
            setWriteError(preferencesError(caught));
          }
        } finally {
          if (isCurrent(capturedScope)) setPendingKey(null);
        }
      })();
    },
    [
      currentValues,
      isCurrent,
      pendingKey,
      preferences,
      scopeKey,
      state.isAuthorityAvailable,
      updateCategories,
      viewerId,
    ],
  );

  if (state.isLoading) {
    return (
      <View style={styles.inlineLoading}>
        <ActivityIndicator color={C.coral} />
        <T style={styles.muted}>Checking your update preferences…</T>
      </View>
    );
  }

  if (state.isError || !state.value || !currentValues) {
    return (
      <Empty
        icon="options-outline"
        title="We couldn’t load update preferences."
        text="Check your connection and try again."
        action="Try again"
        onAction={() => void preferences.refetch()}
      />
    );
  }

  const controlsDisabled = !state.isAuthorityAvailable || !!pendingKey;
  return (
    <View style={styles.panel}>
      <View style={{ gap: 5 }}>
        <T style={styles.panelTitle}>Choose what’s new</T>
        <T style={styles.muted}>
          These choices affect future Updates. Anything already in your inbox
          stays there.
        </T>
      </View>
      <ActivityToggle
        label="Comments on your moments"
        description="Show an update when someone comments on one of your moments."
        value={currentValues.commentsEnabled}
        disabled={controlsDisabled}
        pending={pendingKey === "commentsEnabled"}
        onPress={() => changeCategory("commentsEnabled")}
      />
      <ActivityToggle
        label="Membership approvals"
        description="Show an update when a circle approves your membership request."
        value={currentValues.membershipApprovalsEnabled}
        disabled={controlsDisabled}
        pending={pendingKey === "membershipApprovalsEnabled"}
        onPress={() => changeCategory("membershipApprovalsEnabled")}
      />
      {writeError && <T style={styles.error}>{writeError}</T>}
      {savedMessage && <T style={styles.success}>{savedMessage}</T>}
    </View>
  );
}

/**
 * The server remains the source of membership authority. This component uses the screen's
 * membership signal only to avoid asking for a preference panel for a visitor who cannot use it.
 */
export function CircleActivityPreference({
  viewerId,
  circleId,
}: {
  viewerId: number;
  circleId: number;
}) {
  const scope = { viewerId };
  const scopeKey = `${activityScopeKey(scope)}:circle:${circleId}`;
  const preferences = trpc.activity.preferences.useQuery(
    { viewerScope: viewerId, circleId },
    {
      enabled:
        Number.isSafeInteger(viewerId) &&
        viewerId > 0 &&
        Number.isSafeInteger(circleId) &&
        circleId > 0,
      refetchOnMount: "always",
      retry: false,
      staleTime: 0,
    },
  );
  const state = resolveActivityResponseUiState({
    value: preferences.data,
    scope,
    queryEnabled: true,
    isError: preferences.isError,
    isFetchedAfterMount: preferences.isFetchedAfterMount,
    isFetching: preferences.isFetching,
    isCurrent: (value, currentScope) =>
      isCurrentActivityPreferences(value, currentScope, circleId),
  });
  const setCircleMuted = trpc.activity.setCircleMuted.useMutation();
  const mounted = useRef(false);
  const mountedScope = useRef(scopeKey);
  const [desiredMuted, setDesiredMuted] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    mountedScope.current = scopeKey;
    return () => {
      mounted.current = false;
    };
  }, [scopeKey]);

  const isCurrent = useCallback(
    (capturedScope: string) =>
      isCurrentActivityScope(capturedScope, scopeKey, mounted.current) &&
      mountedScope.current === scopeKey,
    [scopeKey],
  );
  const muted = desiredMuted ?? state.value?.circle?.muted;

  const toggleMuted = useCallback(() => {
    if (!state.isAuthorityAvailable || typeof muted !== "boolean" || pending)
      return;
    const capturedScope = scopeKey;
    const nextMuted = !muted;
    setDesiredMuted(nextMuted);
    setPending(true);
    setWriteError(null);

    void (async () => {
      try {
        await setCircleMuted.mutateAsync({
          viewerScope: viewerId,
          circleId,
          muted: nextMuted,
        });
        if (!isCurrent(capturedScope)) return;
        await preferences.refetch();
        if (!isCurrent(capturedScope)) return;
        setDesiredMuted(null);
      } catch (caught) {
        if (isCurrent(capturedScope)) {
          setDesiredMuted(null);
          setWriteError(preferencesError(caught));
        }
      } finally {
        if (isCurrent(capturedScope)) setPending(false);
      }
    })();
  }, [
    circleId,
    isCurrent,
    muted,
    pending,
    preferences,
    scopeKey,
    setCircleMuted,
    state.isAuthorityAvailable,
    viewerId,
  ]);

  if (state.isLoading) {
    return (
      <View style={styles.circleLoading}>
        <ActivityIndicator color={C.coral} />
        <T style={styles.muted}>Checking update preferences…</T>
      </View>
    );
  }

  if (state.isError || typeof muted !== "boolean") {
    return (
      <View style={styles.circleError}>
        <T style={styles.error}>We couldn’t load update preferences.</T>
        <Button
          title="Try again"
          secondary
          onPress={() => void preferences.refetch()}
          style={{ alignSelf: "flex-start" }}
        />
      </View>
    );
  }

  return (
    <View style={styles.circlePanel}>
      <ActivityToggle
        label="Mute Updates from this circle"
        description="Muting changes future updates from this circle. It won’t remove existing inbox items."
        value={muted}
        disabled={!state.isAuthorityAvailable || pending}
        pending={pending}
        onPress={toggleMuted}
      />
      {writeError && <T style={styles.error}>{writeError}</T>}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 13 },
  panelTitle: { fontSize: 19, fontWeight: "700" },
  muted: { color: C.muted, fontSize: 14, lineHeight: 21 },
  inlineLoading: { paddingVertical: 24, alignItems: "center", gap: 10 },
  toggle: {
    minHeight: 76,
    borderRadius: 15,
    paddingHorizontal: 15,
    paddingVertical: 13,
    gap: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.border,
  },
  toggleDisabled: { opacity: 0.62 },
  togglePressed: { opacity: 0.72 },
  toggleLabel: { fontSize: 14, fontWeight: "700" },
  toggleDescription: { color: C.muted, fontSize: 12, lineHeight: 18 },
  track: {
    width: 48,
    height: 29,
    borderRadius: 15,
    padding: 3,
    justifyContent: "center",
    flexShrink: 0,
  },
  trackOn: { backgroundColor: C.coral, alignItems: "flex-end" },
  trackOff: { backgroundColor: C.sage, alignItems: "flex-start" },
  knob: { width: 23, height: 23, borderRadius: 12, backgroundColor: "#fff" },
  knobOn: {},
  knobOff: { backgroundColor: C.green },
  error: { color: "#B44335", fontSize: 13, lineHeight: 19 },
  success: { color: C.green, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  circlePanel: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 14,
    gap: 9,
  },
  circleLoading: { paddingVertical: 12, gap: 9, alignItems: "center" },
  circleError: { gap: 10, paddingTop: 8 },
});
