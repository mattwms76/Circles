import React, { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Image } from "@/components/media-image";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import { AppShell } from "@/components/app-shell";
import { CircleCard } from "@/components/circle-card";
import {
  Button,
  C,
  Empty,
  Icon,
  IconButton,
  Loading,
  photo,
  Pill,
  s,
  T,
} from "@/components/circles-ui";

export default function CirclesScreen() {
  const router = useRouter();
  const { requireAuth } = useCircles();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [joinedOnly, setJoinedOnly] = useState(false);
  const circles = trpc.social.circlesPage.useInfiniteQuery(
    {
      search,
      category: category === "All" ? undefined : category,
      limit: 20,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  const circleItems = circles.data?.pages.flatMap((page) => page.items) ?? [];
  const items = circleItems.filter((circle) => !joinedOnly || circle.joined);
  return (
    <AppShell>
      <View style={{ gap: 21 }}>
        <View style={s.between}>
          <View>
            <T style={s.eyebrow}>A PLACE TO BELONG</T>
            <T style={[s.title, { marginTop: 6 }]}>Find your people.</T>
          </View>
          <IconButton
            icon="add"
            color={C.coral}
            label="Create a circle"
            onPress={() =>
              requireAuth(() => router.push("/create?mode=circle"))
            }
            style={{
              borderRadius: 13,
              backgroundColor: C.soft,
            }}
          />
        </View>
        <View
          style={{
            overflow: "hidden",
            borderRadius: 19,
            height: 174,
            backgroundColor: "#506744",
          }}
        >
          <Image
            source={{ uri: photo.mountains }}
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              opacity: 0.55,
            }}
            contentFit="cover"
          />
          <View style={{ padding: 23, gap: 9 }}>
            <T
              style={{
                color: "#EEF6E9",
                fontSize: 10,
                letterSpacing: 1.3,
                fontWeight: "700",
              }}
            >
              LIFE IS BETTER TOGETHER
            </T>
            <T
              style={{
                color: "#fff",
                fontSize: 25,
                lineHeight: 29,
                fontWeight: "800",
                letterSpacing: -0.7,
              }}
            >
              {"Big passions.\nYour kind of people."}
            </T>
            <Pressable
              onPress={() => {
                setCategory("Outdoors");
                setJoinedOnly(false);
              }}
            >
              <T style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>
                Explore the outdoors ↗
              </T>
            </Pressable>
          </View>
        </View>
        <View
          style={[
            s.row,
            {
              backgroundColor: C.paper,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 13,
              paddingHorizontal: 14,
              gap: 9,
            },
          ]}
        >
          <Icon name="search-outline" color={C.muted} size={18} />
          <TextInput
            placeholder="Find a circle for your thing…"
            value={search}
            onChangeText={setSearch}
            placeholderTextColor={C.muted}
            style={{
              flex: 1,
              fontSize: 14,
              lineHeight: 20,
              color: C.ink,
              paddingVertical: 14,
            }}
          />
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel="Circle categories"
          accessibilityHint="Swipe sideways to browse all circle categories"
          contentContainerStyle={{ gap: 7, paddingRight: 20 }}
        >
          {[
            "All",
            "Lifestyle",
            "Outdoors",
            "Design",
            "Photography",
            "Fitness",
            "Music",
          ].map((item) => (
            <Pill
              key={item}
              title={item}
              selected={category === item}
              onPress={() => setCategory(item)}
            />
          ))}
        </ScrollView>
        <View
          style={[
            s.between,
            { alignItems: "center", gap: 8, flexWrap: "wrap" },
          ]}
        >
          <View style={[s.row, { gap: 18 }]}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: !joinedOnly }}
              onPress={() => setJoinedOnly(false)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <T
                style={{
                  fontSize: 15,
                  fontWeight: !joinedOnly ? "700" : "500",
                  color: !joinedOnly ? C.ink : C.muted,
                }}
              >
                Discover circles
              </T>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: joinedOnly }}
              onPress={() => setJoinedOnly(true)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <T
                style={{
                  fontSize: 15,
                  fontWeight: joinedOnly ? "700" : "500",
                  color: joinedOnly ? C.ink : C.muted,
                }}
              >
                Your circles
              </T>
            </Pressable>
          </View>
          <T
            style={{
              color: C.muted,
              fontSize: 12,
              lineHeight: 18,
              marginLeft: "auto",
            }}
          >
            {items.length} circles
          </T>
        </View>
      </View>
      <View style={{ marginTop: 20 }}>
        {circles.isLoading ? (
          <Loading />
        ) : circles.error ? (
          <Empty
            title="We couldn’t load your circles."
            text={circles.error.message}
            action="Try again"
            onAction={() => {
              void circles.refetch();
            }}
          />
        ) : !items.length && !circles.hasNextPage ? (
          <Empty
            icon="ellipse-outline"
            title={
              joinedOnly ? "Your people are out there." : "No circles found."
            }
            text={
              joinedOnly
                ? "Join a community that feels like you, or make a new one."
                : "Try a different search or start a circle for this passion."
            }
            action={joinedOnly ? "Explore circles" : "Create a circle"}
            onAction={() =>
              joinedOnly
                ? setJoinedOnly(false)
                : requireAuth(() => router.push("/create?mode=circle"))
            }
          />
        ) : (
          items.map((circle) => (
            <CircleCard key={circle.id} circle={circle} />
          ))
        )}
        {!circles.isLoading && !circles.error &&
          (circles.hasNextPage ? (
            <Button
              title="Show more circles"
              secondary
              loading={circles.isFetchingNextPage}
              onPress={() => void circles.fetchNextPage()}
              style={{ alignSelf: "center", marginTop: 4 }}
            />
          ) : (
            <T
              style={{ color: C.muted, fontSize: 12, textAlign: "center", paddingVertical: 14 }}
            >
              You’ve reached the end of these circles.
            </T>
          ))}
      </View>
    </AppShell>
  );
}
