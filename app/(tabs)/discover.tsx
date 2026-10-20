import React, { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Image } from "@/components/media-image";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import { AppShell } from "@/components/app-shell";
import { CircleCard } from "@/components/circle-card";
import { PostCard } from "@/components/post-card";
import {
  Avatar,
  Button,
  C,
  Empty,
  Icon,
  IconButton,
  Loading,
  Pill,
  s,
  T,
} from "@/components/circles-ui";

export default function DiscoverScreen() {
  const router = useRouter();
  const { requireAuth, notify } = useCircles();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("For you");
  const people = trpc.social.profiles.useQuery({ search });
  const circles = trpc.social.circles.useQuery({ search });
  const feed = trpc.social.feed.useQuery({ filter: "for-you" });
  const lives = trpc.live.list.useQuery({ search });
  const utils = trpc.useUtils();
  const follow = trpc.social.follow.useMutation({
    onSuccess: () => {
      void utils.social.profiles.invalidate();
      notify("Your connections have been updated.");
    },
    onError: (e) => notify(e.message),
  });
  const posts =
    feed.data?.filter((post) =>
      `${post.text} ${post.author.name} ${post.circleName || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  const contentWidth = {
    width: "100%" as const,
    maxWidth: 680,
    alignSelf: "flex-start" as const,
  };
  return (
    <AppShell>
      <View style={[contentWidth, { gap: 19 }]}>
        <T style={s.eyebrow}>FOLLOW YOUR CURIOSITY</T>
        <T style={s.title}>There’s more out there.</T>
        <View
          style={[
            s.row,
            {
              gap: 10,
              backgroundColor: C.paper,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 13,
              paddingHorizontal: 15,
            },
          ]}
        >
          <Icon name="search-outline" size={19} color={C.muted} />
          <TextInput
            placeholder="People, passions, places…"
            value={search}
            onChangeText={setSearch}
            placeholderTextColor={C.muted}
            style={{
              flex: 1,
              paddingVertical: 15,
              fontSize: 14,
              lineHeight: 20,
              color: C.ink,
            }}
          />
          {!!search && (
            <IconButton
              icon="close-circle"
              size={18}
              color={C.muted}
              label="Clear search"
              onPress={() => setSearch("")}
            />
          )}
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel="Discover categories"
          accessibilityHint="Swipe sideways to browse all discover categories"
          contentContainerStyle={{ gap: 8, paddingRight: 20 }}
        >
          {["For you", "People", "Circles", "Posts", "Live"].map((item) => (
            <Pill
              title={item}
              key={item}
              selected={tab === item}
              onPress={() => setTab(item)}
            />
          ))}
        </ScrollView>
      </View>
      {(tab === "For you" || tab === "People") && (
        <View style={[contentWidth, { marginTop: 25, gap: 15 }]}>
          <View style={s.between}>
            <T style={{ fontSize: 17, fontWeight: "700" }}>People to know</T>
            <T style={{ fontSize: 12, lineHeight: 18, color: C.muted }}>
              MAKE A CONNECTION
            </T>
          </View>
          {people.isLoading ? (
            <Loading />
          ) : !people.data?.length ? (
            <Empty
              title="No people found."
              text="Try another name or handle."
            />
          ) : (
            people.data.map((person) => (
              <View
                key={person.id}
                style={[
                  s.row,
                  {
                    padding: 14,
                    gap: 12,
                    backgroundColor: C.paper,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: C.border,
                  },
                ]}
              >
                <Pressable onPress={() => router.push(`/person/${person.id}`)}>
                  <Avatar uri={person.avatar} name={person.name} size={48} />
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/person/${person.id}`)}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <T
                    style={{ fontWeight: "700", fontSize: 14, lineHeight: 20 }}
                  >
                    {person.name}
                  </T>
                  <T style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>
                    @{person.handle}
                  </T>
                  <T
                    numberOfLines={2}
                    style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}
                  >
                    {person.bio}
                  </T>
                </Pressable>
                <Button
                  title={person.isFollowing ? "Following" : "Follow"}
                  secondary={person.isFollowing}
                  onPress={() =>
                    requireAuth(() => follow.mutate({ userId: person.id }))
                  }
                  style={{
                    paddingHorizontal: 11,
                    borderRadius: 9,
                  }}
                />
              </View>
            ))
          )}
        </View>
      )}
      {(tab === "For you" || tab === "Circles") && (
        <View style={[contentWidth, { marginTop: 27 }]}>
          <T style={{ fontSize: 17, fontWeight: "700", marginBottom: 16 }}>
            A circle for your thing
          </T>
          {circles.isLoading ? (
            <Loading />
          ) : !circles.data?.length ? (
            <Empty
              title="No circles found."
              text="A new passion deserves a new circle."
            />
          ) : (
            circles.data
              .slice(0, tab === "For you" ? 2 : undefined)
              .map((circle) => <CircleCard key={circle.id} circle={circle} />)
          )}
        </View>
      )}
      {tab === "Posts" && (
        <View style={[contentWidth, { marginTop: 24 }]}>
          {feed.isLoading ? (
            <Loading />
          ) : !posts.length ? (
            <Empty
              title="No moments found."
              text="Try another word or explore a circle."
            />
          ) : (
            posts.map((post) => <PostCard key={post.id} post={post} />)
          )}
        </View>
      )}
      {tab === "Live" && (
        <View style={[contentWidth, { marginTop: 25 }]}>
          {lives.data?.length ? (
            lives.data.map((live) => (
              <Pressable
                key={live.id}
                onPress={() => router.push(`/live/${live.id}`)}
                style={[s.card, { overflow: "hidden", marginBottom: 15 }]}
              >
                <Image
                  source={{ uri: live.thumbnail }}
                  style={{ width: "100%", height: 180 }}
                  contentFit="cover"
                />
                <View style={{ padding: 15 }}>
                  <T style={{ fontWeight: "700" }}>{live.title}</T>
                  <T style={{ fontSize: 12, color: C.muted }}>
                    {live.host.name} · {live.viewers} watching
                  </T>
                </View>
              </Pressable>
            ))
          ) : (
            <Empty
              icon="radio-outline"
              title="A quiet moment, for now."
              text="No one is live right now. Start a conversation in real time."
              action="Go live"
              onAction={() =>
                requireAuth(() => router.push("/create?mode=live"))
              }
            />
          )}
        </View>
      )}
    </AppShell>
  );
}
