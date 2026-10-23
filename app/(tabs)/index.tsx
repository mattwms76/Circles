import React, { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { resolveFnd001QueryDisplayState } from "@/lib/fnd001-query-display-state";
import { AppShell } from "@/components/app-shell";
import { PostCard } from "@/components/post-card";
import {
  Avatar,
  Button,
  C,
  Empty,
  Icon,
  Loading,
  Pill,
  s,
  T,
} from "@/components/circles-ui";
import { useCircles } from "@/hooks/circles-context";
import { OnboardingEntry } from "@/components/onboarding-entry";

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, requireAuth } = useCircles();
  const [filter, setFilter] = useState<
    "for-you" | "following" | "circles" | "saved"
  >("for-you");
  const feed = trpc.social.feedPage.useInfiniteQuery(
    { filter, limit: 20 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  const profiles = trpc.social.profilesPage.useQuery({ limit: 6 });
  const myProfile = trpc.social.profile.useQuery({}, { enabled: !!user });
  const lives = trpc.live.list.useQuery({});
  const feedItems = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const feedDisplayState = resolveFnd001QueryDisplayState({
    isLoading: feed.isLoading,
    isError: feed.isError,
    hasContent: feedItems.length > 0 || !!feed.hasNextPage,
  });
  return (
    <AppShell>
      <View style={{ gap: 6 }}>
        <View style={s.between}>
          <T style={s.eyebrow}>LESS SCROLLING. MORE BELONGING.</T>
          <View style={[s.row, { gap: 5 }]}>
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: C.green,
              }}
            />
            <T style={{ fontSize: 9, color: C.green }}>Your daily connection</T>
          </View>
        </View>
        <T style={[s.title, { marginTop: 4, fontSize: width < 450 ? 28 : 31 }]}>
          Your world, a little closer
          <T style={{ color: C.coral, fontSize: 31 }}>.</T>
        </T>
        <T
          style={{ color: C.muted, fontSize: 14, lineHeight: 21, marginTop: 2 }}
        >
          Good people. Shared passions. Real moments.
        </T>
      </View>
      <OnboardingEntry />
      <ScrollView
        showsVerticalScrollIndicator={false}
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel="Moments from people you may know"
        accessibilityHint="Swipe sideways to browse more moments"
        style={{ marginTop: 23, marginBottom: 21 }}
        contentContainerStyle={{ gap: 17, paddingRight: 20 }}
      >
        <Pressable
          onPress={() => requireAuth(() => router.push("/create"))}
          style={{ alignItems: "center", gap: 7 }}
        >
          <View>
            <Avatar
              uri={myProfile.data?.avatar}
              name={user?.name || "You"}
              size={54}
            />
            <View
              style={{
                position: "absolute",
                bottom: -1,
                right: -1,
                width: 20,
                height: 20,
                borderRadius: 10,
                borderWidth: 2,
                borderColor: C.bg,
                backgroundColor: C.coral,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="add" size={14} color="#fff" />
            </View>
          </View>
          <T style={{ fontSize: 10, color: C.muted }}>Your moment</T>
        </Pressable>
        {profiles.data?.items.map((profile) => (
          <Pressable
            key={profile.id}
            onPress={() => router.push(`/person/${profile.id}`)}
            style={{ alignItems: "center", gap: 5 }}
          >
            <Avatar uri={profile.avatar} name={profile.name} size={50} ring />
            <T style={{ fontSize: 10, color: C.ink }}>
              {profile.name.split(" ")[0]}
            </T>
          </Pressable>
        ))}
      </ScrollView>
      <View style={[s.divider, { marginBottom: 19 }]} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel="Feed filters"
        accessibilityHint="Swipe sideways to choose another feed filter"
        contentContainerStyle={{ gap: 7, paddingBottom: 20, paddingRight: 20 }}
      >
        <Pill
          title="For you"
          selected={filter === "for-you"}
          onPress={() => setFilter("for-you")}
          icon="sparkles-outline"
        />
        <Pill
          title="Following"
          selected={filter === "following"}
          onPress={() => setFilter("following")}
        />
        <Pill
          title="Your circles"
          selected={filter === "circles"}
          onPress={() => setFilter("circles")}
        />
        <Pressable
          onPress={() => router.push("/live")}
          style={[
            s.row,
            {
              minHeight: 44,
              paddingHorizontal: 11,
              gap: 6,
              justifyContent: "center",
            },
          ]}
        >
          <View
            style={{
              width: 6,
              height: 6,
              backgroundColor: C.coral,
              borderRadius: 4,
            }}
          />
          <T style={{ fontSize: 12, lineHeight: 18, fontWeight: "600" }}>
            Live now{lives.data?.length ? ` · ${lives.data.length}` : ""}
          </T>
        </Pressable>
      </ScrollView>
      {feedDisplayState === "loading" ? (
        <Loading />
      ) : feedDisplayState === "error" ? (
        <Empty
          title="A small pause in the connection."
          text={feed.error?.message || "Check your connection and try again."}
          action="Reconnect"
          onAction={() => {
            void feed.refetch();
          }}
        />
      ) : feedDisplayState === "empty" ? (
        <Empty
          icon="leaf-outline"
          title={
            filter === "following"
              ? "Follow your kind of people."
              : filter === "circles"
                ? "Your circle starts here."
                : "Room for your first moment."
          }
          text={
            filter === "following"
              ? "Discover creators and follow them to bring their posts here."
              : filter === "circles"
                ? "Join a circle to see what your community is sharing."
                : "Be the first to share something that brings people together."
          }
          action={filter === "circles" ? "Find a circle" : "Explore"}
          onAction={() =>
            router.push(filter === "circles" ? "/circles" : "/discover")
          }
        />
      ) : (
        feedItems.map((post) => <PostCard key={post.id} post={post} />)
      )}
      {feedDisplayState === "content" &&
        (feed.hasNextPage ? (
          <Button
            title="Show more moments"
            secondary
            loading={feed.isFetchingNextPage}
            onPress={() => void feed.fetchNextPage()}
            style={{ alignSelf: "center", marginVertical: 14 }}
          />
        ) : (
          <View style={{ alignItems: "center", paddingVertical: 14, gap: 5 }}>
            <Icon name="leaf-outline" color="#A0AB91" size={20} />
            <T style={{ color: C.muted, fontSize: 11 }}>
              You’re all caught up. Go make a moment.
            </T>
            <T style={{ color: "#A3A799", fontSize: 9 }}>
              Example community content · Your own story starts with sign-in.
            </T>
          </View>
        ))}
    </AppShell>
  );
}
