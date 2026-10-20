import React from "react";
import { Pressable, View } from "react-native";
import { Image } from "@/components/media-image";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import { AppShell } from "@/components/app-shell";
import {
  Avatar,
  Button,
  C,
  Empty,
  Icon,
  Loading,
  s,
  T,
} from "@/components/circles-ui";

export default function LiveLobby() {
  const router = useRouter();
  const { requireAuth } = useCircles();
  const lives = trpc.live.list.useQuery({}, { refetchInterval: 5000 });
  return (
    <AppShell>
      <View style={{ gap: 17 }}>
        <View style={s.between}>
          <T style={s.eyebrow}>IN THE MOMENT. TOGETHER.</T>
          <View
            style={[
              s.row,
              {
                gap: 5,
                backgroundColor: C.soft,
                paddingHorizontal: 9,
                paddingVertical: 3,
                borderRadius: 6,
              },
            ]}
          >
            <View
              style={{
                width: 5,
                height: 5,
                backgroundColor: C.coral,
                borderRadius: 3,
              }}
            />
            <T style={{ fontSize: 10, color: C.coral, fontWeight: "700" }}>
              LIVE
            </T>
          </View>
        </View>
        <T style={s.title}>Be here, right now.</T>
        <T style={{ color: C.muted, fontSize: 13 }}>
          A front-row seat to the people and passions you love.
        </T>
        <Button
          title="Start a live conversation"
          icon="radio-outline"
          onPress={() => requireAuth(() => router.push("/create?mode=live"))}
        />
      </View>
      <View style={{ marginTop: 16 }}>
        {lives.isLoading ? (
          <Loading />
        ) : lives.error ? (
          <Empty
            title="Live connections are unavailable."
            text={lives.error.message}
            action="Try again"
            onAction={() => {
              void lives.refetch();
            }}
          />
        ) : !lives.data?.length ? (
          <Empty
            icon="radio-outline"
            title="A little quiet, for now."
            text="No active broadcasts yet. Go live, share a skill, or just spend a little time with your people."
          />
        ) : (
          lives.data.map((live) => (
            <Pressable
              key={live.id}
              onPress={() => requireAuth(() => router.push(`/live/${live.id}`))}
              style={[s.card, { overflow: "hidden", marginBottom: 19 }]}
            >
              <Image
                source={{ uri: live.thumbnail }}
                style={{ width: "100%", aspectRatio: 16 / 9 }}
                contentFit="cover"
              />
              <View
                style={{
                  position: "absolute",
                  top: 13,
                  left: 13,
                  backgroundColor: C.coral,
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                  borderRadius: 6,
                }}
              >
                <T style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>
                  LIVE · {live.viewers} watching
                </T>
              </View>
              <View style={[s.row, { padding: 17, gap: 12 }]}>
                <Avatar
                  uri={live.host.avatar}
                  name={live.host.name}
                  size={39}
                />
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: "700", fontSize: 15 }}>
                    {live.title}
                  </T>
                  <T style={{ color: C.muted, fontSize: 12 }}>
                    {live.host.name}
                  </T>
                </View>
                <Icon name="arrow-forward" color={C.coral} size={20} />
              </View>
            </Pressable>
          ))
        )}
      </View>
      <View
        style={{
          backgroundColor: C.sage,
          borderRadius: 16,
          padding: 18,
          gap: 7,
        }}
      >
        <T style={{ fontSize: 13, fontWeight: "700", color: C.green }}>
          Real people. Real-time video.
        </T>
        <T style={{ fontSize: 12, color: C.green, lineHeight: 19 }}>
          Broadcasting uses your camera and microphone. Native WebRTC needs a
          development or release build; some networks require a TURN relay for
          reliable connections.
        </T>
      </View>
    </AppShell>
  );
}
