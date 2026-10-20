import React, { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Image } from "@/components/media-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import { AppShell } from "@/components/app-shell";
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

export default function CircleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const circleId = Number(id);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const narrowActions = width < 390;
  const coverAspectRatio = width < 600 ? 16 / 10 : 3;
  const { user, requireAuth, notify } = useCircles();
  const [tab, setTab] = useState("Feed");
  const circle = trpc.social.circle.useQuery({ id: circleId });
  const group = circle.data;
  const members = trpc.social.members.useQuery(
    { circleId },
    { enabled: !!group && (group.privacy === "public" || !!group.joined) },
  );
  const feed = trpc.social.feed.useQuery(
    { filter: "for-you", circleId },
    { enabled: !!group && (group.privacy === "public" || !!group.joined) },
  );
  const utils = trpc.useUtils();
  const refresh = () => {
    void circle.refetch();
    void members.refetch();
    void utils.social.circles.invalidate();
  };
  const join = trpc.social.joinCircle.useMutation({
    onSuccess: (result) => {
      refresh();
      notify(
        result.role === "pending"
          ? "Your request has been sent to the owner."
          : "You’re in. Make yourself at home.",
      );
    },
    onError: (e) => notify(e.message),
  });
  const leave = trpc.social.leaveCircle.useMutation({
    onSuccess: () => {
      refresh();
      notify("You’ve left this circle.");
    },
    onError: (e) => notify(e.message),
  });
  const chat = trpc.social.openCircleChat.useMutation({
    onSuccess: (result) =>
      router.push(
        `/chat/${result.id}?name=${encodeURIComponent(group?.name || "Circle chat")}`,
      ),
    onError: (e) => notify(e.message),
  });
  const role = trpc.social.setRole.useMutation({
    onSuccess: () => {
      refresh();
      notify("Circle role updated.");
    },
    onError: (e) => notify(e.message),
  });
  const remove = trpc.social.removeMember.useMutation({
    onSuccess: () => {
      refresh();
      notify("Member removed.");
    },
    onError: (e) => notify(e.message),
  });
  const approve = trpc.social.approveMember.useMutation({
    onSuccess: () => {
      refresh();
      notify("A new member is in your circle.");
    },
    onError: (e) => notify(e.message),
  });
  const deletePost = trpc.social.deletePost.useMutation({
    onSuccess: () => {
      void feed.refetch();
      notify("Post removed from the circle.");
    },
    onError: (e) => notify(e.message),
  });
  const isAdmin = group?.role === "owner" || group?.role === "moderator";
  return (
    <AppShell>
      {circle.isLoading ? (
        <Loading />
      ) : circle.error || !group ? (
        <Empty
          title="This circle couldn’t be opened."
          text={circle.error?.message || "It may no longer be available."}
          action="Find circles"
          onAction={() => router.replace("/circles")}
        />
      ) : (
        <>
          <View style={[s.between, { marginBottom: 15 }]}>
            <Pressable
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/circles")
              }
              style={[s.row, { gap: 7 }]}
            >
              <Icon name="arrow-back" size={17} />
              <T style={{ color: C.muted, fontSize: 12 }}>
                Back to your people
              </T>
            </Pressable>
            <T style={s.eyebrow}>CIRCLE SPACE</T>
          </View>
          <View
            style={{
              borderRadius: 20,
              overflow: "hidden",
              backgroundColor: C.sage,
            }}
          >
            <Image
              source={{ uri: group.image }}
              style={{ width: "100%", aspectRatio: coverAspectRatio }}
              contentFit="cover"
            />
            <View
              style={{
                position: "absolute",
                left: 17,
                top: 17,
                backgroundColor: "#FFFFFFE8",
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 8,
              }}
            >
              <T style={{ color: C.green, fontSize: 10, fontWeight: "700" }}>
                {group.category.toUpperCase()}
              </T>
            </View>
          </View>
          <View style={{ paddingVertical: 24, gap: 13 }}>
            <View style={s.between}>
              <T style={[s.title, { flex: 1, minWidth: 0, paddingRight: 10 }]}>
                {group.name}
              </T>
              <View
                accessible={false}
                importantForAccessibility="no-hide-descendants"
              >
                <Icon name="ellipse-outline" color={C.coral} size={30} />
              </View>
            </View>
            <View style={[s.row, { gap: 7 }]}>
              <Icon
                name={
                  group.privacy === "private"
                    ? "lock-closed-outline"
                    : "globe-outline"
                }
                size={14}
                color={C.muted}
              />
              <T
                style={{
                  flex: 1,
                  color: C.muted,
                  fontSize: 12,
                  lineHeight: 18,
                }}
              >
                {group.privacy === "private"
                  ? "Private circle"
                  : "Public circle"}{" "}
                · {group.memberCount} members
                {group.role && group.role !== "pending"
                  ? ` · You’re ${group.role === "owner" ? "the owner" : `a ${group.role}`}`
                  : ""}
              </T>
            </View>
            <T style={{ color: C.muted, fontSize: 14, lineHeight: 22 }}>
              {group.description}
            </T>
            <View style={[s.row, { gap: 9, marginTop: 5 }]}>
              {group.joined ? (
                <>
                  <Button
                    title="Circle chat"
                    icon="chatbubble-ellipses-outline"
                    onPress={() => chat.mutate({ circleId })}
                    loading={chat.isPending}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Share"
                    secondary
                    icon="add"
                    onPress={() => router.push(`/create?circleId=${circleId}`)}
                    style={{ flex: 1 }}
                  />
                </>
              ) : (
                <Button
                  title={
                    group.role === "pending"
                      ? "Membership requested"
                      : group.privacy === "private"
                        ? "Request to join"
                        : "Join this circle"
                  }
                  icon={group.role === "pending" ? "time-outline" : "add"}
                  loading={join.isPending}
                  disabled={group.role === "pending"}
                  onPress={() => requireAuth(() => join.mutate({ circleId }))}
                  style={{ flex: 1 }}
                />
              )}
            </View>
            {group.role === "pending" && (
              <Button
                title="Cancel membership request"
                secondary
                loading={leave.isPending}
                onPress={() => leave.mutate({ circleId })}
              />
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            accessibilityLabel="Circle sections"
            accessibilityHint="Swipe sideways to find all circle sections"
            style={{ marginBottom: 22 }}
            contentContainerStyle={{ gap: 8, paddingRight: 20 }}
          >
            {["Feed", "Members", "About", ...(isAdmin ? ["Manage"] : [])].map(
              (item) => (
                <Pill
                  key={item}
                  title={item}
                  selected={tab === item}
                  onPress={() => setTab(item)}
                />
              ),
            )}
          </ScrollView>
          {tab === "Feed" &&
            (group.privacy === "private" && !group.joined ? (
              <Empty
                icon="lock-closed-outline"
                title="A little space, just for members."
                text="Request to join this circle to see its moments and join the conversation."
              />
            ) : feed.isLoading ? (
              <Loading />
            ) : !feed.data?.length ? (
              <Empty
                icon="images-outline"
                title="Make the first connection."
                text="Share a moment with the circle and give people something to talk about."
                action="Share a moment"
                onAction={() =>
                  requireAuth(() => router.push(`/create?circleId=${circleId}`))
                }
              />
            ) : (
              feed.data.map((post) => <PostCard key={post.id} post={post} />)
            ))}
          {tab === "Members" &&
            (group.privacy === "private" && !group.joined ? (
              <Empty
                icon="lock-closed-outline"
                title="Members only."
                text="Join the circle to meet its people."
              />
            ) : members.isLoading ? (
              <Loading />
            ) : (
              <View style={{ gap: 16 }}>
                {members.data
                  ?.filter((member) => member.role !== "pending")
                  .map((member) => (
                    <Pressable
                      key={member.user.id}
                      onPress={() => router.push(`/person/${member.user.id}`)}
                      style={[
                        s.row,
                        {
                          gap: 12,
                          paddingBottom: 15,
                          borderBottomWidth: 1,
                          borderColor: C.border,
                        },
                      ]}
                    >
                      <Avatar
                        uri={member.user.avatar}
                        name={member.user.name}
                        size={42}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T style={{ fontWeight: "700", fontSize: 13 }}>
                          {member.user.name}
                        </T>
                        <T
                          style={{
                            fontSize: 12,
                            lineHeight: 18,
                            color: C.muted,
                          }}
                        >
                          @{member.user.handle}
                        </T>
                      </View>
                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 8,
                          backgroundColor:
                            member.role === "owner" ? C.soft : C.sage,
                        }}
                      >
                        <T
                          style={{
                            fontSize: 10,
                            color: member.role === "owner" ? C.coral : C.green,
                            fontWeight: "600",
                          }}
                        >
                          {member.role}
                        </T>
                      </View>
                    </Pressable>
                  ))}
              </View>
            ))}
          {tab === "About" && (
            <View style={[s.card, { padding: 22, gap: 16 }]}>
              <T style={{ fontSize: 19, fontWeight: "700" }}>
                A space for good company.
              </T>
              <T style={{ color: C.muted, fontSize: 14, lineHeight: 22 }}>
                {group.description}
              </T>
              <T style={s.eyebrow}>THE HOUSE RULES</T>
              <View style={{ gap: 10 }}>
                {[
                  "Be kind and make room for others.",
                  "Share things that belong here.",
                  "Respect privacy.",
                  "Keep the conversation welcoming.",
                ].map((rule) => (
                  <View
                    key={rule}
                    style={[s.row, { alignItems: "flex-start", gap: 9 }]}
                  >
                    <Icon
                      name="checkmark-circle-outline"
                      size={18}
                      color={C.green}
                    />
                    <T
                      style={{
                        flex: 1,
                        color: C.muted,
                        fontSize: 14,
                        lineHeight: 21,
                      }}
                    >
                      {rule}
                    </T>
                  </View>
                ))}
              </View>
              {group.joined && group.role !== "owner" && (
                <Button
                  title="Leave this circle"
                  secondary
                  onPress={() => leave.mutate({ circleId })}
                  loading={leave.isPending}
                />
              )}
              {group.role === "owner" && (
                <T style={{ fontSize: 12, lineHeight: 18, color: C.green }}>
                  You own this circle. Appoint moderators in Manage to help care
                  for your community.
                </T>
              )}
            </View>
          )}
          {tab === "Manage" && isAdmin && (
            <View style={{ gap: 20 }}>
              <T style={{ fontSize: 18, fontWeight: "700" }}>
                Look after your people.
              </T>
              <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
                Owners appoint moderators. Owners and moderators keep the circle
                welcoming.
              </T>
              {members.data?.map((member) => (
                <View
                  key={member.user.id}
                  style={[s.card, { padding: 15, gap: 12 }]}
                >
                  <View style={[s.row, { alignItems: "flex-start", gap: 10 }]}>
                    <Avatar
                      uri={member.user.avatar}
                      name={member.user.name}
                      size={35}
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <T
                        style={{
                          fontSize: 14,
                          lineHeight: 20,
                          fontWeight: "700",
                        }}
                      >
                        {member.user.name}
                      </T>
                      <T
                        style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}
                      >
                        {member.role === "pending"
                          ? "Requesting to join"
                          : member.role}
                      </T>
                    </View>
                  </View>
                  {member.role !== "owner" && member.user.id !== user?.id && (
                    <View
                      style={[
                        s.row,
                        { gap: 8, flexWrap: "wrap", alignItems: "stretch" },
                      ]}
                    >
                      {member.role === "pending" ? (
                        <Button
                          title="Approve request"
                          secondary
                          onPress={() =>
                            approve.mutate({ circleId, userId: member.user.id })
                          }
                          style={{
                            flexGrow: 1,
                            flexBasis: narrowActions ? "100%" : 148,
                          }}
                        />
                      ) : (
                        group.role === "owner" && (
                          <Button
                            title={
                              member.role === "moderator"
                                ? "Remove moderator role"
                                : "Appoint moderator"
                            }
                            secondary
                            onPress={() =>
                              role.mutate({
                                circleId,
                                userId: member.user.id,
                                role:
                                  member.role === "moderator"
                                    ? "member"
                                    : "moderator",
                              })
                            }
                            style={{
                              flexGrow: 1,
                              flexBasis: narrowActions ? "100%" : 148,
                            }}
                          />
                        )
                      )}
                      {(group.role === "owner" ||
                        member.role === "member" ||
                        member.role === "pending") && (
                        <Button
                          title={
                            member.role === "pending"
                              ? "Decline"
                              : "Remove member"
                          }
                          secondary
                          onPress={() =>
                            remove.mutate({ circleId, userId: member.user.id })
                          }
                          style={{
                            flexGrow: 1,
                            flexBasis: narrowActions ? "100%" : 148,
                          }}
                        />
                      )}
                    </View>
                  )}
                </View>
              ))}
              <T style={{ fontSize: 17, fontWeight: "700", marginTop: 8 }}>
                Moderate posts
              </T>
              {feed.data?.map((post) => (
                <View key={post.id} style={[s.card, { padding: 14, gap: 10 }]}>
                  <T
                    style={{ fontWeight: "600", fontSize: 14, lineHeight: 20 }}
                  >
                    {post.author.name}
                  </T>
                  <T
                    numberOfLines={2}
                    style={{ fontSize: 14, lineHeight: 21, color: C.muted }}
                  >
                    {post.text}
                  </T>
                  <Button
                    title="Remove from circle"
                    secondary
                    icon="trash-outline"
                    onPress={() => deletePost.mutate({ postId: post.id })}
                  />
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </AppShell>
  );
}
