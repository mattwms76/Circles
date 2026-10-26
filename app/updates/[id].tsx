import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppShell } from "@/components/app-shell";
import { PostCard } from "@/components/post-card";
import { StatusMessage } from "@/components/status-message";
import { useCircles } from "@/hooks/circles-context";
import {
  activityScopeKey,
  isCurrentActivityScope,
  isCurrentActivityTarget,
  parseActivityRouteId,
  resolveActivityResponseUiState,
} from "@/lib/activity-ui";
import { trpc } from "@/lib/trpc";
import { Button, C, Empty, Icon, Loading, s, T } from "@/components/circles-ui";

function ActivityDetail({
  viewerId,
  activityId,
}: {
  viewerId: number;
  activityId: number;
}) {
  const router = useRouter();
  const scope = { viewerId };
  const scopeKey = `${activityScopeKey(scope)}:detail:${activityId}`;
  const utils = trpc.useUtils();
  const target = trpc.activity.resolveTarget.useQuery(
    { viewerScope: viewerId, id: activityId },
    {
      enabled: Number.isSafeInteger(viewerId) && viewerId > 0 && activityId > 0,
      refetchOnMount: "always",
      retry: false,
      staleTime: 0,
    },
  );
  const targetState = resolveActivityResponseUiState({
    value: target.data,
    scope,
    queryEnabled: true,
    isError: target.isError,
    isFetchedAfterMount: target.isFetchedAfterMount,
    isFetching: target.isFetching,
    isCurrent: (value, currentScope) =>
      isCurrentActivityTarget(value, currentScope, activityId),
  });
  const markRead = trpc.activity.markRead.useMutation();
  const mounted = useRef(false);
  const mountedScope = useRef(scopeKey);
  const [marking, setMarking] = useState(false);
  const [outcome, setOutcome] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const [marked, setMarked] = useState(false);

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

  const intentionallyMarkRead = useCallback(() => {
    if (!targetState.isAuthorityAvailable || marking) return;
    const capturedScope = scopeKey;
    setMarking(true);
    setOutcome(null);
    void (async () => {
      try {
        await markRead.mutateAsync({ viewerScope: viewerId, id: activityId });
        if (!isCurrent(capturedScope)) return;
        await Promise.all([
          utils.activity.list.invalidate({ viewerScope: viewerId }),
          utils.activity.unreadCount.invalidate({ viewerScope: viewerId }),
        ]);
        if (isCurrent(capturedScope)) {
          setMarked(true);
          setOutcome({ message: "Update marked as read.", tone: "success" });
        }
      } catch {
        if (isCurrent(capturedScope)) {
          setOutcome({
            message: "We couldn’t mark this update as read. Please try again.",
            tone: "error",
          });
        }
      } finally {
        if (isCurrent(capturedScope)) setMarking(false);
      }
    })();
  }, [
    activityId,
    isCurrent,
    markRead,
    marking,
    scopeKey,
    targetState.isAuthorityAvailable,
    utils.activity.list,
    utils.activity.unreadCount,
    viewerId,
  ]);

  if (targetState.isLoading) return <Loading />;
  if (targetState.isError) {
    return (
      <Empty
        icon="notifications-outline"
        title="We couldn’t open this update."
        text="Check your connection and try again."
        action="Try again"
        onAction={() => void target.refetch()}
      />
    );
  }

  const resolved = targetState.value?.target;
  if (!resolved) {
    return (
      <Empty
        icon="alert-circle-outline"
        title="This update is no longer available."
        text="It may have been removed or your access may have changed."
      />
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={[s.between, { gap: 12 }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <T style={s.eyebrow}>UPDATE</T>
          <T style={{ fontSize: 21, fontWeight: "700" }}>Here’s what’s new</T>
        </View>
        <Button
          title={marking ? "Marking…" : marked ? "Marked read" : "Mark as read"}
          secondary
          disabled={!targetState.isAuthorityAvailable || marking || marked}
          loading={marking}
          onPress={intentionallyMarkRead}
          style={{ minWidth: 128 }}
        />
      </View>
      <StatusMessage
        message={outcome?.message}
        tone={outcome?.tone}
        style={{ fontSize: 13, lineHeight: 19 }}
      />
      {resolved.type === "post" ? (
        <PostCard post={resolved.post} />
      ) : (
        <View style={[s.card, { padding: 20, gap: 13 }]}>
          <View style={[s.row, { gap: 10 }]}>
            <View
              accessible={false}
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: C.sage,
              }}
            >
              <Icon name="ellipse-outline" color={C.secondary} size={22} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T style={{ fontSize: 17, fontWeight: "700" }}>
                Your circle update
              </T>
              <T style={{ color: C.secondary, fontSize: 13 }}>
                Open the circle to see what’s happening now.
              </T>
            </View>
          </View>
          <Button
            title="Open circle"
            onPress={() => {
              // The only navigation ID comes from this matching fresh resolution.
              if (!targetState.isAuthorityAvailable) return;
              router.push(`/circle/${resolved.circleId}`);
            }}
            disabled={!targetState.isAuthorityAvailable}
          />
        </View>
      )}
    </View>
  );
}

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const activityId = parseActivityRouteId(Array.isArray(id) ? undefined : id);
  const router = useRouter();
  const { authState, showLogin, user } = useCircles();

  return (
    <AppShell>
      {!user && authState === "checking" ? (
        <Loading />
      ) : !user ? (
        <Empty
          icon="notifications-outline"
          title="Updates are waiting for you."
          text="Sign in to safely open your Activity."
          action="Sign in"
          onAction={showLogin}
        />
      ) : !activityId ? (
        <Empty
          icon="notifications-outline"
          title="This update link isn’t valid."
          text="Open Updates to see what’s new around your circles."
          action="Open Updates"
          onAction={() => router.replace("/updates")}
        />
      ) : (
        <ActivityDetail
          key={`${activityScopeKey({ viewerId: user.id })}:${activityId}`}
          viewerId={user.id}
          activityId={activityId}
        />
      )}
    </AppShell>
  );
}
