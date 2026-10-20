import React, { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import { AppShell } from "@/components/app-shell";
import {
  ago,
  Avatar,
  C,
  Empty,
  Icon,
  IconButton,
  Loading,
  Pill,
  s,
  T,
} from "@/components/circles-ui";

export default function MessagesScreen() {
  const router = useRouter();
  const { user, showLogin } = useCircles();
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const conversations = trpc.social.conversations.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 3000,
  });
  const items =
    conversations.data?.filter(
      (item) =>
        item.name.toLowerCase().includes(search.toLowerCase()) &&
        (filter === "All" ||
          (filter === "Circles" && item.kind === "circle") ||
          (filter === "Direct" && item.kind === "direct")),
    ) || [];
  return (
    <AppShell>
      <View style={{ gap: 19 }}>
        <View style={s.between}>
          <View>
            <T style={s.eyebrow}>KEEP THE CONVERSATION GOING</T>
            <T style={[s.title, { marginTop: 7 }]}>A little hello.</T>
          </View>
          <IconButton
            icon="create-outline"
            onPress={() => router.push("/discover")}
            label="Find someone to message"
          />
        </View>
        <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
          The best connections happen one conversation at a time.
        </T>
        <View
          style={[
            s.row,
            {
              paddingHorizontal: 15,
              gap: 8,
              backgroundColor: C.paper,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 13,
            },
          ]}
        >
          <Icon name="search-outline" color={C.muted} size={18} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Find a conversation"
            placeholderTextColor={C.muted}
            style={{
              paddingVertical: 14,
              flex: 1,
              fontSize: 14,
              lineHeight: 20,
              color: C.ink,
            }}
          />
        </View>
        <View style={[s.row, { gap: 8 }]}>
          {["All", "Direct", "Circles"].map((item) => (
            <Pill
              title={item}
              key={item}
              selected={filter === item}
              onPress={() => setFilter(item)}
            />
          ))}
        </View>
      </View>
      <View style={{ marginTop: 22 }}>
        {!user ? (
          <Empty
            icon="chatbubbles-outline"
            title="Your conversations live here."
            text="Sign in to message your people and chat with your circles."
            action="Sign in"
            onAction={showLogin}
          />
        ) : conversations.isLoading ? (
          <Loading />
        ) : conversations.error ? (
          <Empty
            title="Couldn’t open your inbox."
            text={conversations.error.message}
            action="Try again"
            onAction={() => {
              void conversations.refetch();
            }}
          />
        ) : !items.length ? (
          <Empty
            icon="chatbubble-ellipses-outline"
            title="It starts with a hello."
            text="Message a creator from their profile, or open the chat in a circle you’ve joined."
            action="Find your people"
            onAction={() => router.push("/discover")}
          />
        ) : (
          items.map((conversation) => (
            <Pressable
              key={conversation.id}
              onPress={() =>
                router.push(
                  `/chat/${conversation.id}?name=${encodeURIComponent(conversation.name)}`,
                )
              }
              style={[
                s.row,
                {
                  paddingVertical: 19,
                  gap: 14,
                  borderBottomWidth: 1,
                  borderColor: C.border,
                },
              ]}
            >
              <View>
                <Avatar
                  uri={conversation.avatar}
                  name={conversation.name}
                  size={51}
                />
                {conversation.kind === "circle" && (
                  <View
                    style={{
                      position: "absolute",
                      bottom: -2,
                      right: -2,
                      borderRadius: 7,
                      backgroundColor: C.sage,
                      padding: 3,
                      borderWidth: 2,
                      borderColor: C.bg,
                    }}
                  >
                    <Icon name="people" size={10} color={C.green} />
                  </View>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <T
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={{ fontSize: 14, fontWeight: "700" }}
                >
                  {conversation.name}
                </T>
                <T numberOfLines={1} style={{ fontSize: 12, color: C.muted }}>
                  {conversation.lastMessage || "Say something kind."}
                </T>
              </View>
              <View
                style={{
                  width: 44,
                  flexShrink: 0,
                  alignItems: "flex-end",
                  gap: 8,
                }}
              >
                <T style={{ fontSize: 12, lineHeight: 18, color: C.muted }}>
                  {ago(conversation.updatedAt)}
                </T>
                {conversation.unread > 0 && (
                  <View
                    style={{
                      backgroundColor: C.coral,
                      borderRadius: 10,
                      minWidth: 19,
                      height: 19,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <T
                      style={{
                        fontSize: 10,
                        lineHeight: 15,
                        color: "#fff",
                        fontWeight: "700",
                      }}
                    >
                      {conversation.unread}
                    </T>
                  </View>
                )}
              </View>
            </Pressable>
          ))
        )}
      </View>
    </AppShell>
  );
}
