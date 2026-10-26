import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import {
  resolveActivityRouteGate,
  resolveActivityUnreadControls,
} from "@/lib/a26-activity-repairs";
import { AppShell } from "@/components/app-shell";
import { StatusMessage } from "@/components/status-message";
import {
  activityCopy,
  activityScopeKey,
  capturedUnreadThroughId,
  isCurrentActivityScope,
  resolveActivityPagesUiState,
  resolveActivityResponseUiState,
} from "@/lib/activity-ui";
import type { ActivityItem } from "@/shared/activity";
import {
  ago,
  Button,
  C,
  Empty,
  Icon,
  Loading,
  s,
  T,
} from "@/components/circles-ui";

const ACTIVITY_LABEL_PART_MAX = 120;

function boundedActivityLabelPart(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  return characters.length > ACTIVITY_LABEL_PART_MAX
    ? `${characters.slice(0, ACTIVITY_LABEL_PART_MAX - 1).join("")}…`
    : normalized;
}

export function activityRowLabels(item: ActivityItem): {
  open: string;
  markRead: string;
} {
  const copy = activityCopy(item);
  const context = [
    boundedActivityLabelPart(copy.title),
    boundedActivityLabelPart(copy.detail),
    boundedActivityLabelPart(ago(item.createdAt)),
    item.readAt ? null : "unread",
  ]
    .filter((part): part is string => !!part)
    .join(" — ");

  return {
    open: `Open update: ${context}`,
    markRead: `Mark update as read: ${context}`,
  };
}

