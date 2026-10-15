import React from 'react';
import { FlatList, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  ActionButton,
  Avatar,
  CircleTile,
  EmptyState,
  Icon,
  Pill,
  PostCard,
  SectionTitle,
  TopBar,
} from '../components/Primitives';
import { DiscoveryControls, experienceStyles as ex } from '../components/Experience';
import { SavedPostsButton } from '../components/PostActions';
import { LoadingCards } from '../components/LoadingCards';
import { recommendationReason, defaultDiscovery, type DiscoveryOptions } from '../lib/experience';
import { colors } from '../theme';
import { styles } from '../appStyles';
import type { Circle, CircleJoinRequest, CirclePost, LiveSession, Profile, UUID } from '../types';
export function HomeScreen({
  stories,
  loading,
  refreshing,
  error,
  onRefresh,
  onActivity,
  unreadActivity,
  profile,
  circles,
  lives,
  feed,
  feedHasMore,
  feedLoadingMore,
  onLoadMore,
  onProfile,
  onLive,
  onLiveList,
  onCreatePost,
  onExplore,
  onLike,
  onReply,
  onReport,
  onCircle,
}: {
  stories?: React.ReactNode;
  loading: boolean;
  refreshing: boolean;
  error: string;
  onRefresh: () => void;
  onActivity: () => void;
  unreadActivity: number;
  profile: Profile;
  circles: Circle[];
  lives: LiveSession[];
  feed: CirclePost[];
  feedHasMore: boolean;
  feedLoadingMore: boolean;
  onLoadMore: () => void;
  onProfile: () => void;
  onLive: (session: LiveSession) => void;
  onLiveList: () => void;
  onCreatePost: () => void;
  onExplore: () => void;
  onLike: (id: UUID) => void;
  onReply: (post: CirclePost) => void;
  onReport: (
    kind: 'post' | 'profile' | 'circle' | 'message' | 'live_session',
    id: UUID,
    user?: UUID,
  ) => void;
  onCircle: (circle: Circle) => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <FlatList
      data={feed}
      keyExtractor={(post) => post.id}
      contentContainerStyle={styles.pageContent}
      refreshing={refreshing}
      onRefresh={onRefresh}
      initialNumToRender={5}
      maxToRenderPerBatch={5}
      windowSize={7}
      ListHeaderComponent={
        <>
          <TopBar
            profile={profile}
            onProfile={onProfile}
            onActivity={onActivity}
            unreadActivity={unreadActivity}
          />
          <View style={styles.greeting}>
            <Text style={styles.greetingTitle}>
              {greeting}, {profile.displayName.split(' ')[0]}.
            </Text>
            <Text style={styles.greetingCopy}>A little closer to your people.</Text>
          </View>
          {stories}
          <View style={styles.quickActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share a thought"
              style={styles.quickAction}
              onPress={onCreatePost}
            >
              <Icon name="edit" color={colors.coral} />
              <Text style={styles.quickText}>Share a thought</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[styles.quickAction, styles.quickActionTint]}
              onPress={onExplore}
            >
              <Icon name="plus" />
              <Text style={styles.quickText}>Find circles</Text>
            </Pressable>
          </View>
          {lives.length ? (
            <View style={styles.sectionPad}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12 }}
              >
                {lives.slice(0, 3).map((session) => (
                  <Pressable
                    key={session.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Join ${session.title}`}
                    onPress={() => onLive(session)}
                    style={styles.compactLive}
                  >
                    <Avatar profile={session.host} size={36} ring />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.compactLiveLabel}>Live · {session.circleName}</Text>
                      <Text numberOfLines={1} style={styles.compactLiveTitle}>
                        {session.title}
                      </Text>
                    </View>
                  </Pressable>
                ))}
                <ActionButton
                  compact
                  variant="outline"
                  label="All live rooms"
                  onPress={onLiveList}
                />
              </ScrollView>
            </View>
          ) : null}
          <View style={styles.sectionPad}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {circles
                .filter((circle) => circle.isMember)
                .map((circle) => (
                  <Pressable
                    key={circle.id}
                    accessibilityRole="button"
                    onPress={() => onCircle(circle)}
                    style={styles.circleShortcut}
                  >
                    <Image
                      source={{ uri: circle.imageUrl }}
                      style={{ width: 28, height: 28, borderRadius: 10 }}
                    />
                    <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '600' }}>
                      {circle.name}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
          <View style={styles.sectionPad}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <SectionTitle title="Your timeline" />
              <SavedPostsButton />
            </View>
            {error ? (
              <EmptyState
                emoji="☁️"
                title="Could not refresh"
                detail={error}
                action="Try again"
                onAction={onRefresh}
              />
            ) : null}
          </View>
        </>
      }
      renderItem={({ item: post }) => (
        <View style={styles.sectionPad}>
          <PostCard
            post={post}
            onLike={() => onLike(post.id)}
            onReply={() => onReply(post)}
            onOpenCircle={() => {
              const circle = circles.find((c) => c.id === post.circleId);
              if (circle) onCircle(circle);
            }}
            onMore={() => onReport('post', post.id, post.author.id)}
          />
        </View>
      )}
      ListEmptyComponent={
        loading ? (
          <LoadingCards />
        ) : (
          <View style={styles.sectionPad}>
            <EmptyState
              emoji="🌱"
              title={
                circles.some((c) => c.isMember) ? 'Start a conversation' : 'Find your first circle'
              }
              detail={
                circles.some((c) => c.isMember)
                  ? 'Share a thought, photo, or question with your people.'
                  : 'Choose a community around something you love.'
              }
              action={circles.some((c) => c.isMember) ? 'Write a post' : 'Explore circles'}
              onAction={circles.some((c) => c.isMember) ? onCreatePost : onExplore}
            />
          </View>
        )
      }
      ListFooterComponent={
        feedHasMore ? (
          <View style={styles.sectionPad}>
            <ActionButton
              compact
              variant="outline"
              label={feedLoadingMore ? 'Loading posts…' : 'Load more posts'}
              disabled={feedLoadingMore}
              onPress={onLoadMore}
            />
          </View>
        ) : null
      }
    />
  );
}

export function ExploreScreen({
  discovery = defaultDiscovery,
  onDiscovery = () => {},
  loading,
  error,
  onRetry,
  profile,
  people: suggestedPeople,
  followingIds,
  onFollow,
  onOpenProfile,
  peopleHasMore,
  peopleLoadingMore,
  onLoadMorePeople,
  circles,
  joiningCircleIds,
  circlesHasMore,
  circlesLoadingMore,
  onLoadMoreCircles,
  requested,
  requests,
  searchText,
  onSearch,
  filter,
  onFilter,
  onJoin,
  onCreate,
  onProfile,
  onReport,
  onCircle,
  onRequestDecision,
}: {
  discovery?: DiscoveryOptions;
  onDiscovery?: (value: DiscoveryOptions) => void;
  loading: boolean;
  error: string;
  onRetry: () => void;
  profile: Profile;
  people: Profile[];
  followingIds: Set<UUID>;
  onFollow: (person: Profile) => void;
  onOpenProfile: (person: Profile) => void;
  peopleHasMore: boolean;
  peopleLoadingMore: boolean;
  onLoadMorePeople: () => void;
  circles: Circle[];
  joiningCircleIds: Set<UUID>;
  circlesHasMore: boolean;
  circlesLoadingMore: boolean;
  onLoadMoreCircles: () => void;
  requested: Set<UUID>;
  requests: CircleJoinRequest[];
  searchText: string;
  onSearch: (text: string) => void;
  filter: string;
  onFilter: (filter: string) => void;
  onJoin: (circle: Circle) => void;
  onCreate: () => void;
  onProfile: () => void;
  onReport: (type: 'circle', id: UUID) => void;
  onCircle: (circle: Circle) => void;
  onRequestDecision: (request: CircleJoinRequest, accepted: boolean) => void;
}) {
  const interests = [
    'For you',
    'All',
    'Film',
    'Gardening',
    'Art',
    'Cooking',
    'Music',
    'Slow living',
  ];
  const rows: (
    | { kind: 'person'; value: Profile }
    | { kind: 'circle'; value: Circle }
    | { kind: 'heading'; value: string }
  )[] = [
    { kind: 'heading', value: 'Circles to explore' },
    ...circles.map((value) => ({ kind: 'circle' as const, value })),
    { kind: 'heading', value: 'People to meet' },
    ...suggestedPeople.map((value) => ({ kind: 'person' as const, value })),
  ];
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => (item.kind === 'heading' ? item.value : item.kind + item.value.id)}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={8}
      windowSize={7}
      refreshing={loading}
      onRefresh={onRetry}
      ListHeaderComponent={
        <>
          <TopBar profile={profile} onProfile={onProfile} />
          <View style={styles.screenHeading}>
            <Text style={styles.screenTitle}>Explore circles</Text>
            <Text style={styles.screenCopy}>Search communities and people across Circles.</Text>
          </View>
          <View style={styles.searchBox}>
            <TextInput
              accessibilityLabel="Search all circles and people"
              value={searchText}
              onChangeText={onSearch}
              placeholder="Try film, baking, or a member’s name"
              placeholderTextColor={colors.muted}
              style={[styles.searchInput, { flex: 1 }]}
            />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {interests.map((item) => (
              <Pill
                key={item}
                label={item}
                selected={filter === item}
                onPress={() => onFilter(item)}
              />
            ))}
          </ScrollView>
          <DiscoveryControls
            value={discovery}
            onChange={onDiscovery}
            onClear={() => {
              onSearch('');
              onFilter('For you');
            }}
          />
          <View style={styles.sectionPad}>
            <ActionButton compact label="Create a circle" onPress={onCreate} />
            {requests.map((request) => (
              <View key={request.id} style={styles.conversationRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.conversationName}>{request.requester.displayName}</Text>
                  <Text style={styles.conversationPreview}>{request.circleName}</Text>
                </View>
                <ActionButton
                  compact
                  label="Accept"
                  onPress={() => onRequestDecision(request, true)}
                />
                <ActionButton
                  compact
                  variant="outline"
                  label="Decline"
                  onPress={() => onRequestDecision(request, false)}
                />
              </View>
            ))}
            {error ? (
              <EmptyState
                emoji="☁️"
                title="Search is unavailable"
                detail={error}
                action="Retry search"
                onAction={onRetry}
              />
            ) : null}
            {loading ? <LoadingCards /> : null}
          </View>
        </>
      }
      renderItem={({ item }) => (
        <View style={styles.sectionPad}>
          {item.kind === 'heading' ? (
            <SectionTitle title={item.value} />
          ) : item.kind === 'circle' ? (
            <>
              <Text style={ex.hint}>{recommendationReason(item.value, profile.interests)}</Text>
              <CircleTile
                circle={item.value}
                onPress={() => onCircle(item.value as Circle)}
                onJoin={() => onJoin(item.value as Circle)}
                onMore={() => onReport('circle', item.value.id)}
                requested={requested.has(item.value.id)}
                joining={joiningCircleIds.has(item.value.id)}
              />
            </>
          ) : (
            <View style={styles.conversationRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.value.displayName}'s profile`}
                onPress={() => onOpenProfile(item.value as Profile)}
                style={styles.publicProfileRow}
              >
                <Avatar profile={item.value} />
                <View style={styles.conversationMain}>
                  <Text style={styles.conversationName}>{item.value.displayName}</Text>
                  <Text style={styles.conversationPreview}>@{item.value.handle}</Text>
                </View>
              </Pressable>
              <ActionButton
                compact
                variant={followingIds.has(item.value.id) ? 'secondary' : 'outline'}
                label={followingIds.has(item.value.id) ? 'Following' : 'Follow'}
                onPress={() => onFollow(item.value as Profile)}
              />
            </View>
          )}
        </View>
      )}
      ListFooterComponent={
        <View style={styles.sectionPad}>
          {!loading && !circles.length && !suggestedPeople.length ? (
            <EmptyState
              emoji="🔎"
              title="No matches yet"
              detail="Try another name or interest, or create a circle."
            />
          ) : null}
          {peopleHasMore ? (
            <ActionButton
              compact
              label={peopleLoadingMore ? 'Loading…' : 'More people'}
              disabled={peopleLoadingMore}
              onPress={onLoadMorePeople}
            />
          ) : null}
          {circlesHasMore ? (
            <ActionButton
              compact
              label={circlesLoadingMore ? 'Loading…' : 'More circles'}
              disabled={circlesLoadingMore}
              onPress={onLoadMoreCircles}
            />
          ) : null}
        </View>
      }
    />
  );
}
