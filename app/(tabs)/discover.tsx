import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
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
import { resolveFnd001QueryDisplayState } from "@/lib/fnd001-query-display-state";
import { invalidateProfileViews } from "@/lib/source-query-invalidation";
import {
  getBoundedLoadedCollection,
  UI_COLLECTION_PAGE_SIZE,
  type LoadedCollectionEndState,
} from "@/lib/feed-ui-helpers";
import { AppShell } from "@/components/app-shell";
import { CircleCard } from "@/components/circle-card";
import { PostCard } from "@/components/post-card";
import { StatusMessage } from "@/components/status-message";
import { UserAvatar } from "@/components/user-avatar";
import {
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

type ScopedFollowValues = { scope: string; values: Record<number, boolean> };
type ScopedFollowPending = { scope: string; ids: Set<number> };
type ScopedFollowError = { scope: string; personId: number; message: string };

function CollectionFooter({
  itemLabel,
  canAppend,
  endState,
  onAppend,
  isLoading = false,
}: {
  itemLabel: string;
  canAppend: boolean;
  endState: LoadedCollectionEndState;
  onAppend: () => void;
  isLoading?: boolean;
}) {
  if (canAppend) {
    return (
      <Button
        title={`Show more ${itemLabel}`}
        secondary
        loading={isLoading}
        disabled={isLoading}
        onPress={onAppend}
        style={{ alignSelf: "center", marginTop: 4 }}
      />
    );
  }

  return (
    <T
      style={{
        color: C.secondary,
        fontSize: 12,
        lineHeight: 18,
        textAlign: "center",
      }}
    >
      {endState === "continuation-unavailable"
        ? `This loaded ${itemLabel} page is full. Refine your search or try again for a fresh page.`
        : `You’ve reached the end of these ${itemLabel}.`}
    </T>
  );
}

export default function DiscoverScreen() {
  const { user } = useCircles();
  const discoverScope = batch3AccountResourceScope(user?.id, "discover");

  return <DiscoverScreenInstance key={discoverScope ?? "guest:discover"} />;
}

function DiscoverScreenInstance() {
  const router = useRouter();
  const { user, requireAuth, notify } = useCircles();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("For you");
  const [livesVisibleCount, setLivesVisibleCount] = useState(
    UI_COLLECTION_PAGE_SIZE,
  );
  const [followingByPersonId, setFollowingByPersonId] =
    useState<ScopedFollowValues | null>(null);
  const [pendingFollow, setPendingFollow] =
    useState<ScopedFollowPending | null>(null);
  const [followError, setFollowError] = useState<ScopedFollowError | null>(
    null,
  );
  const discoverScope = batch3AccountResourceScope(user?.id, "discover");
  const mountedScope = useRef<Batch3AccountResourceOperation | null>(null);
  const scopeGeneration = useRef(0);
  const followFlight = useRef(createBatch3AccountResourceSingleFlight());
  useEffect(() => {
    if (!discoverScope) {
      mountedScope.current = null;
      return;
    }

    const operation = {
      scope: discoverScope,
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
  }, [discoverScope]);
  const isCurrentDiscoverScope = (
    capturedScope: Batch3AccountResourceOperation,
  ) =>
    isCurrentBatch3AccountResourceOperation(
      mountedScope.current,
      capturedScope,
    );
  const people = trpc.social.profilesPage.useInfiniteQuery(
    { search, limit: UI_COLLECTION_PAGE_SIZE },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );
  const circles = trpc.social.circlesPage.useInfiniteQuery(
    { search, limit: UI_COLLECTION_PAGE_SIZE },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );
  const feed = trpc.social.feedPage.useInfiniteQuery(
    { filter: "for-you", search, limit: UI_COLLECTION_PAGE_SIZE },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );
  const lives = trpc.live.list.useQuery({ search });
  const changeSearch = (value: string) => {
    setSearch(value);
    setLivesVisibleCount(UI_COLLECTION_PAGE_SIZE);
  };
  const changeTab = (value: string) => {
    setTab(value);
    setLivesVisibleCount(UI_COLLECTION_PAGE_SIZE);
  };
  const peopleItems = people.data?.pages.flatMap((page) => page.items) ?? [];
  const circleItems = circles.data?.pages.flatMap((page) => page.items) ?? [];
  const feedItems = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const peopleDisplayState = resolveFnd001QueryDisplayState({
    isLoading: people.isLoading,
    isError: people.isError,
    hasContent: peopleItems.length > 0 || !!people.hasNextPage,
  });
  const circlesDisplayState = resolveFnd001QueryDisplayState({
    isLoading: circles.isLoading,
    isError: circles.isError,
    hasContent: circleItems.length > 0 || !!circles.hasNextPage,
  });
  const livesDisplayState = resolveFnd001QueryDisplayState({
    isLoading: lives.isLoading,
    isError: lives.isError,
    hasContent: !!lives.data?.length,
  });
  const utils = trpc.useUtils();
  const follow = trpc.social.follow.useMutation();
  const feedDisplayState = resolveFnd001QueryDisplayState({
    isLoading: feed.isLoading,
    isError: feed.isError,
    hasContent: feedItems.length > 0 || !!feed.hasNextPage,
  });
  const livesPage = getBoundedLoadedCollection(lives.data, livesVisibleCount);
  const isRouteFollowPending =
    pendingFollow?.scope === discoverScope && pendingFollow.ids.size > 0;
  const requestFollow = (personId: number, currentlyFollowing: boolean) => {
    requireAuth(() => {
      const capturedScope = mountedScope.current;
      if (
        !capturedScope ||
        capturedScope.scope !== discoverScope ||
        !followFlight.current.start(capturedScope)
      ) {
        return;
      }
      setPendingFollow((current) => {
        const ids = new Set<number>(
          current?.scope === capturedScope.scope ? current.ids : [],
        );
        ids.add(personId);
        return { scope: capturedScope.scope, ids };
      });
      setFollowError((current) =>
        current?.scope === capturedScope.scope && current.personId === personId
          ? null
          : current,
      );
      follow.mutate(
        { userId: personId, following: !currentlyFollowing },
        {
          onSuccess: (result) => {
            followFlight.current.finish(capturedScope);
            if (!isCurrentDiscoverScope(capturedScope)) return;
            setFollowingByPersonId((current) => ({
              scope: capturedScope.scope,
              values: {
                ...(current?.scope === capturedScope.scope
                  ? current.values
                  : {}),
                [personId]: result.following,
              },
            }));
            setPendingFollow((current) => {
              if (current?.scope !== capturedScope.scope) return current;
              const ids = new Set<number>(current.ids);
              ids.delete(personId);
              return { scope: capturedScope.scope, ids };
            });
            void invalidateProfileViews(utils);
            notify("Your connections have been updated.", "success");
          },
          onError: () => {
            followFlight.current.finish(capturedScope);
            if (!isCurrentDiscoverScope(capturedScope)) return;
            const message =
              "We couldn’t update this connection. Check your connection and try again.";
            setPendingFollow((current) => {
              if (current?.scope !== capturedScope.scope) return current;
              const ids = new Set<number>(current.ids);
              ids.delete(personId);
              return { scope: capturedScope.scope, ids };
            });
            setFollowError({
              scope: capturedScope.scope,
              personId,
              message,
            });
            notify(message, "error");
          },
        },
      );
    });
  };
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
          <Icon name="search-outline" size={19} color={C.secondary} />
          <TextInput
            placeholder="People, passions, places…"
            value={search}
            onChangeText={changeSearch}
            maxLength={80}
            accessibilityLabel="Search people, circles, posts, and live moments"
            placeholderTextColor={C.secondary}
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
              color={C.secondary}
              label="Clear search"
              onPress={() => changeSearch("")}
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
              onPress={() => changeTab(item)}
            />
          ))}
        </ScrollView>
      </View>
      {(tab === "For you" || tab === "People") && (
        <View style={[contentWidth, { marginTop: 25, gap: 15 }]}>
          <View style={s.between}>
            <T style={{ fontSize: 17, fontWeight: "700" }}>People to know</T>
            <T style={{ fontSize: 12, lineHeight: 18, color: C.secondary }}>
              MAKE A CONNECTION
            </T>
          </View>
          {isRouteFollowPending && (
            <StatusMessage
              testID="discover-follow-flight-status"
              tone="info"
              message="Updating a connection. Other Follow actions are temporarily unavailable."
              style={{ fontSize: 12, lineHeight: 18 }}
            />
          )}
          {peopleDisplayState === "loading" ? (
            <Loading />
          ) : peopleDisplayState === "error" ? (
            <Empty
              icon="people-outline"
              title="We couldn’t load people to know."
              text="Check your connection and try again."
              action="Try again"
              onAction={() => void people.refetch()}
            />
          ) : peopleDisplayState === "empty" ? (
            <Empty
              title="No people found."
              text="Try another name or handle."
            />
          ) : (
            peopleItems.map((person) => {
              const isFollowing =
                (followingByPersonId?.scope === discoverScope
                  ? followingByPersonId.values[person.id]
                  : undefined) ?? person.isFollowing;
              const isFollowPending =
                pendingFollow?.scope === discoverScope &&
                pendingFollow.ids.has(person.id);
              const isFollowBlocked = isRouteFollowPending && !isFollowPending;
              const followAction = isFollowing ? "Unfollow" : "Follow";
              const followTitle = isFollowPending
                ? "Updating"
                : isFollowBlocked
                  ? "Please wait"
                  : isFollowing
                    ? "Following"
                    : "Follow";
              const followAccessibilityLabel = isFollowPending
                ? `Updating connection with ${person.name}`
                : isFollowBlocked
                  ? `${followAction} ${person.name} unavailable while another connection is updating`
                  : `${followAction} ${person.name}`;
              const followErrorText =
                followError?.scope === discoverScope &&
                followError.personId === person.id
                  ? followError.message
                  : null;
              return (
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
                  <Pressable
                    onPress={() => router.push(`/person/${person.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${person.name}'s profile`}
                    style={{ minWidth: 48, minHeight: 48 }}
                  >
                    <UserAvatar
                      uri={person.avatar}
                      name={person.name}
                      size={48}
                      userId={person.id}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => router.push(`/person/${person.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${person.name}'s profile`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      minHeight: 44,
                      justifyContent: "center",
                    }}
                  >
                    <T
                      style={{
                        fontWeight: "700",
                        fontSize: 14,
                        lineHeight: 20,
                      }}
                    >
                      {person.name}
                    </T>
                    <T
                      style={{
                        color: C.secondary,
                        fontSize: 12,
                        lineHeight: 18,
                      }}
                    >
                      @{person.handle}
                    </T>
                    <T
                      numberOfLines={2}
                      style={{
                        color: C.secondary,
                        fontSize: 14,
                        lineHeight: 21,
                      }}
                    >
                      {person.bio}
                    </T>
                    {followErrorText && (
                      <T
                        accessibilityRole="alert"
                        style={{
                          color: C.secondary,
                          fontSize: 12,
                          lineHeight: 18,
                        }}
                      >
                        {followErrorText} Try again when you’re ready.
                      </T>
                    )}
                  </Pressable>
                  <Button
                    title={followTitle}
                    accessibilityLabel={followAccessibilityLabel}
                    secondary={isFollowing}
                    loading={isFollowPending}
                    disabled={isFollowPending || isFollowBlocked}
                    onPress={() => requestFollow(person.id, !!isFollowing)}
                    style={{
                      paddingHorizontal: 11,
                      borderRadius: 9,
                    }}
                  />
                </View>
              );
            })
          )}
          {peopleDisplayState === "content" && (
            <CollectionFooter
              itemLabel="people"
              canAppend={!!people.hasNextPage}
              endState={people.hasNextPage ? "more-loaded" : "end"}
              onAppend={() => void people.fetchNextPage()}
              isLoading={people.isFetchingNextPage}
            />
          )}
        </View>
      )}
      {(tab === "For you" || tab === "Circles") && (
        <View style={[contentWidth, { marginTop: 27 }]}>
          <T style={{ fontSize: 17, fontWeight: "700", marginBottom: 16 }}>
            A circle for your thing
          </T>
          {circlesDisplayState === "loading" ? (
            <Loading />
          ) : circlesDisplayState === "error" ? (
            <Empty
              icon="ellipse-outline"
              title="We couldn’t load circles."
              text="Check your connection and try again."
              action="Try again"
              onAction={() => void circles.refetch()}
            />
          ) : circlesDisplayState === "empty" ? (
            <Empty
              title="No circles found."
              text="A new passion deserves a new circle."
            />
          ) : (
            circleItems
              .slice(0, tab === "For you" ? 2 : undefined)
              .map((circle) => <CircleCard key={circle.id} circle={circle} />)
          )}
          {circlesDisplayState === "content" && tab === "Circles" && (
            <CollectionFooter
              itemLabel="circles"
              canAppend={!!circles.hasNextPage}
              endState={circles.hasNextPage ? "more-loaded" : "end"}
              onAppend={() => void circles.fetchNextPage()}
              isLoading={circles.isFetchingNextPage}
            />
          )}
        </View>
      )}
      {tab === "Posts" && (
        <View style={[contentWidth, { marginTop: 24 }]}>
          {feedDisplayState === "loading" ? (
            <Loading />
          ) : feedDisplayState === "error" ? (
            <Empty
              icon="images-outline"
              title="We couldn’t load moments."
              text="Check your connection and try again."
              action="Try again"
              onAction={() => void feed.refetch()}
            />
          ) : feedDisplayState === "empty" ? (
            <Empty
              title="No moments found."
              text="Try another word or explore a circle."
            />
          ) : (
            feedItems.map((post) => <PostCard key={post.id} post={post} />)
          )}
          {feedDisplayState === "content" && (
            <CollectionFooter
              itemLabel="moments"
              canAppend={!!feed.hasNextPage}
              endState={feed.hasNextPage ? "more-loaded" : "end"}
              onAppend={() => void feed.fetchNextPage()}
              isLoading={feed.isFetchingNextPage}
            />
          )}
        </View>
      )}
      {tab === "Live" && (
        <View style={[contentWidth, { marginTop: 25 }]}>
          {livesDisplayState === "loading" ? (
            <Loading />
          ) : livesDisplayState === "error" ? (
            <Empty
              icon="radio-outline"
              title="We couldn’t load live moments."
              text="Check your connection and try again."
              action="Try again"
              onAction={() => void lives.refetch()}
            />
          ) : livesDisplayState === "content" ? (
            livesPage.items.map((live) => (
              <Pressable
                key={live.id}
                onPress={() => router.push(`/live/${live.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open live moment: ${live.title} by ${live.host.name}, ${live.viewers} watching`}
                accessibilityHint="Open this live moment"
                style={[
                  s.card,
                  { overflow: "hidden", marginBottom: 15, minHeight: 44 },
                ]}
              >
                <Image
                  source={{ uri: live.thumbnail }}
                  style={{ width: "100%", height: 180 }}
                  contentFit="cover"
                  accessible={false}
                />
                <View style={{ padding: 15 }}>
                  <T style={{ fontWeight: "700" }}>{live.title}</T>
                  <T style={{ fontSize: 12, color: C.secondary }}>
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
          {livesDisplayState === "content" && (
            <CollectionFooter
              itemLabel="live moments"
              canAppend={livesPage.canAppend}
              endState={livesPage.endState}
              onAppend={() => setLivesVisibleCount(livesPage.nextVisibleCount)}
            />
          )}
        </View>
      )}
    </AppShell>
  );
}