export function ActivityRow({
  item,
  disabled,
  marking,
  onOpen,
  onMarkRead,
}: {
  item: ActivityItem;
  disabled: boolean;
  marking: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const copy = activityCopy(item);
  const labels = activityRowLabels(item);
  const readControl = !item.readAt ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={labels.markRead}
      accessibilityState={{ disabled: disabled || marking, busy: marking }}
      disabled={disabled || marking}
      onPress={onMarkRead}
      style={({ pressed }) => [
        styles.readButton,
        (disabled || marking) && styles.disabled,
        pressed && !disabled && !marking && styles.pressed,
      ]}
    >
      <T style={styles.readButtonText}>{marking ? "Marking…" : "Mark read"}</T>
    </Pressable>
  ) : null;

  if (!item.available) {
    return (
      <View
        style={[
          s.card,
          styles.rowCard,
          item.readAt ? styles.readCard : styles.unreadCard,
        ]}
      >
        <View style={styles.unavailableCard}>
          <View style={styles.unavailableIcon} accessible={false}>
            <Icon name="alert-circle-outline" size={21} color={C.secondary} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <T style={styles.rowTitle}>{copy.title}</T>
            <T style={styles.rowDetail}>{copy.detail}</T>
            <T style={styles.rowTime}>{ago(item.createdAt)}</T>
          </View>
        </View>
        {readControl}
      </View>
    );
  }

  return (
    <View
      style={[
        s.card,
        styles.rowCard,
        item.readAt ? styles.readCard : styles.unreadCard,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labels.open}
        accessibilityHint="Opens the current update destination."
        accessibilityState={{ disabled, busy: marking }}
        disabled={disabled}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.rowOpen,
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <View style={styles.kindIcon} accessible={false}>
          <Icon
            name={
              item.kind === "comment_on_your_post"
                ? "chatbubble-outline"
                : "checkmark-circle-outline"
            }
            size={20}
            color={item.readAt ? C.secondary : C.action}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <T style={styles.rowTitle}>{copy.title}</T>
          <T style={styles.rowDetail}>{copy.detail}</T>
          <T style={styles.rowTime}>{ago(item.createdAt)}</T>
        </View>
        {!item.readAt && <View accessible={false} style={styles.unreadDot} />}
      </Pressable>
      {readControl}
    </View>
  );
}

export function ActivityInbox({ viewerId }: { viewerId: number }) {
  const router = useRouter();
  const scope = useMemo(() => ({ viewerId }), [viewerId]);
  const scopeKey = activityScopeKey(scope);
  const utils = trpc.useUtils();
  const list = trpc.activity.list.useInfiniteQuery(
    { viewerScope: viewerId, limit: 20 },
    {
      enabled: Number.isSafeInteger(viewerId) && viewerId > 0,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      refetchOnMount: "always",
      retry: false,
      staleTime: 0,
    },
  );
  const unread = trpc.activity.unreadCount.useQuery(
    { viewerScope: viewerId },
    {
      enabled: Number.isSafeInteger(viewerId) && viewerId > 0,
      refetchOnMount: "always",
      retry: false,
      staleTime: 0,
    },
  );
  const listState = resolveActivityPagesUiState({
    pages: list.data?.pages,
    scope,
    queryEnabled: true,
    isError: list.isError,
    isFetchedAfterMount: list.isFetchedAfterMount,
    isFetching: list.isFetching,
  });
  const unreadState = resolveActivityResponseUiState({
    value: unread.data,
    scope,
    queryEnabled: true,
    isError: unread.isError,
    isFetchedAfterMount: unread.isFetchedAfterMount,
    isFetching: unread.isFetching,
  });
  const markRead = trpc.activity.markRead.useMutation();
  const markAllRead = trpc.activity.markAllRead.useMutation();
  const mounted = useRef(false);
  const mountedScope = useRef(scopeKey);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [outcome, setOutcome] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);

  useEffect(() => {
    // This setup runs again after the development Strict Mode cleanup.
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

  const refreshActivity = useCallback(async () => {
    await Promise.all([list.refetch(), unread.refetch()]);
  }, [list, unread]);

  const intentionalMarkRead = useCallback(
    (id: number) => {
      if (!listState.isAuthorityAvailable || pendingId !== null || markingAll)
        return;
      const capturedScope = scopeKey;
      setPendingId(id);
      setOutcome(null);
      void (async () => {
        try {
          await markRead.mutateAsync({ viewerScope: viewerId, id });
          if (!isCurrent(capturedScope)) return;
          await refreshActivity();
          if (!isCurrent(capturedScope)) return;
          await utils.activity.list.invalidate({ viewerScope: viewerId });
          await utils.activity.unreadCount.invalidate({
            viewerScope: viewerId,
          });
          if (isCurrent(capturedScope)) {
            setOutcome({
              message: "Update marked as read.",
              tone: "success",
            });
          }
        } catch {
          if (isCurrent(capturedScope)) {
            setOutcome({
              message:
                "We couldn’t mark that update as read. Please try again.",
              tone: "error",
            });
          }
        } finally {
          if (isCurrent(capturedScope)) setPendingId(null);
        }
      })();
    },
    [
      isCurrent,
      listState.isAuthorityAvailable,
      markRead,
      markingAll,
      pendingId,
      refreshActivity,
      scopeKey,
      utils.activity.list,
      utils.activity.unreadCount,
      viewerId,
    ],
  );

  const intentionalMarkAllRead = useCallback(() => {
    const throughId = capturedUnreadThroughId(unreadState.value, scope);
    if (
      !listState.isAuthorityAvailable ||
      !unreadState.isAuthorityAvailable ||
      !throughId ||
      pendingId !== null ||
      markingAll
    ) {
      return;
    }
    const capturedScope = scopeKey;
    setMarkingAll(true);
    setOutcome(null);
    void (async () => {
      try {
        // throughId is captured from the matching durable unread watermark, never derived
        // from the currently rendered page or a client-side maximum.
        await markAllRead.mutateAsync({ viewerScope: viewerId, throughId });
        if (!isCurrent(capturedScope)) return;
        await refreshActivity();
        if (!isCurrent(capturedScope)) return;
        await utils.activity.list.invalidate({ viewerScope: viewerId });
        await utils.activity.unreadCount.invalidate({ viewerScope: viewerId });
        if (isCurrent(capturedScope)) {
          setOutcome({
            message: "All updates marked as read.",
            tone: "success",
          });
        }
      } catch {
        if (isCurrent(capturedScope)) {
          setOutcome({
            message:
              "We couldn’t mark those updates as read. Please try again.",
            tone: "error",
          });
        }
      } finally {
        if (isCurrent(capturedScope)) setMarkingAll(false);
      }
    })();
  }, [
    isCurrent,
    listState.isAuthorityAvailable,
    markAllRead,
    markingAll,
    pendingId,
    refreshActivity,
    scope,
    scopeKey,
    unreadState.isAuthorityAvailable,
    unreadState.value,
    utils.activity.list,
    utils.activity.unreadCount,
    viewerId,
  ]);

  const nextCursor = useMemo(
    () => listState.pages.at(-1)?.nextCursor ?? null,
    [listState.pages],
  );
  const interactionsDisabled = !listState.isAuthorityAvailable || markingAll;
  const throughId = capturedUnreadThroughId(unreadState.value, scope);
  const unreadControls = resolveActivityUnreadControls({
    hasItems: listState.items.length > 0,
    unreadIsError: unreadState.isError,
    unreadAuthorityAvailable: unreadState.isAuthorityAvailable,
    throughId,
  });

  return (
    <View style={{ gap: 18 }}>
      <View style={[s.between, { gap: 12, alignItems: "flex-start" }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
          <T style={s.eyebrow}>YOUR ACTIVITY</T>
          <T style={s.title}>Updates</T>
          <T style={styles.headingCopy}>
            A quiet place for new moments around your circles.
          </T>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Update preferences"
          onPress={() => router.push("/updates/preferences")}
          style={({ pressed }) => [
            styles.preferencesLink,
            pressed && styles.pressed,
          ]}
        >
          <Icon name="options-outline" size={20} color={C.action} />
          <T style={styles.preferencesLinkText}>Preferences</T>
        </Pressable>
      </View>

      <StatusMessage
        message={outcome?.message}
        tone={outcome?.tone}
        style={styles.outcome}
      />

      {listState.isLoading ? (
        <Loading />
      ) : listState.isError ? (
        <Empty
          icon="notifications-outline"
          title="We couldn’t load your Updates."
          text="Check your connection and try again."
          action="Try again"
          onAction={() => void refreshActivity()}
        />
      ) : listState.items.length === 0 ? (
        <Empty
          icon="notifications-outline"
          title="Nothing new yet."
          text="When someone comments on one of your moments or approves a circle request, it will appear here."
        />
      ) : (
        <View style={{ gap: 10 }}>
          {unreadControls.showRecovery ? (
            <View style={styles.unreadRecovery}>
              <StatusMessage
                message="We couldn’t check unread updates. Mark all read is unavailable until it refreshes."
                tone="error"
                style={styles.outcome}
              />
              <Button
                title="Try again"
                accessibilityLabel="Try checking unread updates again"
                secondary
                disabled={unread.isFetching}
                loading={unread.isFetching}
                onPress={() => void unread.refetch()}
                style={{ alignSelf: "flex-start" }}
              />
            </View>
          ) : unreadControls.showMarkAll ? (
            <Button
              title={markingAll ? "Marking updates…" : "Mark all read"}
              secondary
              disabled={interactionsDisabled || pendingId !== null}
              loading={markingAll}
              onPress={intentionalMarkAllRead}
              style={{ alignSelf: "flex-start" }}
            />
          ) : null}
          {listState.items.map((item) => (
            <ActivityRow
              key={item.id}
              item={item}
              disabled={interactionsDisabled || pendingId !== null}
              marking={pendingId === item.id}
              onOpen={() => {
                if (!listState.isAuthorityAvailable) return;
                router.push(`/updates/${item.id}`);
              }}
              onMarkRead={() => intentionalMarkRead(item.id)}
            />
          ))}
          {nextCursor ? (
            <Button
              title="Show more updates"
              secondary
              disabled={
                !listState.isAuthorityAvailable || list.isFetchingNextPage
              }
              loading={list.isFetchingNextPage}
              onPress={() => void list.fetchNextPage()}
              style={{ alignSelf: "center", marginTop: 4 }}
            />
          ) : (
            <T style={styles.endCopy}>You’re all caught up.</T>
          )}
        </View>
      )}
    </View>
  );
}

export default function UpdatesScreen() {
  const { authState, refresh, showLogin, user } = useCircles();
  const routeGate = resolveActivityRouteGate({
    authState,
    viewerId: user?.id,
  });

  return (
    <AppShell>
      {routeGate === "checking" ? (
        <Loading />
      ) : routeGate === "auth-error" ? (
        <View style={{ gap: 10 }}>
          <StatusMessage
            message="We couldn’t confirm your sign-in. Try again."
            tone="error"
            style={styles.outcome}
          />
          <Empty
            icon="alert-circle-outline"
            title="We couldn’t check your sign-in."
            text="Check your connection, then try again before opening Updates."
            action="Try again"
            onAction={refresh}
          />
        </View>
      ) : routeGate === "guest" ? (
        <Empty
          icon="notifications-outline"
          title="Updates are waiting for you."
          text="Sign in to see activity around your moments and circle requests."
          action="Sign in"
          onAction={showLogin}
        />
      ) : (
        <ActivityInbox
          key={activityScopeKey({ viewerId: user!.id })}
          viewerId={user!.id}
        />
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  headingCopy: { color: C.secondary, fontSize: 14, lineHeight: 21 },
  preferencesLink: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 10,
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    backgroundColor: C.sage,
  },
  preferencesLinkText: { color: C.action, fontSize: 12, fontWeight: "700" },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.56 },
  rowCard: { overflow: "hidden" },
  unreadCard: { borderColor: "#EFCFC7" },
  readCard: { backgroundColor: C.paper },
  rowOpen: {
    minHeight: 79,
    paddingHorizontal: 15,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  kindIcon: {
    width: 39,
    height: 39,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.soft,
    flexShrink: 0,
  },
  rowTitle: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  rowDetail: { color: C.secondary, fontSize: 12, lineHeight: 18 },
  rowTime: { color: C.secondary, fontSize: 11, lineHeight: 16 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.action,
    flexShrink: 0,
  },
  readButton: {
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 15,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  readButtonText: { color: C.action, fontSize: 12, fontWeight: "700" },
  unavailableCard: {
    paddingHorizontal: 15,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#F4F4F0",
  },
  unavailableIcon: {
    width: 39,
    height: 39,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.border,
    flexShrink: 0,
  },
  outcome: { fontSize: 13, lineHeight: 19 },
  unreadRecovery: {
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.soft,
  },
  endCopy: {
    paddingVertical: 14,
    color: C.secondary,
    textAlign: "center",
    fontSize: 12,
  },
});
