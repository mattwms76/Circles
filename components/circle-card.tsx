import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Image } from "@/components/media-image";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import {
  batch3AccountResourceScope,
  createBatch3AccountResourceSingleFlight,
  isCurrentBatch3AccountResourceOperation,
  type Batch3AccountResourceOperation,
} from "@/lib/batch3-account-resource-scope";
import { invalidateCircleDirectories } from "@/lib/source-query-invalidation";
import type { Circle } from "@/shared/social";
import { Button, C, Icon, s, T } from "./circles-ui";

type JoinError = { scope: string; message: string };

export function CircleCard({ circle }: { circle: Circle }) {
  const { user } = useCircles();
  const circleScope = batch3AccountResourceScope(
    user?.id,
    `circle:${circle.id}`,
  );

  return (
    <CircleCardInstance
      key={circleScope ?? `guest:circle:${circle.id}`}
      circle={circle}
    />
  );
}

function CircleCardInstance({ circle }: { circle: Circle }) {
  const router = useRouter();
  const { user, requireAuth, notify } = useCircles();
  const utils = trpc.useUtils();
  const circleScope = batch3AccountResourceScope(
    user?.id,
    `circle:${circle.id}`,
  );
  const mountedScope = useRef<Batch3AccountResourceOperation | null>(null);
  const scopeGeneration = useRef(0);
  const joinFlight = useRef(createBatch3AccountResourceSingleFlight());
  const [pendingJoinScope, setPendingJoinScope] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<JoinError | null>(null);
  const join = trpc.social.joinCircle.useMutation();

  useEffect(() => {
    if (!circleScope) {
      mountedScope.current = null;
      return;
    }

    const operation = {
      scope: circleScope,
      generation: scopeGeneration.current + 1,
    };
    scopeGeneration.current = operation.generation;
    mountedScope.current = operation;

    return () => {
      if (
        isCurrentBatch3AccountResourceOperation(mountedScope.current, operation)
      ) {
        mountedScope.current = null;
      }
    };
  }, [circleScope]);

  const isCurrentCircleScope = (
    capturedScope: Batch3AccountResourceOperation,
  ) =>
    isCurrentBatch3AccountResourceOperation(
      mountedScope.current,
      capturedScope,
    );
  const isJoinPending = pendingJoinScope === circleScope;
  const requestJoin = () => {
    requireAuth(() => {
      const capturedScope = mountedScope.current;
      if (
        !capturedScope ||
        capturedScope.scope !== circleScope ||
        !joinFlight.current.start(capturedScope)
      ) {
        return;
      }
      setPendingJoinScope(capturedScope.scope);
      setJoinError((current) =>
        current?.scope === capturedScope.scope ? null : current,
      );
      join.mutate(
        { circleId: circle.id },
        {
          onSuccess: (result) => {
            joinFlight.current.finish(capturedScope);
            if (!isCurrentCircleScope(capturedScope)) return;
            setPendingJoinScope((current) =>
              current === capturedScope.scope ? null : current,
            );
            void invalidateCircleDirectories(utils);
            notify(
              result.role === "pending"
                ? "Your request is with the circle owner."
                : "You’re in. Say hello to your people!",
              "success",
            );
          },
          onError: () => {
            joinFlight.current.finish(capturedScope);
            if (!isCurrentCircleScope(capturedScope)) return;
            const message =
              circle.privacy === "private"
                ? `Couldn’t request to join ${circle.name}. Check your connection and try again.`
                : `Couldn’t join ${circle.name}. Check your connection and try again.`;
            setPendingJoinScope((current) =>
              current === capturedScope.scope ? null : current,
            );
            setJoinError({
              scope: capturedScope.scope,
              message,
            });
            notify(message, "error");
          },
        },
      );
    });
  };
  return (
    <View style={[s.card, { overflow: "hidden", marginBottom: 18 }]}>
      <Pressable
        onPress={() => router.push(`/circle/${circle.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${circle.name}`}
      >
        <Image
          source={{ uri: circle.image }}
          style={{ width: "100%", aspectRatio: 16 / 9 }}
          contentFit="cover"
        />
        <View
          style={{
            position: "absolute",
            top: 13,
            left: 13,
            flexDirection: "row",
            gap: 5,
            alignItems: "center",
            borderRadius: 7,
            backgroundColor: "#FFFFFFE8",
            paddingHorizontal: 9,
            paddingVertical: 5,
            maxWidth: "78%",
          }}
        >
          <Icon
            name={
              circle.privacy === "private"
                ? "lock-closed-outline"
                : "ellipse-outline"
            }
            size={11}
            color={C.secondary}
          />
          <T
            numberOfLines={2}
            ellipsizeMode="tail"
            style={{
              flexShrink: 1,
              fontSize: 10,
              lineHeight: 15,
              color: C.secondary,
              fontWeight: "600",
            }}
          >
            {circle.category}
          </T>
        </View>
      </Pressable>
      <View style={{ padding: 19, gap: 10 }}>
        <Pressable
          onPress={() => router.push(`/circle/${circle.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${circle.name}`}
          style={{
            alignSelf: "flex-start",
            justifyContent: "center",
            minHeight: 44,
          }}
        >
          <T
            numberOfLines={2}
            ellipsizeMode="tail"
            style={{ fontWeight: "800", fontSize: 20, letterSpacing: -0.5 }}
          >
            {circle.name}
          </T>
        </Pressable>
        <T
          style={{ color: C.muted, fontSize: 14, lineHeight: 22 }}
          numberOfLines={2}
        >
          {circle.description}
        </T>
        <View style={[s.between, { alignItems: "flex-start", marginTop: 6 }]}>
          <View
            style={[s.row, { flex: 1, minWidth: 0, gap: 5, paddingRight: 10 }]}
          >
            <Icon name="people-outline" size={15} color={C.muted} />
            <T
              numberOfLines={2}
              style={{ flex: 1, color: C.muted, fontSize: 12, lineHeight: 18 }}
            >
              {circle.memberCount} members · {circle.privacy}
            </T>
          </View>
          <Button
            title={
              circle.role === "pending"
                ? "Requested"
                : circle.joined
                  ? "Your circle"
                  : "Join circle"
            }
            secondary={!!circle.joined || circle.role === "pending"}
            loading={isJoinPending}
            disabled={circle.role === "pending" || isJoinPending}
            onPress={() =>
              circle.joined
                ? router.push(`/circle/${circle.id}`)
                : requestJoin()
            }
            style={{
              paddingHorizontal: 12,
              borderRadius: 9,
            }}
          />
        </View>
        {joinError?.scope === circleScope && (
          <T
            accessibilityRole="alert"
            style={{ color: C.secondary, fontSize: 12, lineHeight: 18 }}
          >
            {joinError.message} Try again when you’re ready.
          </T>
        )}
      </View>
    </View>
  );
}
