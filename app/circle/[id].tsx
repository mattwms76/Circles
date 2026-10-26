import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Image } from "@/components/media-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import {
  batch3AccountResourceScope,
  createBatch3AccountResourceSingleFlight,
  isCurrentBatch3AccountResourceOperation,
  type Batch3AccountResourceOperation,
} from "@/lib/batch3-account-resource-scope";
import { resolveFnd001QueryDisplayState } from "@/lib/fnd001-query-display-state";
import { parsePositiveSafeId } from "@/lib/feed-ui-helpers";
import { invalidateCircleDirectories } from "@/lib/source-query-invalidation";
import { AppShell } from "@/components/app-shell";
import {
  CircleHomeEditor,
  CircleHomePanel,
} from "@/components/circle-home-panel";
import { CircleActivityPreference } from "@/components/activity-preferences";
import { PostCard } from "@/components/post-card";
import {
  canReadCircleHome,
  circleHomeScopeKey,
  resolveCircleHomeUiState,
} from "@/lib/circle-home-ui";
import { canUseCircleActivityPreferences } from "@/lib/activity-ui";
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

type MembershipError = { scope: string; message: string };

export default function CircleScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const routeCircleId = parsePositiveSafeId(id);
  const { user } = useCircles();
  const circleScope = batch3AccountResourceScope(
    user?.id,
    `circle:${routeCircleId ?? 0}`,
  );

  return (
    <CircleScreenInstance
      key={circleScope ?? `guest:circle:${routeCircleId ?? 0}`}
    />
  );
}

