import React from "react";
import { Pressable, View } from "react-native";
import { Image } from "@/components/media-image";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import type { Circle } from "@/shared/social";
import { Button, C, Icon, s, T } from "./circles-ui";

export function CircleCard({ circle }: { circle: Circle }) {
  const router = useRouter();
  const { requireAuth, notify } = useCircles();
  const utils = trpc.useUtils();
  const join = trpc.social.joinCircle.useMutation({
    onSuccess: (result) => {
      void utils.social.circles.invalidate();
      notify(
        result.role === "pending"
          ? "Your request is with the circle owner."
          : "You’re in. Say hello to your people!",
      );
    },
    onError: (e) => notify(e.message),
  });
  return (
    <View style={[s.card, { overflow: "hidden", marginBottom: 18 }]}>
      <Pressable onPress={() => router.push(`/circle/${circle.id}`)}>
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
          }}
        >
          <Icon
            name={
              circle.privacy === "private"
                ? "lock-closed-outline"
                : "ellipse-outline"
            }
            size={11}
            color={C.green}
          />
          <T
            style={{
              fontSize: 10,
              lineHeight: 15,
              color: C.green,
              fontWeight: "600",
            }}
          >
            {circle.category}
          </T>
        </View>
      </Pressable>
      <View style={{ padding: 19, gap: 10 }}>
        <Pressable onPress={() => router.push(`/circle/${circle.id}`)}>
          <T style={{ fontWeight: "800", fontSize: 20, letterSpacing: -0.5 }}>
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
            loading={join.isPending}
            disabled={circle.role === "pending"}
            onPress={() =>
              circle.joined
                ? router.push(`/circle/${circle.id}`)
                : requireAuth(() => join.mutate({ circleId: circle.id }))
            }
            style={{
              paddingHorizontal: 12,
              borderRadius: 9,
            }}
          />
        </View>
      </View>
    </View>
  );
}