function CircleScreenInstance() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const routeCircleId = parsePositiveSafeId(id);
  const circleId = routeCircleId ?? 0;
  const router = useRouter();
  const { width } = useWindowDimensions();
  const narrowActions = width < 390;
  const coverAspectRatio = width < 600 ? 16 / 10 : 3;
  const { user, requireAuth, notify } = useCircles();
  const circleActionScope = batch3AccountResourceScope(
    user?.id,
    `circle:${circleId}`,
  );
  const mountedMembershipScope = useRef<Batch3AccountResourceOperation | null>(
    null,
  );
  const membershipGeneration = useRef(0);
  const membershipFlight = useRef(createBatch3AccountResourceSingleFlight());
  const [pendingMembershipScope, setPendingMembershipScope] = useState<
    string | null
  >(null);
  const [membershipError, setMembershipError] =
    useState<MembershipError | null>(null);
  const [tab, setTab] = useState("Home");
  const [homeEditorScope, setHomeEditorScope] = useState<string | null>(null);
  const circle = trpc.social.circle.useQuery(
    { id: circleId },
    { enabled: !!routeCircleId },
  );
  const group = routeCircleId ? circle.data : undefined;
  const homeScope = { circleId, viewerId: user?.id ?? null };
  const homeScopeKey = circleHomeScopeKey(homeScope);
  const canReadHome = !!group && canReadCircleHome(group);
  const homeQueryEnabled =
    !!routeCircleId &&
    !!group &&
    canReadHome &&
    (group.privacy === "public" || !!user?.id);
  const home = trpc.circleHome.get.useQuery(
    { circleId, viewerScope: user?.id ?? null },
    {
      enabled: homeQueryEnabled,
      refetchOnMount: "always",
      retry: false,
      staleTime: 0,
    },
  );
  const homeUi = resolveCircleHomeUiState({
    home: home.data,
    scope: homeScope,
    homeQueryEnabled,
    isError: home.isError,
    isFetchedAfterMount: home.isFetchedAfterMount,
    isFetching: home.isFetching,
  });
  const currentHome = homeUi.home;
  const refetchHome = home.refetch;

  useEffect(() => {
    if (!circleActionScope) {
      mountedMembershipScope.current = null;
      return;
    }

    const operation = {
      scope: circleActionScope,
      generation: membershipGeneration.current + 1,
    };
    membershipGeneration.current = operation.generation;
    mountedMembershipScope.current = operation;

    return () => {
      if (
        isCurrentBatch3AccountResourceOperation(
          mountedMembershipScope.current,
          operation,
        )
      ) {
        mountedMembershipScope.current = null;
      }
    };
  }, [circleActionScope]);

  const isCurrentCircleActionScope = (
    capturedScope: Batch3AccountResourceOperation,
  ) =>
    isCurrentBatch3AccountResourceOperation(
      mountedMembershipScope.current,
      capturedScope,
    );

  useEffect(() => {
    if (homeQueryEnabled) void refetchHome();
  }, [homeQueryEnabled, homeScopeKey, refetchHome]);

  const circleDisplayState = resolveFnd001QueryDisplayState({
    isLoading: circle.isLoading,
    isError: circle.isError,
    hasContent: !!group,
  });
  const members = trpc.social.membersPage.useInfiniteQuery(
    { circleId, limit: 20 },
    {
      enabled:
        !!routeCircleId &&
        !!group &&
        (group.privacy === "public" || !!group.joined),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  const feed = trpc.social.feedPage.useInfiniteQuery(
    { filter: "for-you", circleId, limit: 20 },
    {
      enabled:
        !!routeCircleId &&
        !!group &&
        (group.privacy === "public" || !!group.joined),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  const memberItems = members.data?.pages.flatMap((page) => page.items) ?? [];
  const feedItems = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const membersDisplayState = resolveFnd001QueryDisplayState({
    isLoading: members.isLoading,
    isError: members.isError,
    hasContent: memberItems.length > 0 || !!members.hasNextPage,
  });
  const feedDisplayState = resolveFnd001QueryDisplayState({
    isLoading: feed.isLoading,
    isError: feed.isError,
    hasContent: feedItems.length > 0 || !!feed.hasNextPage,
  });
  const utils = trpc.useUtils();
  const refresh = () => {
    void circle.refetch();
    void members.refetch();
    void feed.refetch();
    void utils.circleHome.get.invalidate({ circleId });
    void invalidateCircleDirectories(utils);
  };
  const membership = trpc.social.setMembership.useMutation();
  const isMembershipPending = pendingMembershipScope === circleActionScope;
  const updateMembership = (joined: boolean) => {
    requireAuth(() => {
      const capturedScope = mountedMembershipScope.current;
      if (
        !capturedScope ||
        capturedScope.scope !== circleActionScope ||
        !membershipFlight.current.start(capturedScope)
      ) {
        return;
      }
      setPendingMembershipScope(capturedScope.scope);
      setMembershipError((current) =>
        current?.scope === capturedScope.scope ? null : current,
      );
      membership.mutate(
        { circleId, joined },
        {
          onSuccess: (result) => {
            membershipFlight.current.finish(capturedScope);
            if (!isCurrentCircleActionScope(capturedScope)) return;
            setPendingMembershipScope((current) =>
              current === capturedScope.scope ? null : current,
            );
            refresh();
            notify(
              result.role === "pending"
                ? "Your request has been sent to the owner."
                : result.joined
                  ? "You’re in. Make yourself at home."
                  : "You’ve left this circle.",
            );
          },
          onError: (error) => {
            membershipFlight.current.finish(capturedScope);
            if (!isCurrentCircleActionScope(capturedScope)) return;
            setPendingMembershipScope((current) =>
              current === capturedScope.scope ? null : current,
            );
            setMembershipError({
              scope: capturedScope.scope,
              message: error.message,
            });
            notify(error.message);
          },
        },
      );
    });
  };
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
      void utils.circleHome.get.invalidate({ circleId });
      void utils.social.feedPage.invalidate({
        filter: "for-you",
        circleId,
        limit: 20,
      });
      notify("Post removed from the circle.");
    },
    onError: (e) => notify(e.message),
  });
  const isAdmin = group?.role === "owner" || group?.role === "moderator";
  const canManageHome = homeUi.canEdit;
  const homeManagementWasDenied =
    homeUi.isAuthorityAvailable && currentHome?.canManage === false;
  // A fresh server denial hides the keyed editor and clears its local draft.
  // Errors and routine refetches retain it because authority is unavailable.
  const homeEditorIsOpen =
    homeEditorScope === homeScopeKey && !homeManagementWasDenied;
  const manageTabAvailable = isAdmin || canManageHome || homeEditorIsOpen;

  return (
    <AppShell>
      {!routeCircleId ? (
        <Empty
          title="This circle link isn’t valid."
          text="Find a circle that feels like home."
          action="Find circles"
          onAction={() => router.replace("/circles")}
        />
      ) : circleDisplayState === "loading" ? (
        <Loading />
      ) : circleDisplayState === "error" ? (
        <Empty
          title="We couldn’t load this circle."
          text="Check your connection and try again."
          action="Try again"
          onAction={() => void circle.refetch()}
        />
      ) : !group ? (
        <Empty
          title="This circle couldn’t be opened."
          text="It may no longer be available."
          action="Find circles"
          onAction={() => router.replace("/circles")}
        />
      ) : (
        <>
          <View
            style={[
              s.between,
              {
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 15,
              },
            ]}
          >
            <Pressable
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/circles")
              }
              accessibilityRole="button"
              accessibilityLabel="Back to your people"
              style={[
                s.row,
                {
                  alignSelf: "flex-start",
                  flexGrow: 1,
                  flexShrink: 1,
                  gap: 7,
                  minHeight: 44,
                  minWidth: 0,
                },
              ]}
            >
              <Icon name="arrow-back" size={17} />
              <T
                numberOfLines={2}
                style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}
              >
                Back to your people
              </T>
            </Pressable>
            <T style={[s.eyebrow, { alignSelf: "center", flexShrink: 1 }]}>
              CIRCLE SPACE
            </T>
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
                maxWidth: "80%",
              }}
            >
              <T
                numberOfLines={2}
                ellipsizeMode="tail"
                style={{ color: C.secondary, fontSize: 10, fontWeight: "700" }}
              >
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
                  loading={isMembershipPending}
                  disabled={group.role === "pending" || isMembershipPending}
                  onPress={() => updateMembership(true)}
                  style={{ flex: 1 }}
                />
              )}
            </View>
            {group.role === "pending" && (
              <Button
                title="Cancel membership request"
                secondary
                loading={isMembershipPending}
                disabled={isMembershipPending}
                onPress={() => updateMembership(false)}
              />
            )}
            {membershipError?.scope === circleActionScope && (
              <T
                accessibilityRole="alert"
                style={{ color: C.secondary, fontSize: 12, lineHeight: 18 }}
              >
                {membershipError.message} Try again when you’re ready.
              </T>
            )}
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityLabel="Circle sections"
            accessibilityHint="Swipe sideways to find all circle sections"
            style={{ marginBottom: 22 }}
            contentContainerStyle={{ gap: 8, paddingRight: 20 }}
          >
            {[
              "Home",
              "Feed",
              "Members",
              "About",
              ...(manageTabAvailable ? ["Manage"] : []),
            ].map((item) => (
              <Pill
                key={item}
                title={item}
                selected={tab === item}
                onPress={() => setTab(item)}
              />
            ))}
          </ScrollView>
          {tab === "Home" && (
            <CircleHomePanel
              key={homeScopeKey}
              canRead={canReadHome}
              home={currentHome}
              isLoading={homeUi.isLoading}
              isError={homeUi.isError}
              onRetry={() => void home.refetch()}
            />
          )}
          {tab === "Feed" &&
            (group.privacy === "private" && !group.joined ? (
              <Empty
                icon="lock-closed-outline"
                title="A little space, just for members."
                text="Request to join this circle to see its moments and join the conversation."
              />
            ) : feedDisplayState === "loading" ? (
              <Loading />
            ) : feedDisplayState === "error" ? (
              <Empty
                icon="images-outline"
                title="We couldn’t load this circle’s moments."
                text="Check your connection and try again."
                action="Try again"
                onAction={() => void feed.refetch()}
              />
            ) : feedDisplayState === "empty" ? (
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
              feedItems.map((post) => <PostCard key={post.id} post={post} />)
            ))}
          {tab === "Feed" &&
            (group.privacy === "public" || !!group.joined) &&
            feedDisplayState === "content" &&
            (feed.hasNextPage ? (
              <Button
                title="Show more moments"
                secondary
                loading={feed.isFetchingNextPage}
                onPress={() => void feed.fetchNextPage()}
                style={{ alignSelf: "center", marginTop: 8 }}
              />
            ) : (
              <T
                style={{
                  color: C.muted,
                  fontSize: 12,
                  textAlign: "center",
                  paddingVertical: 14,
                }}
              >
                You’ve reached the end of these moments.
              </T>
            ))}
          {tab === "Members" &&
            (group.privacy === "private" && !group.joined ? (
              <Empty
                icon="lock-closed-outline"
                title="Members only."
                text="Join the circle to meet its people."
              />
            ) : membersDisplayState === "loading" ? (
              <Loading />
            ) : membersDisplayState === "error" ? (
              <Empty
                icon="people-outline"
                title="We couldn’t load the members."
                text="Check your connection and try again."
                action="Try again"
                onAction={() => void members.refetch()}
              />
            ) : (
              <View style={{ gap: 16 }}>
                {memberItems
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
          {tab === "Members" &&
            (group.privacy === "public" || !!group.joined) &&
            membersDisplayState === "content" &&
            (members.hasNextPage ? (
              <Button
                title="Show more members"
                secondary
                loading={members.isFetchingNextPage}
                onPress={() => void members.fetchNextPage()}
                style={{ alignSelf: "center", marginTop: 8 }}
              />
            ) : (
              <T
                style={{
                  color: C.muted,
                  fontSize: 12,
                  textAlign: "center",
                  paddingVertical: 14,
                }}
              >
                You’ve reached the end of these members.
              </T>
            ))}
          {tab === "About" && (
            <View style={[s.card, { padding: 22, gap: 16 }]}>
              <T style={{ fontSize: 19, fontWeight: "700" }}>
                A space for good company.
              </T>
              <T style={{ color: C.muted, fontSize: 14, lineHeight: 22 }}>
                {group.description}
              </T>
              <T style={s.eyebrow}>CIRCLE GUIDELINES</T>
              {canReadHome && currentHome?.rules.length ? (
                <View style={{ gap: 10 }}>
                  {currentHome.rules.map((rule, index) => (
                    <View
                      key={`${index}:${rule}`}
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
              ) : (
                <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
                  {!canReadHome
                    ? "Circle guidelines are shared with approved members."
                    : currentHome
                      ? "This circle hasn’t configured any guidelines yet."
                      : homeUi.isLoading
                        ? "Checking this circle’s guidelines…"
                        : homeUi.isError
                          ? "We couldn’t confirm this circle’s guidelines right now."
                          : "Circle guidelines aren’t available right now."}
                </T>
              )}
              {user && canUseCircleActivityPreferences(group.role) && (
                <CircleActivityPreference
                  key={`activity-preferences:${circleId}:${user.id}`}
                  viewerId={user.id}
                  circleId={circleId}
                />
              )}
              {group.joined && group.role !== "owner" && (
                <Button
                  title="Leave this circle"
                  secondary
                  onPress={() => updateMembership(false)}
                  loading={isMembershipPending}
                  disabled={isMembershipPending}
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
          {tab === "Manage" && manageTabAvailable && (
            <View style={{ gap: 20 }}>
              <T style={{ fontSize: 18, fontWeight: "700" }}>
                Look after your people.
              </T>
              <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
                Owners appoint moderators. Owners and moderators keep the circle
                welcoming.
              </T>
              {isAdmin && (
                <View style={[s.card, { padding: 16, gap: 10 }]}>
                  <T style={{ fontSize: 17, fontWeight: "700" }}>Reports</T>
                  <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
                    Review reported moments and record a final Keep or Remove
                    decision.
                  </T>
                  <Button
                    title="Open Reports"
                    secondary
                    icon="flag-outline"
                    onPress={() => router.push(`/moderation/${circleId}`)}
                    style={{ alignSelf: "flex-start" }}
                  />
                </View>
              )}
              <View style={{ gap: 12 }}>
                <T style={{ fontSize: 17, fontWeight: "700" }}>Circle Home</T>
                {homeEditorIsOpen ? (
                  <CircleHomeEditor
                    key={homeScopeKey}
                    scopeKey={homeScopeKey}
                    circleId={circleId}
                    home={currentHome}
                    canEdit={canManageHome}
                    isAuthorityAvailable={homeUi.isAuthorityAvailable}
                    feedItems={feedItems}
                    hasNextFeedPage={!!feed.hasNextPage}
                    isFetchingNextFeedPage={feed.isFetchingNextPage}
                    onLoadMoreFeedItems={() => void feed.fetchNextPage()}
                    onClose={() => setHomeEditorScope(null)}
                  />
                ) : canManageHome ? (
                  <View style={[s.card, { padding: 16, gap: 10 }]}>
                    <T style={{ color: C.muted, fontSize: 14, lineHeight: 21 }}>
                      Set the welcome, circle guidelines, and one pinned
                      existing moment.
                    </T>
                    <Button
                      title="Edit Circle Home"
                      secondary
                      onPress={() => setHomeEditorScope(homeScopeKey)}
                      style={{ alignSelf: "flex-start" }}
                    />
                  </View>
                ) : (
                  <T style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>
                    {homeUi.isLoading
                      ? "Checking Home editing permission…"
                      : homeUi.isError
                        ? "Home editing is unavailable until permissions can be confirmed."
                        : "Home editing is unavailable until permissions can be confirmed."}
                  </T>
                )}
              </View>
              {memberItems.map((member) => (
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
              {feedItems.map((post) => (
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
