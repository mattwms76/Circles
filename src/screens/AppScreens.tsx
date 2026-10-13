import { createTextDraftStore } from '../lib/textDraftStore';
import {
  DiscoveryControls,
  ScheduledRooms,
  ReactionBar,
  useContentReactions,
  experienceStyles as ex,
} from '../components/Experience';
import {
  recommendationReason,
  defaultDiscovery,
  type DiscoveryOptions,
  searchMessages,
  conversationMuted,
  muteConversation,
  loadGiftFavourites,
  saveGiftFavourites,
} from '../lib/experience';
import { supabase } from '../lib/supabase';
import { canDeleteOwnContent, CONTENT_DELETE_WINDOW_MS } from '../lib/contentDeletion';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { AgoraVideoTile, agoraUidFor } from '../lib/streaming';
import {
  ActionButton,
  Avatar,
  CircleTile,
  EmptyState,
  Pill,
  PostCard,
  SectionTitle,
  TopBar,
  formatCount,
} from '../components/Primitives';
import { colors } from '../theme';
import { styles } from '../appStyles';
import type {
  Circle,
  CircleJoinRequest,
  CirclePost,
  Conversation,
  DirectMessage,
  Gift,
  LiveGiftEvent,
  LiveSession,
  PostComment,
  Profile,
  UUID,
} from '../types';

export type Tab = 'home' | 'circles' | 'live' | 'inbox' | 'profile';
export type Attachment = {
  uri: string;
  mimeType: string;
  fileName: string;
  kind: 'image' | 'gif' | 'video';
};

export function HomeScreen({
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
  const today = new Date()
    .toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();
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
          <TopBar profile={profile} onProfile={onProfile} />
          <View style={styles.greeting}>
            <Text style={styles.greetingEyebrow}>{today}</Text>
            <Text style={styles.greetingTitle}>A place to find{'\n'}your people.</Text>
            <Text style={styles.greetingCopy}>
              {greeting}, {profile.displayName.split(' ')[0]}. What feels like you today?
            </Text>
          </View>
          <View style={styles.quickActions}>
            <Pressable style={styles.quickAction} onPress={onCreatePost}>
              <Text style={styles.quickEmoji}>✎</Text>
              <Text style={styles.quickText}>Share a thought</Text>
            </Pressable>
            <Pressable
              style={[styles.quickAction, styles.quickActionTint]}
              onPress={() => (lives[0] ? onLive(lives[0]) : onExplore())}
            >
              <Text style={styles.quickEmoji}>◉</Text>
              <Text style={styles.quickText}>
                {lives.length ? 'Join something live' : 'Explore circles'}
              </Text>
            </Pressable>
          </View>
          <View style={styles.sectionPad}>
            <SectionTitle
              eyebrow="HAPPENING NOW"
              title="Live in your circles"
              action="See all"
              onAction={onLiveList}
            />
            {lives.slice(0, 2).map((session, index) => (
              <Pressable
                key={session.id}
                onPress={() => onLive(session)}
                style={[styles.liveFeature, index === 1 && { backgroundColor: colors.night }]}
              >
                <ImageBackground
                  source={{
                    uri:
                      index === 0
                        ? 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=900&h=600&fit=crop'
                        : 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=900&h=600&fit=crop',
                  }}
                  style={styles.liveFeatureImage}
                  imageStyle={{ borderRadius: 23 }}
                >
                  <View style={styles.liveShade} />
                  <View style={styles.liveTop}>
                    <View style={styles.liveBadge}>
                      <View style={styles.liveDot} />
                      <Text style={styles.liveBadgeText}>LIVE</Text>
                    </View>
                    <Text style={styles.viewerChip}>◉ {formatCount(session.viewerCount)}</Text>
                  </View>
                  <View style={styles.liveBottom}>
                    <View style={styles.liveHost}>
                      <Avatar profile={session.host} size={35} ring />
                      <View>
                        <Text style={styles.liveHostName}>{session.host.displayName}</Text>
                        <Text style={styles.liveCircleName}>{session.circleName}</Text>
                      </View>
                    </View>
                    <View style={styles.playButton}>
                      <Text style={styles.playText}>▶</Text>
                    </View>
                  </View>
                  <Text numberOfLines={1} style={styles.liveFeatureTitle}>
                    {session.title}
                  </Text>
                </ImageBackground>
              </Pressable>
            ))}
          </View>
          <View style={styles.sectionPad}>
            <SectionTitle
              eyebrow="YOUR LITTLE CORNERS"
              title="Your circles"
              action="Explore"
              onAction={onExplore}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 22 }}
            >
              {circles
                .filter((circle) => circle.isMember)
                .map((circle) => (
                  <Pressable
                    key={circle.id}
                    onPress={() => onCircle(circle)}
                    style={[styles.miniCircle, { backgroundColor: circle.color }]}
                  >
                    <Text style={styles.miniCircleEmoji}>
                      {circle.interest === 'Film'
                        ? '🎞️'
                        : circle.interest === 'Gardening'
                          ? '🌱'
                          : circle.interest === 'Music'
                            ? '🎧'
                            : '🫶'}
                    </Text>
                    <Text numberOfLines={2} style={styles.miniCircleName}>
                      {circle.name}
                    </Text>
                    <Text style={styles.miniCircleCount}>
                      {formatCount(circle.members)} members
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
          <View style={styles.sectionPad}>
            <ActionButton
              compact
              variant="outline"
              label={`Activity${unreadActivity ? ` · ${unreadActivity} unread` : ''}`}
              onPress={onActivity}
            />
            <SectionTitle
              eyebrow="FROM YOUR PEOPLE"
              title="The latest"
              action="Write a post"
              onAction={onCreatePost}
            />
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
    { kind: 'heading', value: 'People to meet' },
    ...suggestedPeople.map((value) => ({ kind: 'person' as const, value })),
    { kind: 'heading', value: 'Circles to explore' },
    ...circles.map((value) => ({ kind: 'circle' as const, value })),
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
            <Text style={styles.screenEyebrow}>FIND YOUR PEOPLE</Text>
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

export function LiveScreen({
  circles = [],
  refreshing,
  onRefresh,
  profile,
  lives,
  onProfile,
  onLive,
  onStart,
}: {
  circles?: Circle[];
  refreshing: boolean;
  onRefresh: () => void;
  profile: Profile;
  lives: LiveSession[];
  onProfile: () => void;
  onLive: (session: LiveSession) => void;
  onStart: () => void;
}) {
  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
    >
      <TopBar profile={profile} onProfile={onProfile} />
      <View style={styles.screenHeading}>
        <Text style={styles.screenEyebrow}>A LITTLE LIVE MAGIC</Text>
        <Text style={styles.screenTitle}>Come hang{'\n'}for a while.</Text>
        <Text style={styles.screenCopy}>
          Drop into a live room, say hello, and share the moment.
        </Text>
      </View>
      <View style={styles.goLiveCard}>
        <View style={styles.goLiveOrb}>
          <Text style={styles.goLiveOrbText}>◉</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.goLiveTitle}>Your turn to host?</Text>
          <Text style={styles.goLiveCopy}>Invite up to three people onto the stage.</Text>
        </View>
        <ActionButton compact label="Go live" onPress={onStart} />
      </View>
      <ScheduledRooms profile={profile} circles={circles} onLive={onLive} />
      <View style={styles.sectionPad}>
        <SectionTitle eyebrow="RIGHT NOW" title={`${lives.length} rooms are live`} />
        {lives.map((session, index) => (
          <Pressable key={session.id} onPress={() => onLive(session)} style={styles.liveListCard}>
            <ImageBackground
              source={{
                uri: [
                  'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=900&h=600&fit=crop',
                  'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=900&h=600&fit=crop',
                  'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=900&h=600&fit=crop',
                ][index % 3],
              }}
              style={styles.liveListImage}
              imageStyle={{ borderRadius: 22 }}
            >
              <View style={styles.liveShade} />
              <View style={styles.liveTop}>
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveBadgeText}>LIVE</Text>
                </View>
                <Text style={styles.viewerChip}>◉ {formatCount(session.viewerCount)} watching</Text>
              </View>
              <View style={styles.liveListBottom}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.liveListCircle}>
                    {session.circleName ?? 'Around Circles'}
                  </Text>
                  <Text numberOfLines={2} style={styles.liveListTitle}>
                    {session.title}
                  </Text>
                  <View style={styles.liveListHost}>
                    <Avatar profile={session.host} size={26} />
                    <Text style={styles.liveListName}>{session.host.displayName}</Text>
                  </View>
                </View>
                <View style={styles.playButton}>
                  <Text style={styles.playText}>▶</Text>
                </View>
              </View>
            </ImageBackground>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

export function InboxScreen({
  profile,
  conversations,
  onProfile,
  onConversation,
}: {
  profile: Profile;
  conversations: Conversation[];
  onProfile: () => void;
  onConversation: (conversation: Conversation) => void;
}) {
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [query, setQuery] = useState('');
  const visible = conversations.filter(
    (c) =>
      (!onlyUnread || c.unread > 0) &&
      c.peer.displayName.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <ScrollView contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
      <TopBar profile={profile} onProfile={onProfile} />
      <View style={styles.screenHeading}>
        <Text style={styles.screenEyebrow}>ONE TO ONE</Text>
        <Text style={styles.screenTitle}>Messages</Text>
        <Text style={styles.screenCopy}>Good conversations start with a follow both ways.</Text>
      </View>
      <View style={styles.messageBanner}>
        <Text style={styles.messageBannerEmoji}>💌</Text>
        <Text style={styles.messageBannerCopy}>
          Your inbox is for the people who follow you back.
        </Text>
      </View>
      <View style={styles.sectionPad}>
        <SectionTitle eyebrow="YOUR PEOPLE" title="Recent chats" />
        <TextInput
          accessibilityLabel="Find a conversation"
          placeholder="Find a conversation"
          value={query}
          onChangeText={setQuery}
          style={ex.field}
        />
        <View style={ex.row}>
          <Pill
            label="All conversations"
            selected={!onlyUnread}
            onPress={() => setOnlyUnread(false)}
          />
          <Pill label="Unread" selected={onlyUnread} onPress={() => setOnlyUnread(true)} />
        </View>
        {visible.length === 0 && conversations.length > 0 ? (
          <Text style={ex.body}>
            No conversations match. Try All conversations or clear the search.
          </Text>
        ) : null}
        {visible.map((conversation) => (
          <Pressable
            key={conversation.id}
            onPress={() => onConversation(conversation)}
            style={styles.conversationRow}
          >
            <Avatar profile={conversation.peer} size={52} />
            <View style={styles.conversationMain}>
              <View style={styles.conversationHead}>
                <Text style={styles.conversationName}>{conversation.peer.displayName}</Text>
                <Text style={styles.conversationTime}>
                  {conversation.messages.at(-1)?.createdAt ?? ''}
                </Text>
              </View>
              <Text numberOfLines={1} style={styles.conversationPreview}>
                {conversation.messages.at(-1)?.body ?? 'Say hello 👋'}
              </Text>
            </View>
            {conversation.unread > 0 ? (
              <View style={styles.unreadDot}>
                <Text style={styles.unreadText}>{conversation.unread}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
        {conversations.length === 0 ? (
          <EmptyState
            emoji="🌱"
            title="A little quiet in here"
            detail="When you and someone else follow each other, your chat will show up here."
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

export function ProfileScreen({
  onSettings,
  onForgotPassword,
  onOnboarding,
  profile,
  circles,
  followers,
  following,
  walletBalance,
  followingCount,
  followerCount,
  signedIn,
  backendReady: configured,
  authEmail,
  authPassword,
  authError,
  authBusy,
  profileSaving,
  onSaveProfile,
  onEmail,
  onPassword,
  onAuth,
  onStore,
  onCircle,
  onBlockFollower,
  onOpenProfile,
  onSignOut,
}: {
  onSettings: () => void;
  onForgotPassword: () => void;
  onOnboarding: () => void;
  profile: Profile;
  circles: Circle[];
  followers: Profile[];
  following: Profile[];
  walletBalance: number;
  followingCount: number;
  followerCount: number;
  signedIn: boolean;
  backendReady: boolean;
  authEmail: string;
  authPassword: string;
  authError: string;
  authBusy: boolean;
  profileSaving: boolean;
  onSaveProfile: (
    input: Pick<Profile, 'displayName' | 'bio' | 'interests'>,
    photo?: Pick<Attachment, 'uri' | 'mimeType'>,
  ) => Promise<void>;
  onEmail: (text: string) => void;
  onPassword: (text: string) => void;
  onAuth: (kind: 'signIn' | 'signUp') => void;
  onStore: () => void;
  onCircle: (circle: Circle) => void;
  onBlockFollower: (profile: Profile) => void;
  onOpenProfile: (profile: Profile) => void;
  onSignOut: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [interests, setInterests] = useState(profile.interests.join(', '));
  const [photo, setPhoto] = useState<Pick<Attachment, 'uri' | 'mimeType'>>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoRequest = useRef(0);
  useEffect(
    () => () => {
      photoRequest.current += 1;
    },
    [],
  );
  async function choosePhoto() {
    const request = ++photoRequest.current;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.75,
      });
      if (request !== photoRequest.current || result.canceled) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType))
        throw new Error('Choose a JPG, PNG, or WebP photo.');
      if ((asset.fileSize ?? 0) > 5 * 1024 * 1024)
        throw new Error('Choose a profile photo smaller than 5 MB.');
      setPhoto({ uri: asset.uri, mimeType });
      setEditing(true);
    } catch (error) {
      if (request === photoRequest.current)
        setPhotoError(
          error instanceof Error
            ? error.message
            : 'Could not open your photos. Check photo access in your device settings.',
        );
    } finally {
      if (request === photoRequest.current) setPhotoBusy(false);
    }
  }

  useEffect(() => {
    if (!editing) {
      setPhoto(undefined);
      setPhotoError('');
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      setInterests(profile.interests.join(', '));
    }
  }, [profile.displayName, profile.bio, profile.interests, editing]);
  return (
    <ScrollView contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
      <TopBar profile={profile} />
      <View style={styles.profileHero}>
        <Avatar profile={photo ? { ...profile, avatarUrl: photo.uri } : profile} size={88} ring />
        {signedIn ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
              accessibilityState={{ disabled: photoBusy || profileSaving, busy: photoBusy }}
              disabled={photoBusy || profileSaving}
              onPress={() => void choosePhoto()}
              style={styles.profileEditButton}
            >
              <Text style={styles.profileEditText}>
                {photoBusy ? 'Opening photos…' : 'Change photo'}
              </Text>
            </Pressable>
            <Text style={styles.profileBio}>
              {photo
                ? 'New photo preview · save your profile to keep it.'
                : 'Profile photos are public. JPG, PNG or WebP · up to 5 MB.'}
            </Text>
            {photoError ? (
              <Text accessibilityRole="alert" style={styles.authError}>
                {photoError}
              </Text>
            ) : null}
          </>
        ) : null}
        {editing ? (
          <>
            <Text
              style={{ fontSize: 14, color: colors.ink, alignSelf: 'stretch', marginBottom: 4 }}
            >
              Display name
            </Text>
            <TextInput
              accessibilityLabel="Display name"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Display name"
              maxLength={60}
              style={styles.field}
            />
            <Text style={styles.profileHandle}>@{profile.handle}</Text>
            <Text
              style={{ fontSize: 14, color: colors.ink, alignSelf: 'stretch', marginBottom: 4 }}
            >
              About you
            </Text>
            <TextInput
              accessibilityLabel="About you"
              value={bio}
              onChangeText={setBio}
              placeholder="A little about you"
              maxLength={300}
              multiline
              style={styles.field}
            />
            <Text
              style={{ fontSize: 14, color: colors.ink, alignSelf: 'stretch', marginBottom: 4 }}
            >
              Interests
            </Text>
            <TextInput
              accessibilityLabel="Interests"
              value={interests}
              onChangeText={setInterests}
              placeholder="Interests, separated by commas"
              maxLength={300}
              style={styles.field}
            />
            <ActionButton
              compact
              label={profileSaving ? 'Saving…' : 'Save profile'}
              disabled={profileSaving || photoBusy || displayName.trim().length < 2}
              onPress={() =>
                void onSaveProfile(
                  {
                    displayName,
                    bio,
                    interests: [
                      ...new Set(
                        interests
                          .split(',')
                          .map((item) => item.trim())
                          .filter(Boolean),
                      ),
                    ],
                  },
                  photo,
                )
                  .then(() => setEditing(false))
                  .catch(() => {})
              }
            />
            <Pressable
              disabled={profileSaving || photoBusy}
              onPress={() => setEditing(false)}
              style={styles.profileEditCancel}
            >
              <Text style={styles.signInText}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.profileName}>{profile.displayName}</Text>
            <Text style={styles.profileHandle}>@{profile.handle}</Text>
            <Text style={styles.profileBio}>
              {profile.bio || 'Finding new corners of the internet.'}
            </Text>
            {signedIn ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing(true)}
                style={styles.profileEditButton}
              >
                <Text style={styles.profileEditText}>Edit profile</Text>
              </Pressable>
            ) : null}
          </>
        )}
        <View style={styles.profileStats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{circles.length}</Text>
            <Text style={styles.statLabel}>circles</Text>
          </View>
          <View style={styles.statLine} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{followingCount.toLocaleString()}</Text>
            <Text style={styles.statLabel}>following</Text>
          </View>
          <View style={styles.statLine} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{followerCount.toLocaleString()}</Text>
            <Text style={styles.statLabel}>followers</Text>
          </View>
        </View>
      </View>
      {signedIn ? (
        <View style={styles.sectionPad}>
          <SectionTitle eyebrow="YOUR COMMUNITY" title="Followers" />
          {followers.map((follower) => (
            <View key={follower.id} style={styles.followerRow}>
              <Pressable
                onPress={() => onOpenProfile(follower)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${follower.displayName}'s profile`}
                style={styles.publicProfileRow}
              >
                <Avatar profile={follower} size={42} />
                <View style={styles.followerInfo}>
                  <Text numberOfLines={1} style={styles.followerName}>
                    {follower.displayName}
                  </Text>
                  <Text numberOfLines={1} style={styles.followerHandle}>
                    @{follower.handle}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => onBlockFollower(follower)}
                accessibilityRole="button"
                accessibilityLabel={`Block follower ${follower.displayName}`}
                style={styles.blockFollowerButton}
              >
                <Text style={styles.blockFollowerText}>Block</Text>
              </Pressable>
            </View>
          ))}
          {followers.length === 0 ? (
            <EmptyState
              emoji="👋"
              title="No followers yet"
              detail="When someone follows you, you can manage them here."
            />
          ) : null}
        </View>
      ) : null}
      {signedIn ? (
        <View style={styles.sectionPad}>
          <SectionTitle eyebrow="YOUR COMMUNITY" title="Following" />
          {following.map((person) => (
            <Pressable
              key={person.id}
              onPress={() => onOpenProfile(person)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${person.displayName}'s profile`}
              style={styles.followerRow}
            >
              <Avatar profile={person} size={42} />
              <View style={styles.followerInfo}>
                <Text numberOfLines={1} style={styles.followerName}>
                  {person.displayName}
                </Text>
                <Text numberOfLines={1} style={styles.followerHandle}>
                  @{person.handle}
                </Text>
              </View>
            </Pressable>
          ))}
          {following.length === 0 ? (
            <EmptyState
              emoji="🌱"
              title="You’re not following anyone yet"
              detail="Find people whose interests feel like yours in Explore."
            />
          ) : null}
        </View>
      ) : null}
      <View style={styles.walletCard}>
        <View>
          <Text style={styles.walletEyebrow}>YOUR WALLET</Text>
          <Text style={styles.walletAmount}>
            ◉ {walletBalance.toLocaleString()} <Text style={styles.walletCoins}>coins</Text>
          </Text>
        </View>
        <ActionButton compact variant="dark" label="Add coins" onPress={onStore} />
      </View>
      <View style={styles.sectionPad}>
        <SectionTitle eyebrow="YOUR LITTLE CORNERS" title="Circles you’re in" />
        {circles.map((circle) => (
          <Pressable
            key={circle.id}
            onPress={() => onCircle(circle)}
            style={styles.profileCircleRow}
          >
            <View style={[styles.profileCircleIcon, { backgroundColor: circle.color }]}>
              <Text style={{ fontSize: 22 }}>
                {circle.interest === 'Film' ? '🎞️' : circle.interest === 'Gardening' ? '🌱' : '🎧'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileCircleName}>{circle.name}</Text>
              <Text style={styles.profileCircleMeta}>
                {formatCount(circle.members)} members · {circle.interest}
              </Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
          </Pressable>
        ))}
        {!signedIn && configured ? (
          <View style={styles.authCard}>
            <Text style={styles.authTitle}>Save your place here</Text>
            <Text style={styles.authCopy}>Sign in to sync your circles and meet your people.</Text>
            <Text
              style={{ fontSize: 14, color: colors.ink, alignSelf: 'stretch', marginBottom: 4 }}
            >
              Email address
            </Text>
            <TextInput
              accessibilityLabel="Email address"
              value={authEmail}
              onChangeText={onEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Email address"
              placeholderTextColor={colors.muted}
              style={styles.field}
            />
            <Text
              style={{ fontSize: 14, color: colors.ink, alignSelf: 'stretch', marginBottom: 4 }}
            >
              Password
            </Text>
            <TextInput
              accessibilityLabel="Password"
              value={authPassword}
              onChangeText={onPassword}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor={colors.muted}
              style={styles.field}
            />
            {authError ? <Text style={styles.authError}>{authError}</Text> : null}
            <View style={styles.authButtons}>
              <ActionButton
                compact
                label={authBusy ? 'Please wait…' : 'Create account'}
                onPress={() => onAuth('signUp')}
                disabled={authBusy || !authEmail || authPassword.length < 8}
              />
              <Pressable onPress={() => onAuth('signIn')}>
                <Text style={styles.signInText}>I have an account</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {signedIn ? (
          <View style={styles.sectionPad}>
            <ActionButton label="Settings and privacy" variant="outline" onPress={onSettings} />
            <ActionButton
              label="Find circles for my interests"
              variant="secondary"
              onPress={onOnboarding}
            />
          </View>
        ) : configured ? (
          <View style={styles.sectionPad}>
            <ActionButton
              compact
              variant="outline"
              label="Forgot password?"
              onPress={onForgotPassword}
            />
          </View>
        ) : null}
        {signedIn && configured ? (
          <Pressable style={styles.signOutButton} onPress={onSignOut}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

export function PublicProfileScreen({
  hasMore,
  onLoadMore,
  profile,
  followers,
  following,
  posts,
  isFollowing,
  isMutual,
  loading,
  signedIn,
  onBack,
  onFollow,
  onMessage,
  onOpenProfile,
  onLike,
  onReply,
}: {
  hasMore: boolean;
  onLoadMore: () => void;
  profile: Profile;
  followers: Profile[];
  following: Profile[];
  posts: CirclePost[];
  isFollowing: boolean;
  isMutual: boolean;
  loading: boolean;
  signedIn: boolean;
  onBack: () => void;
  onFollow: () => void;
  onMessage: () => void;
  onOpenProfile: (profile: Profile) => void;
  onLike: (id: UUID) => void;
  onReply: (post: CirclePost) => void;
}) {
  const peopleList = (title: string, users: Profile[]) => (
    <View style={styles.sectionPad}>
      <SectionTitle
        eyebrow="COMMUNITY"
        title={`${title} · ${users.length}${users.length === 100 ? '+' : ''}`}
      />
      {users.map((person) => (
        <Pressable
          key={person.id}
          onPress={() => onOpenProfile(person)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${person.displayName}'s profile`}
          style={styles.followerRow}
        >
          <Avatar profile={person} size={42} />
          <View style={styles.followerInfo}>
            <Text numberOfLines={1} style={styles.followerName}>
              {person.displayName}
            </Text>
            <Text numberOfLines={1} style={styles.followerHandle}>
              @{person.handle}
            </Text>
          </View>
          <Text style={styles.publicProfileChevron}>›</Text>
        </Pressable>
      ))}
      {!loading && users.length === 0 ? (
        <Text style={styles.publicProfileEmpty}>No {title.toLowerCase()} yet.</Text>
      ) : null}
    </View>
  );
  return (
    <FlatList
      data={posts}
      keyExtractor={(post) => post.id}
      contentContainerStyle={styles.pageContent}
      initialNumToRender={5}
      windowSize={7}
      ListHeaderComponent={
        <>
          <View style={styles.publicProfileHeader}>
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
              <Text style={styles.publicProfileBack}>‹</Text>
            </Pressable>
            <Text style={styles.publicProfileHeaderLabel}>MEMBER PROFILE</Text>
            <View style={{ width: 36 }} />
          </View>
          <View style={styles.profileHero}>
            <Avatar profile={profile} size={88} ring />
            <Text style={styles.profileName}>{profile.displayName}</Text>
            <Text style={styles.profileHandle}>@{profile.handle}</Text>
            <Text style={styles.profileBio}>
              {profile.bio || 'Finding new corners of the internet.'}
            </Text>
            <View style={styles.publicInterests}>
              {profile.interests.map((interest) => (
                <Pill key={interest} label={interest} selected={false} />
              ))}
            </View>
            {signedIn ? (
              <View style={styles.publicProfileActions}>
                <ActionButton
                  compact
                  variant={isFollowing ? 'secondary' : 'primary'}
                  label={isFollowing ? 'Following' : 'Follow'}
                  onPress={onFollow}
                />
                <ActionButton
                  compact
                  variant="outline"
                  label={isMutual ? 'Message' : 'Follow each other to message'}
                  disabled={!isMutual}
                  onPress={onMessage}
                />
              </View>
            ) : null}
            <View style={styles.profileStats}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{posts.length}</Text>
                <Text style={styles.statLabel}>posts</Text>
              </View>
              <View style={styles.statLine} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>
                  {following.length}
                  {following.length === 100 ? '+' : ''}
                </Text>
                <Text style={styles.statLabel}>following</Text>
              </View>
              <View style={styles.statLine} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>
                  {followers.length}
                  {followers.length === 100 ? '+' : ''}
                </Text>
                <Text style={styles.statLabel}>followers</Text>
              </View>
            </View>
          </View>
          {loading ? (
            <View style={styles.publicProfileLoading}>
              <Text style={styles.publicProfileEmpty}>Loading profile and community…</Text>
            </View>
          ) : null}
          {peopleList('Followers', followers)}
          {peopleList('Following', following)}
          <View style={styles.sectionPad}>
            <SectionTitle eyebrow="IN THEIR CIRCLES" title="Recent posts" />
          </View>
        </>
      }
      renderItem={({ item }) => (
        <View style={styles.sectionPad}>
          <PostCard post={item} onLike={() => onLike(item.id)} onReply={() => onReply(item)} />
        </View>
      )}
      ListEmptyComponent={
        !loading ? (
          <View style={styles.sectionPad}>
            <EmptyState
              emoji="🌱"
              title="No visible posts yet"
              detail="Posts appear here when you share a circle with this member."
            />
          </View>
        ) : (
          <LoadingCards />
        )
      }
      ListFooterComponent={
        hasMore ? (
          <View style={styles.sectionPad}>
            <ActionButton
              label={loading ? 'Loading posts…' : 'Load more posts'}
              disabled={loading}
              onPress={onLoadMore}
            />
          </View>
        ) : null
      }
    />
  );
}

export function CircleDetailScreen({
  tools,
  refreshing,
  onRefresh,
  circle,
  posts,
  postsLoading,
  requested,
  joining,
  postsHasMore,
  postsLoadingMore,
  onBack,
  onJoin,
  onLeave,
  onPost,
  onLike,
  onCreatePost,
  onLoadMore,
}: {
  tools: React.ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  circle: Circle;
  posts: CirclePost[];
  postsLoading: boolean;
  requested: boolean;
  joining: boolean;
  postsHasMore: boolean;
  postsLoadingMore: boolean;
  onBack: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onPost: (post: CirclePost) => void;
  onLike: (id: UUID) => void;
  onCreatePost: () => void;
  onLoadMore: () => void;
}) {
  return (
    <FlatList
      data={posts}
      keyExtractor={(post) => post.id}
      contentContainerStyle={styles.pageContent}
      initialNumToRender={5}
      windowSize={7}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={
        <>
          <View style={styles.publicProfileHeader}>
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back to circles"
            >
              <Text style={styles.publicProfileBack}>‹</Text>
            </Pressable>
            <Text style={styles.publicProfileHeaderLabel}>CIRCLE</Text>
            <View style={{ width: 36 }} />
          </View>
          <View style={styles.circlePageHero}>
            <ImageBackground
              source={{ uri: circle.imageUrl }}
              style={styles.circlePageCover}
              imageStyle={styles.circlePageCoverImage}
            >
              <View style={styles.circlePageShade} />
              {circle.isPrivate ? <Text style={styles.circlePagePrivate}>🔒 PRIVATE</Text> : null}
              <View style={styles.circlePageCoverCopy}>
                <Text style={styles.circlePageInterest}>{circle.interest.toUpperCase()}</Text>
                <Text style={styles.circlePageTitle}>{circle.name}</Text>
                <Text style={styles.circlePageMembers}>{formatCount(circle.members)} members</Text>
              </View>
            </ImageBackground>
          </View>
          <View style={styles.sectionPad}>
            <Text style={styles.circleDetailDescription}>
              {circle.description ||
                `A community for people who love ${circle.interest.toLowerCase()}.`}
            </Text>
            <Text style={styles.circleDetailPrivacy}>
              {circle.isPrivate
                ? 'Private circle · only members can see posts'
                : 'Public circle · everyone can discover this community'}
            </Text>
            <View style={styles.circlePageActions}>
              {!circle.isMember && !requested ? (
                <ActionButton
                  label={
                    joining ? 'Joining…' : circle.isPrivate ? 'Request to join' : 'Join this circle'
                  }
                  disabled={joining}
                  onPress={onJoin}
                />
              ) : null}
              {requested ? (
                <ActionButton
                  compact
                  variant="secondary"
                  label="Cancel join request"
                  onPress={onLeave}
                />
              ) : null}
              {circle.isMember ? (
                <>
                  <ActionButton label="Write a post in this circle" onPress={onCreatePost} />
                  {circle.isOwner ? (
                    <Text style={styles.circleOwnerNote}>
                      You own this circle. Transfer ownership before leaving.
                    </Text>
                  ) : (
                    <Pressable
                      onPress={onLeave}
                      accessibilityRole="button"
                      accessibilityLabel={`Leave ${circle.name}`}
                      style={styles.leaveCircleButton}
                    >
                      <Text style={styles.leaveCircleText}>Leave circle</Text>
                    </Pressable>
                  )}
                </>
              ) : null}
            </View>
            <View style={{ height: 16 }} />
            <SectionTitle eyebrow="YOUR COMMUNITY" title="Posts in this circle" />
            {tools}
          </View>
        </>
      }
      renderItem={({ item }) => (
        <View style={styles.sectionPad}>
          <PostCard post={item} onLike={() => onLike(item.id)} onReply={() => onPost(item)} />
        </View>
      )}
      ListEmptyComponent={
        postsLoading ? (
          <LoadingCards />
        ) : (
          <View style={styles.sectionPad}>
            <EmptyState
              emoji="🌱"
              title={circle.isMember ? 'Start the conversation' : 'Join this circle to come in'}
              detail={
                circle.isMember
                  ? 'Share the first post with your circle.'
                  : requested
                    ? 'Your request is waiting for the circle host.'
                    : 'Members can read and share posts here.'
              }
              action={circle.isMember ? 'Write a post' : undefined}
              onAction={onCreatePost}
            />
          </View>
        )
      }
      ListFooterComponent={
        postsHasMore ? (
          <View style={styles.sectionPad}>
            <ActionButton
              label={postsLoadingMore ? 'Loading posts…' : 'Load more posts'}
              disabled={postsLoadingMore}
              onPress={onLoadMore}
            />
          </View>
        ) : null
      }
    />
  );
}

export function DeleteOwnContentButton({
  ownerId,
  viewerId,
  createdAtIso,
  kind,
  onDelete,
  light = false,
}: {
  ownerId: UUID;
  viewerId: UUID;
  createdAtIso?: string;
  kind: 'message' | 'comment';
  onDelete: () => Promise<void>;
  light?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const remaining = Date.parse(createdAtIso ?? '') + CONTENT_DELETE_WINDOW_MS - Date.now();
    if (ownerId !== viewerId || !Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(refresh, remaining + 1);
    const ticker = setInterval(refresh, 1000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      clearInterval(ticker);
      listener.remove();
    };
  }, [createdAtIso, ownerId, viewerId]);
  if (!canDeleteOwnContent(ownerId, viewerId, createdAtIso, now)) return null;
  const remove = async () => {
    if (busyRef.current) return;
    if (!canDeleteOwnContent(ownerId, viewerId, createdAtIso)) {
      setNow(Date.now());
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await onDelete();
    } catch (error) {
      Alert.alert('Could not delete', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Delete ${kind} for everyone`}
      accessibilityHint="Available for 15 minutes after sending"
      disabled={busy}
      accessibilityState={{ disabled: busy, busy }}
      style={{
        minHeight: 48,
        minWidth: 60,
        justifyContent: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: 4,
      }}
      onPress={() =>
        Alert.alert(
          `Delete ${kind}?`,
          'This removes it for everyone. You can delete your own messages and comments for 15 minutes after sending.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => void remove() },
          ],
        )
      }
    >
      <Text style={{ color: light ? '#FFFFFF' : colors.coral, fontSize: 12, fontWeight: '700' }}>
        {busy
          ? 'Deleting…'
          : `Delete · ${Math.floor(Math.max(0, Date.parse(createdAtIso ?? '') + CONTENT_DELETE_WINDOW_MS - now) / 60000)}:${String(Math.floor(Math.max(0, Date.parse(createdAtIso ?? '') + CONTENT_DELETE_WINDOW_MS - now) / 1000) % 60).padStart(2, '0')}`}
      </Text>
    </Pressable>
  );
}

const contentDrafts = createTextDraftStore(AsyncStorage);

export function PostRepliesSheet({
  post,
  comments,
  profile,
  draft,
  onDraft,
  onSend,
  onDelete,
  onClose,
  loading = false,
  loadError = '',
  hasMore = false,
  onLoadMore,
  onRetry,
}: {
  post: CirclePost;
  comments: PostComment[];
  profile: Profile;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (replyToId?: string) => Promise<void>;
  onDelete: (comment: PostComment) => Promise<void>;
  onClose: () => void;
  loading?: boolean;
  loadError?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onRetry?: () => void;
}) {
  const [replyTo, setReplyTo] = useState<PostComment | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (replyTo && !comments.some((c) => c.id === replyTo.id)) setReplyTo(null);
  }, [comments, replyTo?.id]);
  const key = `circles:comment-draft:${profile.id}:${post.id}`;
  const reactionState = useContentReactions(
    'comment',
    comments.map((c) => c.id),
  );
  useEffect(() => {
    let active = true;
    setReady(false);
    void contentDrafts
      .read(key)
      .then((value) => {
        if (active) {
          onDraft(value ?? '');
          setReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setError('Could not restore your draft.');
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [key]);
  const save = (value: string) => contentDrafts.save(key, value);
  const update = (value: string) => {
    onDraft(value);
    void save(value).catch(() => {
      if (mounted.current) setError('Your draft could not be saved.');
    });
  };
  const send = async () => {
    if (!ready || !draft.trim() || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const version = contentDrafts.version(key);
    try {
      await onSend(replyTo?.id);
      if (contentDrafts.version(key) === version) {
        if (mounted.current) {
          setReplyTo(null);
          onDraft('');
        }
        try {
          await save('');
        } catch {
          if (mounted.current) setError('Reply sent, but the saved draft could not be cleared.');
        }
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Could not send your reply.');
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Sheet
      onClose={onClose}
      title="Replies"
      eyebrow={`${post.circleName.toUpperCase()} · ${comments.length}${hasMore ? '+' : ''} REPLIES`}
    >
      <View style={styles.replyPost}>
        <Text style={ex.label}>{post.author.displayName}</Text>
        <Text style={ex.body}>{post.body || 'Shared a moment with the circle.'}</Text>
      </View>
      {loading ? (
        <Text accessibilityRole="progressbar" style={ex.hint}>
          Loading replies…
        </Text>
      ) : null}
      {loadError ? (
        <View style={ex.stack}>
          <Text accessibilityRole="alert" style={ex.error}>
            {loadError}
          </Text>
          <ActionButton
            compact
            variant="outline"
            label="Retry loading replies"
            onPress={() => onRetry?.()}
          />
        </View>
      ) : null}
      {hasMore ? (
        <ActionButton
          compact
          variant="outline"
          label="Load earlier replies"
          disabled={loading}
          onPress={() => onLoadMore?.()}
        />
      ) : null}
      {comments.map((comment) => {
        const parent = comments.find((c) => c.id === comment.replyToId);
        return (
          <View key={comment.id} style={ex.card}>
            <View style={ex.row}>
              <Avatar profile={comment.author} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={ex.label}>{comment.author.displayName}</Text>
                <Text style={ex.hint}>{comment.createdAt}</Text>
              </View>
            </View>
            {comment.replyToId ? (
              <View style={ex.quote}>
                <Text style={ex.hint}>
                  Reply to {parent?.author.displayName ?? 'earlier comment'}
                </Text>
                <Text numberOfLines={2} style={ex.body}>
                  {parent?.body ?? 'Earlier comment unavailable'}
                </Text>
              </View>
            ) : null}
            <Text style={ex.body}>{comment.body}</Text>
            <ReactionBar
              items={reactionState.reactions[comment.id]}
              viewerId={profile.id}
              onReact={(emoji, remove) => void reactionState.react(comment.id, emoji, remove)}
            />
            <View style={ex.row}>
              <ActionButton
                compact
                variant="outline"
                label="Reply"
                onPress={() => setReplyTo(comment)}
              />
              <DeleteOwnContentButton
                ownerId={comment.author.id}
                viewerId={profile.id}
                createdAtIso={comment.createdAtIso}
                kind="comment"
                onDelete={() => onDelete(comment)}
              />
            </View>
          </View>
        );
      })}
      {!comments.length && !loading && !loadError ? (
        <Text style={ex.body}>No replies yet. Say hello first.</Text>
      ) : null}
      {error || reactionState.error ? (
        <Text accessibilityRole="alert" style={ex.error}>
          {error || reactionState.error}
        </Text>
      ) : null}
      {replyTo ? (
        <View style={ex.quote}>
          <Text style={ex.hint}>Replying to {replyTo.author.displayName}</Text>
          <Text numberOfLines={2} style={ex.body}>
            {replyTo.body}
          </Text>
          <ActionButton
            compact
            variant="outline"
            label="Cancel reply"
            onPress={() => setReplyTo(null)}
          />
        </View>
      ) : null}
      <Text style={ex.label}>Your reply</Text>
      <TextInput
        accessibilityLabel="Your reply"
        value={draft}
        editable={ready && !busy}
        onChangeText={update}
        placeholder="Write a reply…"
        placeholderTextColor={colors.muted}
        style={ex.field}
        maxLength={2000}
        multiline
      />
      <ActionButton
        label={busy ? 'Sending…' : 'Send reply'}
        disabled={!ready || busy || !draft.trim()}
        onPress={() => void send()}
      />
    </Sheet>
  );
}

export function TabBar({ selected, onChange }: { selected: Tab; onChange: (tab: Tab) => void }) {
  const items: { tab: Tab; label: string }[] = [
    { tab: 'home', label: 'Home' },
    { tab: 'circles', label: 'Explore' },
    { tab: 'live', label: 'Live' },
    { tab: 'inbox', label: 'Inbox' },
    { tab: 'profile', label: 'You' },
  ];
  return (
    <View style={styles.tabBar}>
      {items.map((item) => (
        <Pressable
          key={item.tab}
          accessibilityRole="button"
          accessibilityLabel={`${item.label} tab`}
          accessibilityState={{ selected: selected === item.tab }}
          onPress={() => onChange(item.tab)}
          style={styles.tabItem}
        >
          <TabGlyph tab={item.tab} selected={selected === item.tab} />
          <Text style={[styles.tabLabel, selected === item.tab && styles.tabLabelActive]}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function TabGlyph({ tab, selected }: { tab: Tab; selected: boolean }) {
  const color = selected ? colors.coral : colors.muted;
  if (tab === 'live')
    return (
      <View style={[styles.navLiveIcon, selected && styles.navLiveIconSelected]}>
        <View style={styles.navLiveSignalOuter}>
          <View style={styles.navLiveSignalInner}>
            <View style={styles.navLiveSignalDot} />
          </View>
        </View>
      </View>
    );
  if (tab === 'home')
    return (
      <View
        style={styles.navGlyph}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.navHomeRoof, { borderColor: color }]} />
        <View style={[styles.navHomeBody, { borderColor: color }]}>
          <View style={[styles.navHomeDoor, { backgroundColor: color }]} />
        </View>
      </View>
    );
  if (tab === 'circles')
    return (
      <View
        style={styles.navGlyph}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.navCompass, { borderColor: color }]}>
          <View style={[styles.navCompassNeedle, { borderColor: color }]} />
        </View>
      </View>
    );
  if (tab === 'inbox')
    return (
      <View
        style={styles.navGlyph}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.navEnvelope, { borderColor: color }]}>
          <View style={[styles.navEnvelopeLeft, { backgroundColor: color }]} />
          <View style={[styles.navEnvelopeRight, { backgroundColor: color }]} />
        </View>
      </View>
    );
  return (
    <View
      style={styles.navGlyph}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.navPersonHead, { borderColor: color }]} />
      <View style={[styles.navPersonShoulders, { borderColor: color }]} />
    </View>
  );
}

export function CreatePostSheet({
  progress,
  error,
  onCancel,
  onDiscard,
  busy,
  circles,
  selectedCircleId,
  onSelectCircle,
  body,
  onBody,
  attachment,
  onPick,
  onRecordVideo,
  onClearAttachment,
  onClose,
  onSubmit,
}: {
  progress: number;
  error: string;
  onCancel: () => void;
  onDiscard: () => void;
  busy: boolean;
  circles: Circle[];
  selectedCircleId: string;
  onSelectCircle: (id: string) => void;
  body: string;
  onBody: (text: string) => void;
  attachment: Attachment | null;
  onPick: (kind: 'image' | 'gif' | 'video') => void;
  onRecordVideo: () => void;
  onClearAttachment: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Sheet onClose={onClose} title="Share a little something" eyebrow="A NOTE FOR YOUR PEOPLE">
      {circles.length ? (
        <>
          <Text style={styles.sheetLabel}>POST TO</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 13 }}
          >
            {circles.map((circle) => (
              <Pill
                key={circle.id}
                label={circle.name}
                selected={selectedCircleId === circle.id}
                onPress={busy ? undefined : () => onSelectCircle(circle.id)}
              />
            ))}
          </ScrollView>
        </>
      ) : (
        <Text style={styles.sheetCopy}>Join a circle before you share a post.</Text>
      )}
      <TextInput
        multiline
        value={body}
        onChangeText={onBody}
        editable={!busy}
        placeholder="What’s on your mind?"
        placeholderTextColor={colors.muted}
        style={styles.composerInput}
        textAlignVertical="top"
        maxLength={5000}
      />
      {attachment ? (
        <View style={styles.attachmentPreview}>
          <AttachmentPreviewMedia attachment={attachment} />
          <View style={{ flex: 1 }}>
            <Text style={styles.attachmentTitle}>
              {attachment.kind === 'video'
                ? 'Video attached'
                : attachment.kind === 'gif'
                  ? 'GIF attached'
                  : 'Photo attached'}
            </Text>
            <Text style={styles.attachmentMeta}>{attachment.fileName}</Text>
          </View>
          <Pressable
            disabled={busy}
            onPress={onClearAttachment}
            accessibilityRole="button"
            accessibilityLabel="Remove attachment"
          >
            <Text style={styles.removeAttachment}>×</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.mediaButtons}>
        <MediaButton icon="▧" label="Photo" disabled={busy} onPress={() => void onPick('image')} />
        <MediaButton icon="GIF" label="GIF" disabled={busy} onPress={() => void onPick('gif')} />
        <MediaButton
          icon="▷"
          label="Upload video"
          disabled={busy}
          onPress={() => void onPick('video')}
        />
      </View>
      <ActionButton
        variant="outline"
        label="Record video"
        disabled={busy || !circles.length}
        onPress={onRecordVideo}
      />
      <Text style={styles.sheetCopy}>
        Videos up to 2 minutes and 25 MB. Preview your recording, choose a circle you belong to,
        then share it to that circle’s timeline.
      </Text>
      <Text style={styles.sheetCopy}>
        Draft saved on this device. You can close this and come back.
      </Text>
      {busy ? (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.sheetCopy}>
            {attachment ? `Uploading · ${Math.round(progress * 100)}%` : 'Sharing your post…'}
          </Text>
          {attachment && progress < 1 ? (
            <ActionButton compact variant="outline" label="Cancel upload" onPress={onCancel} />
          ) : null}
        </>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: '#A32B22', fontSize: 15, marginVertical: 12 }}
        >
          {error}
        </Text>
      ) : null}
      {!busy ? (
        <ActionButton compact variant="outline" label="Discard draft" onPress={onDiscard} />
      ) : null}
      <ActionButton
        label={busy ? 'Sharing…' : error ? 'Retry sharing' : 'Share with your circle'}
        onPress={onSubmit}
        disabled={busy || !circles.length}
      />
    </Sheet>
  );
}

export function AttachmentPreviewMedia({ attachment }: { attachment: Attachment }) {
  return attachment.kind === 'video' ? (
    <VideoAttachmentPreview uri={attachment.uri} />
  ) : (
    <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />
  );
}

export function VideoAttachmentPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      player={player}
      style={styles.attachmentImage}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

export function CreateCircleSheet({
  busy,
  name,
  description,
  interest,
  isPrivate,
  onName,
  onDescription,
  onInterest,
  onPrivate,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  name: string;
  description: string;
  interest: string;
  isPrivate: boolean;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onInterest: (value: string) => void;
  onPrivate: (value: boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Sheet onClose={onClose} title="Make a little space." eyebrow="START A NEW CIRCLE">
      <Text style={{ fontSize: 14, color: colors.ink, alignSelf: 'stretch', marginBottom: 4 }}>
        Circle name
      </Text>
      <TextInput
        accessibilityLabel="Circle name"
        value={name}
        onChangeText={onName}
        editable={!busy}
        placeholder="Circle name"
        placeholderTextColor={colors.muted}
        style={styles.field}
        maxLength={48}
      />
      <Text style={{ fontSize: 14, color: colors.ink, alignSelf: 'stretch', marginBottom: 4 }}>
        Interest
      </Text>
      <TextInput
        accessibilityLabel="Interest"
        value={interest}
        onChangeText={onInterest}
        editable={!busy}
        placeholder="Interest, like film or gardening"
        placeholderTextColor={colors.muted}
        style={styles.field}
      />
      <Text style={{ fontSize: 14, color: colors.ink, alignSelf: 'stretch', marginBottom: 4 }}>
        Description
      </Text>
      <TextInput
        accessibilityLabel="Description"
        value={description}
        onChangeText={onDescription}
        editable={!busy}
        placeholder="What brings your people together?"
        placeholderTextColor={colors.muted}
        style={[styles.field, { minHeight: 82 }]}
        multiline
        textAlignVertical="top"
      />
      <Pressable
        disabled={busy}
        accessibilityRole="switch"
        accessibilityState={{ checked: isPrivate, disabled: busy }}
        accessibilityLabel="Private circle"
        onPress={() => onPrivate(!isPrivate)}
        style={styles.privacyRow}
      >
        <View style={[styles.toggle, isPrivate && styles.toggleOn]}>
          <View style={[styles.toggleKnob, isPrivate && styles.toggleKnobOn]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.privacyTitle}>{isPrivate ? 'Private circle' : 'Public circle'}</Text>
          <Text style={styles.privacyCopy}>
            {isPrivate
              ? 'People ask to join. You decide who gets in.'
              : 'Anyone can find and join this circle.'}
          </Text>
        </View>
        <Text style={{ fontSize: 22 }}>{isPrivate ? '🔒' : '🌱'}</Text>
      </Pressable>
      <ActionButton
        label={busy ? 'Creating…' : 'Create your circle'}
        onPress={onSubmit}
        disabled={busy}
      />
    </Sheet>
  );
}

export function StartLiveSheet({
  title,
  onTitle,
  onClose,
  onSubmit,
}: {
  title: string;
  onTitle: (text: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Sheet onClose={onClose} title="Go live, say hello." eyebrow="YOUR ROOM, YOUR PEOPLE">
      <Text style={styles.sheetCopy}>
        Set the tone for your room. You can invite up to three co-hosts once you’re live.
      </Text>
      <Text style={{ fontSize: 14, color: colors.ink, alignSelf: 'stretch', marginBottom: 4 }}>
        Room title
      </Text>
      <TextInput
        accessibilityLabel="Room title"
        value={title}
        onChangeText={onTitle}
        placeholder="What are we hanging out for?"
        placeholderTextColor={colors.muted}
        style={styles.field}
        maxLength={120}
      />
      <View style={styles.stagePreview}>
        <View style={styles.stageAvatar}>
          <Text style={{ fontSize: 27 }}>◉</Text>
        </View>
        <View>
          <Text style={styles.stageTitle}>A stage for four</Text>
          <Text style={styles.stageCopy}>You + up to three co-hosts</Text>
        </View>
      </View>
      <ActionButton label="Start livestream" onPress={onSubmit} />
    </Sheet>
  );
}

export function Sheet({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalShade}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheetPanel, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetEyebrow}>{eyebrow}</Text>
              <Text style={styles.sheetTitle}>{title}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {children}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function MediaButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Add ${label.toLowerCase()}`}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[styles.mediaButton, disabled && { opacity: 0.45 }]}
    >
      <Text style={styles.mediaIcon}>{icon}</Text>
      <Text style={styles.mediaLabel}>{label}</Text>
    </Pressable>
  );
}

export function LiveRoom({
  connectionState,
  onReconnect,
  session,
  profile,
  walletBalance,
  gifts,
  giftEvents,
  selectedGift,
  giftSending,
  liveRequestStatus,
  liveRequests,
  backendReady: configured,
  streamCredentials,
  streamError,
  remoteUids,
  micEnabled,
  cameraEnabled,
  onClose,
  onGiftSelect,
  onGiftSend,
  onBuyCoins,
  onRequestCoHost,
  onDecision,
  onReport,
  onToggleMic,
  onToggleCamera,
  onSwitchCamera,
}: {
  connectionState?: string;
  onReconnect: () => void;
  session: LiveSession;
  profile: Profile;
  walletBalance: number;
  gifts: Gift[];
  giftEvents: LiveGiftEvent[];
  selectedGift: Gift | null;
  giftSending: boolean;
  liveRequestStatus: 'none' | 'pending' | 'accepted' | 'declined';
  liveRequests: { id: UUID; requester: Profile }[];
  signedIn: boolean;
  backendReady: boolean;
  streamCredentials: { uid: number; role: string } | null;
  streamError: string;
  remoteUids: number[];
  micEnabled: boolean;
  cameraEnabled: boolean;
  onClose: () => void;
  onGiftSelect: (gift: Gift | null) => void;
  onGiftSend: (gift: Gift) => void;
  onBuyCoins: () => void;
  onRequestCoHost: () => void;
  onDecision: (id: UUID, user: Profile, accepted: boolean) => void;
  onReport: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
}) {
  const host = session.host.id === profile.id;
  const onStage =
    host || session.seats.some((seat) => seat.user.id === profile.id && seat.role === 'cohost');
  const canRequest = !onStage && liveRequestStatus === 'none' && session.seats.length < 4;
  const [giftSearch, setGiftSearch] = useState('');
  const [giftTier, setGiftTier] = useState('all');
  const [favourites, setFavourites] = useState<string[]>([]);
  const [giftError, setGiftError] = useState('');
  const [favouriteBusy, setFavouriteBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void loadGiftFavourites()
      .then((ids) => {
        if (active) setFavourites(ids);
      })
      .catch((e) => {
        if (active) setGiftError(e.message);
      });
    return () => {
      active = false;
    };
  }, [profile.id]);
  const displayGifts = gifts.filter(
    (gift) =>
      gift.name.toLowerCase().includes(giftSearch.toLowerCase()) &&
      (giftTier === 'all' ||
        (giftTier === 'favourites' && favourites.includes(gift.id)) ||
        gift.tier === giftTier),
  );
  return (
    <View style={styles.roomScreen}>
      <ImageBackground
        source={{
          uri: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=1200&h=900&fit=crop',
        }}
        style={styles.roomBackdrop}
      >
        <View style={styles.roomTint} />
        {streamCredentials && streamCredentials.role !== 'viewer' ? (
          <AgoraVideoTile uid={streamCredentials.uid} local style={StyleSheet.absoluteFill} />
        ) : null}
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.roomSafe}>
            <View style={styles.roomHeader}>
              <Pressable
                onPress={onClose}
                style={styles.roomBack}
                accessibilityRole="button"
                accessibilityLabel="Leave live room"
              >
                <Text style={styles.roomBackText}>⌄</Text>
              </Pressable>
              <View style={styles.roomHeaderCenter}>
                <View style={styles.roomLivePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.roomLiveText}>LIVE</Text>
                </View>
                <Text style={styles.roomViewerText}>
                  ◉ {formatCount(session.viewerCount)} watching
                </Text>
              </View>
              <Pressable
                onPress={onReport}
                style={styles.roomMore}
                accessibilityRole="button"
                accessibilityLabel="Report live room"
              >
                <Text style={styles.roomMoreText}>···</Text>
              </Pressable>
            </View>
            <View style={styles.roomTitleBlock}>
              <Text style={{ fontSize: 14, color: 'white', textAlign: 'center' }}>
                {host ? 'You are hosting' : onStage ? 'You are a co-host' : 'You are watching'} ·{' '}
                {streamError
                  ? 'Connection needs attention'
                  : streamCredentials
                    ? connectionState === 'reconnecting'
                      ? 'Reconnecting…'
                      : connectionState === 'disconnected'
                        ? 'Disconnected'
                        : 'Connected'
                    : configured
                      ? 'Connecting…'
                      : 'Local demo'}
              </Text>
              <Text style={styles.roomCircle}>{session.circleName ?? 'AROUND CIRCLES'}</Text>
              <Text numberOfLines={2} style={styles.roomTitle}>
                {session.title}
              </Text>
            </View>
            <View style={styles.stageArea}>
              <View style={styles.stageGlow} />
              {session.seats.slice(0, 4).map((seat, index) => {
                const localVideo =
                  seat.user.id === profile.id &&
                  streamCredentials &&
                  streamCredentials.role !== 'viewer';
                const remoteUid = agoraUidFor(seat.user.id);
                const remoteVideo = streamCredentials && remoteUids.includes(remoteUid);
                return (
                  <View
                    key={seat.user.id}
                    style={[styles.stagePerson, index > 1 && styles.stagePersonSmall]}
                  >
                    {localVideo ? (
                      <AgoraVideoTile
                        uid={streamCredentials.uid}
                        local
                        style={styles.stageAvatarImage}
                      />
                    ) : remoteVideo ? (
                      <AgoraVideoTile uid={remoteUid} style={styles.stageAvatarImage} />
                    ) : (
                      <Avatar profile={seat.user} size={index > 1 ? 58 : 78} ring />
                    )}
                    <View style={styles.speakingHalo} />
                    <Text style={styles.stagePersonName}>
                      {seat.user.id === profile.id ? 'You' : seat.user.displayName.split(' ')[0]}
                    </Text>
                    <Text style={styles.stageRole}>
                      {seat.role === 'host' ? 'HOST' : 'CO-HOST'}
                    </Text>
                  </View>
                );
              })}
              {Array.from({ length: Math.max(0, 4 - session.seats.length) })
                .slice(0, 2)
                .map((_, index) => (
                  <View
                    key={`empty-${index}`}
                    style={[styles.emptySeat, index > 0 && styles.emptySeatSmall]}
                  >
                    <Text style={styles.emptySeatIcon}>＋</Text>
                    <Text style={styles.emptySeatText}>
                      {host ? 'ROOM FOR A FRIEND' : 'OPEN SEAT'}
                    </Text>
                  </View>
                ))}
            </View>
            {liveRequests.length && host ? (
              <View style={styles.requestCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestTitle}>
                    {liveRequests.length} co-host request{liveRequests.length > 1 ? 's' : ''}
                  </Text>
                  <Text style={styles.requestCopy}>
                    {liveRequests[0].requester.displayName} would like to join
                  </Text>
                </View>
                <Pressable
                  onPress={() => onDecision(liveRequests[0].id, liveRequests[0].requester, false)}
                  style={styles.requestDecline}
                >
                  <Text style={styles.requestDeclineText}>×</Text>
                </Pressable>
                <Pressable
                  onPress={() => onDecision(liveRequests[0].id, liveRequests[0].requester, true)}
                  style={styles.requestAccept}
                >
                  <Text style={styles.requestAcceptText}>Let in</Text>
                </Pressable>
              </View>
            ) : null}
            {!host && liveRequestStatus !== 'none' ? (
              <View style={styles.requestStatus}>
                <Text style={styles.requestStatusText}>
                  {liveRequestStatus === 'pending'
                    ? 'Request sent · the host will let you know'
                    : liveRequestStatus === 'accepted'
                      ? 'You’re on stage · reconnecting as a co-host'
                      : 'The host passed this time'}
                </Text>
              </View>
            ) : null}
            <View style={styles.roomLower}>
              {giftEvents.slice(0, 2).map((event) => (
                <View key={event.id} style={styles.liveGiftEvent}>
                  <Text style={styles.liveGiftEmoji}>{event.emoji}</Text>
                  <Text style={styles.liveGiftCopy}>
                    <Text style={{ fontWeight: '900' }}>{event.sender.displayName}</Text> sent{' '}
                    {event.giftName}
                  </Text>
                  <Text style={styles.liveGiftValue}>◉ {event.coins}</Text>
                </View>
              ))}
              <View style={styles.roomControls}>
                {onStage ? (
                  <>
                    <Pressable
                      onPress={onToggleMic}
                      style={styles.roomControl}
                      accessibilityRole="button"
                      accessibilityLabel={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
                    >
                      <Text style={styles.roomControlIcon}>{micEnabled ? '🎙' : '🔇'}</Text>
                      <Text style={{ fontSize: 12, color: 'white' }}>
                        {micEnabled ? 'Mic on' : 'Muted'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={onToggleCamera}
                      style={styles.roomControl}
                      accessibilityRole="button"
                      accessibilityLabel={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                    >
                      <Text style={styles.roomControlIcon}>{cameraEnabled ? '◉' : '⊘'}</Text>
                      <Text style={{ fontSize: 12, color: 'white' }}>
                        {cameraEnabled ? 'Camera on' : 'Camera off'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={onSwitchCamera}
                      style={styles.roomControl}
                      accessibilityRole="button"
                      accessibilityLabel="Switch camera"
                    >
                      <Text style={styles.roomControlIcon}>↻</Text>
                    </Pressable>
                  </>
                ) : canRequest ? (
                  <Pressable onPress={onRequestCoHost} style={styles.requestSeat}>
                    <Text style={styles.requestSeatText}>＋ Ask to join</Text>
                  </Pressable>
                ) : null}
                <View style={styles.roomControlHint}>
                  <Text style={styles.roomControlHintText}>Appreciate the host</Text>
                </View>
                <Pressable
                  onPress={() => onGiftSelect(selectedGift ? null : (gifts[0] ?? null))}
                  style={styles.giftOpen}
                  accessibilityRole="button"
                  accessibilityLabel="Open gift catalog"
                >
                  <Text style={styles.giftOpenText}>🎁</Text>
                </Pressable>
              </View>
            </View>
            {streamError ? (
              <View style={styles.streamStatus}>
                <Text style={styles.streamStatusText}>{streamError}</Text>
                <ActionButton compact label="Reconnect" onPress={onReconnect} />
              </View>
            ) : configured && !streamCredentials ? (
              <View style={styles.streamStatus}>
                <Text style={styles.streamStatusText}>Connecting to live video…</Text>
              </View>
            ) : !configured ? (
              <View style={styles.demoStatus}>
                <Text style={styles.demoStatusText}>Circles live · demo room</Text>
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
      {selectedGift ? (
        <ScrollView
          style={styles.giftDrawer}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.giftDrawerHeader}>
            <View>
              <Text style={styles.giftDrawerEyebrow}>A LITTLE LOVE</Text>
              <Text style={styles.giftDrawerTitle}>Send a gift</Text>
            </View>
            <View style={styles.coinBalance}>
              <Text style={styles.coinBalanceText}>◉ {walletBalance.toLocaleString()}</Text>
              <Pressable
                accessibilityLabel="Open coin wallet"
                style={ex.quiet}
                onPress={onBuyCoins}
                disabled={giftSending}
              >
                <Text style={styles.addCoinText}>＋</Text>
              </Pressable>
            </View>
            <Pressable
              style={ex.quiet}
              onPress={() => onGiftSelect(null)}
              disabled={giftSending}
              accessibilityRole="button"
              accessibilityLabel="Close gift catalog"
            >
              <Text style={styles.giftClose}>×</Text>
            </Pressable>
          </View>
          <Text style={ex.label}>Find a gift</Text>
          <TextInput
            accessibilityLabel="Find a gift"
            value={giftSearch}
            onChangeText={setGiftSearch}
            placeholder="Find a gift"
            placeholderTextColor={colors.muted}
            style={styles.giftSearch}
          />
          <ScrollView
            horizontal
            style={{ flexGrow: 0, marginBottom: 12 }}
            contentContainerStyle={{ gap: 8 }}
          >
            {['all', 'favourites', 'tiny', 'small', 'medium', 'large', 'legendary'].map((tier) => (
              <Pill
                key={tier}
                label={tier === 'all' ? 'All gifts' : tier === 'favourites' ? 'Favourites' : tier}
                selected={giftTier === tier}
                onPress={() => setGiftTier(tier)}
              />
            ))}
          </ScrollView>
          {giftError ? <Text style={ex.error}>{giftError}</Text> : null}
          <View style={styles.giftGrid}>
            {!displayGifts.length ? (
              <Text style={ex.body}>No matching gifts. Try All gifts or clear the search.</Text>
            ) : null}
            {displayGifts.map((gift) => (
              <Pressable
                key={gift.id}
                disabled={giftSending}
                onPress={() => onGiftSelect(gift)}
                style={[
                  styles.giftTile,
                  selectedGift.id === gift.id && styles.giftTileSelected,
                  giftSending && { opacity: 0.55 },
                ]}
              >
                <Text style={styles.giftEmoji}>{gift.emoji}</Text>
                <Text style={styles.giftName}>{gift.name}</Text>
                <Text style={styles.giftPrice}>◉ {gift.coins.toLocaleString()}</Text>
              </Pressable>
            ))}
          </View>
          <ActionButton
            compact
            variant="outline"
            disabled={favouriteBusy}
            label={
              favourites.includes(selectedGift.id)
                ? 'Remove selected from favourites'
                : 'Favourite selected gift'
            }
            onPress={() => {
              setFavouriteBusy(true);
              const next = favourites.includes(selectedGift.id)
                ? favourites.filter((id) => id !== selectedGift.id)
                : [...favourites, selectedGift.id];
              void saveGiftFavourites(next)
                .then(() => setFavourites(next))
                .catch((e) => setGiftError(e.message))
                .finally(() => setFavouriteBusy(false));
            }}
          />
          <View style={styles.giftDrawerFooter}>
            <Text style={styles.giftSelectedText}>
              {selectedGift.emoji} {selectedGift.name} · {selectedGift.coins} coins
            </Text>
            <ActionButton
              compact
              label={giftSending ? 'Sending…' : 'Send'}
              onPress={() => onGiftSend(selectedGift)}
              disabled={giftSending || walletBalance < selectedGift.coins}
            />
          </View>
          <Pressable style={ex.quiet} onPress={() => onBuyCoins()} disabled={giftSending}>
            <Text style={styles.walletLink}>Need coins? Open wallet</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </View>
  );
}

export function ChatScreen({
  conversation,
  profile,
  hasOlder,
  onLoadOlder,
  onClose,
  onSend,
  onDelete,
  onReport,
}: {
  conversation: Conversation;
  profile: Profile;
  hasOlder: boolean;
  onLoadOlder: (before: string) => Promise<DirectMessage[]>;
  onClose: () => void;
  onSend: (body: string, replyToId?: string) => Promise<void>;
  onDelete: (message: DirectMessage) => Promise<void>;
  onReport: () => void;
}) {
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<DirectMessage[]>([]);
  const [searchMore, setSearchMore] = useState(false);
  useEffect(() => {
    if (
      replyTo &&
      !conversation.messages.some((m) => m.id === replyTo.id) &&
      !matches.some((m) => m.id === replyTo.id)
    )
      setReplyTo(null);
  }, [conversation.messages, matches, replyTo?.id]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [muted, setMuted] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  const initialUnread = useRef(conversation.unread);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const searchGeneration = useRef(0);
  useEffect(() => {
    let active = true;
    void conversationMuted(conversation.peer.id)
      .then((v) => {
        if (active) setMuted(v);
      })
      .catch((e) => {
        if (active) setSearchError(e.message);
      });
    return () => {
      active = false;
    };
  }, [conversation.peer.id]);
  useEffect(() => {
    const generation = ++searchGeneration.current;
    setSearchError('');
    if (!query.trim()) {
      setMatches([]);
      setSearchMore(false);
      setSearchBusy(false);
      return;
    }
    setSearchBusy(true);
    const timer = setTimeout(() => {
      void (
        supabase
          ? searchMessages(conversation.peer.id, query)
          : Promise.resolve(
              conversation.messages
                .filter((m) => m.body.toLowerCase().includes(query.toLowerCase()))
                .reverse(),
            )
      )
        .then((rows) => {
          if (generation !== searchGeneration.current) return;
          setMatches(rows);
          setSearchMore(rows.length === 40);
        })
        .catch((e) => {
          if (generation === searchGeneration.current) setSearchError(e.message);
        })
        .finally(() => {
          if (generation === searchGeneration.current) setSearchBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      searchGeneration.current++;
    };
  }, [query, conversation.peer.id, conversation.messages]);
  const incoming = conversation.messages
    .filter((m) => m.senderId !== profile.id)
    .slice(-initialUnread.current);
  const displayed = query.trim()
    ? matches
    : unreadOnly
      ? initialUnread.current
        ? incoming
        : []
      : [...conversation.messages].reverse();
  const reactionState = useContentReactions(
    'message',
    displayed.map((m) => m.id),
  );
  const [draft, setDraft] = useState('');
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const draftKey = `circles:message-draft:${profile.id}:${conversation.peer.id}`;
  const draftLoaded = loadedDraftKey === draftKey;
  const draftMounted = useRef(true);
  const currentDraftKey = useRef(draftKey);
  currentDraftKey.current = draftKey;
  const draftCurrent = () => draftMounted.current && currentDraftKey.current === draftKey;
  useEffect(() => {
    draftMounted.current = true;
    return () => {
      draftMounted.current = false;
    };
  }, []);
  const updateDraft = (value: string) => {
    setDraft(value);
    void contentDrafts.save(draftKey, value).catch(() => {
      if (draftCurrent()) setSearchError('Your draft could not be saved.');
    });
  };
  useEffect(() => {
    let active = true;
    void contentDrafts
      .read(draftKey)
      .then((value) => {
        if (active) {
          setDraft(value ?? '');
          setLoadedDraftKey(draftKey);
        }
      })
      .catch(() => {
        if (active) {
          setDraft('');
          setLoadedDraftKey(draftKey);
          setSearchError('Could not restore your draft.');
        }
      });
    return () => {
      active = false;
    };
  }, [draftKey]);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const sendingRef = useRef(false);
  const messagesRef = useRef<FlatList<DirectMessage>>(null);
  const send = async () => {
    const trimmed = draft.trim();
    if (!draftLoaded || !trimmed || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const version = contentDrafts.version(draftKey);
    try {
      await onSend(trimmed, replyTo?.id);
      if (contentDrafts.version(draftKey) === version) {
        if (draftCurrent()) {
          setDraft('');
          setReplyTo(null);
        }
        try {
          await contentDrafts.save(draftKey, '');
        } catch {
          if (draftCurrent())
            setSearchError('Message sent, but the saved draft could not be cleared.');
        }
      }
    } catch {
      /* The parent reports send errors; keep the draft so it can be retried. */
    } finally {
      sendingRef.current = false;
      if (draftCurrent()) setSending(false);
    }
  };
  const firstMessageTimestamp = conversation.messages.find(
    (message) => message.createdAtIso,
  )?.createdAtIso;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.chatScreen}
    >
      <View style={styles.chatHeader}>
        <Pressable
          style={ex.quiet}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close conversation"
        >
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Avatar profile={conversation.peer} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={ex.label}>{conversation.peer.displayName}</Text>
          <Text style={ex.hint}>{muted ? 'Notifications muted' : 'Following each other'}</Text>
        </View>
        <Pressable
          style={ex.quiet}
          onPress={onReport}
          accessibilityRole="button"
          accessibilityLabel="Report conversation"
        >
          <Text style={ex.label}>•••</Text>
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel="Search this conversation"
        placeholder="Search this conversation"
        value={query}
        onChangeText={setQuery}
        style={ex.field}
      />
      <View style={ex.row}>
        <Pill label="All messages" selected={!unreadOnly} onPress={() => setUnreadOnly(false)} />
        <Pill
          label={`Unread on arrival · ${initialUnread.current}`}
          selected={unreadOnly}
          onPress={() => setUnreadOnly(true)}
        />
        <ActionButton
          compact
          variant="outline"
          label={muteBusy ? 'Saving…' : muted ? 'Unmute' : 'Mute'}
          disabled={muteBusy}
          onPress={() => {
            setMuteBusy(true);
            void muteConversation(conversation.peer.id, !muted)
              .then(() => setMuted(!muted))
              .catch((e) => setSearchError(e.message))
              .finally(() => setMuteBusy(false));
          }}
        />
      </View>
      {searchBusy ? <Text style={ex.hint}>Searching…</Text> : null}
      {searchError || reactionState.error ? (
        <Text accessibilityRole="alert" style={ex.error}>
          {searchError || reactionState.error}
        </Text>
      ) : null}
      {query.trim() && searchMore ? (
        <ActionButton
          compact
          variant="outline"
          label="More search results"
          disabled={searchBusy}
          onPress={() => {
            const generation = searchGeneration.current;
            setSearchBusy(true);
            void searchMessages(conversation.peer.id, query, matches.length)
              .then((rows) => {
                if (generation === searchGeneration.current) {
                  setMatches((old) => [...old, ...rows]);
                  setSearchMore(rows.length === 40);
                }
              })
              .catch((e) => {
                if (generation === searchGeneration.current) setSearchError(e.message);
              })
              .finally(() => {
                if (generation === searchGeneration.current) setSearchBusy(false);
              });
          }}
        />
      ) : null}
      {!query && hasOlder && firstMessageTimestamp ? (
        <ActionButton
          compact
          variant="outline"
          disabled={loadingOlder}
          label={loadingOlder ? 'Loading…' : 'Load earlier messages'}
          onPress={() => {
            setLoadingOlder(true);
            void onLoadOlder(firstMessageTimestamp)
              .catch(() => {})
              .finally(() => setLoadingOlder(false));
          }}
        />
      ) : null}
      <FlatList
        ref={messagesRef}
        data={displayed}
        inverted={!query.trim() && !unreadOnly}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.chatMessages}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        ListEmptyComponent={
          <Text style={ex.body}>
            {query
              ? 'No messages match your search.'
              : unreadOnly
                ? 'No unread messages.'
                : 'Say hello to start the conversation.'}
          </Text>
        }
        renderItem={({ item: message }) => {
          const mine = message.senderId === profile.id;
          const parent = conversation.messages.find((m) => m.id === message.replyToId);
          return (
            <View style={[styles.messageBubble, mine ? styles.messageMine : styles.messageTheirs]}>
              {message.replyToId ? (
                <View style={ex.quote}>
                  <Text style={ex.hint}>
                    Replying to{' '}
                    {parent?.senderId === profile.id ? 'you' : conversation.peer.displayName}
                  </Text>
                  <Text numberOfLines={2} style={ex.body}>
                    {parent?.body ?? 'Earlier message · load history to view'}
                  </Text>
                </View>
              ) : null}
              <Text style={[ex.body, mine && { color: 'white' }]}>{message.body}</Text>
              <Text style={[ex.hint, mine && { color: 'white' }]}>{message.createdAt}</Text>
              <ReactionBar
                items={reactionState.reactions[message.id]}
                viewerId={profile.id}
                light={mine}
                onReact={(emoji, remove) => void reactionState.react(message.id, emoji, remove)}
              />
              <View style={ex.row}>
                <Pressable
                  style={ex.quiet}
                  accessibilityRole="button"
                  accessibilityLabel="Reply to message"
                  onPress={() => setReplyTo(message)}
                >
                  <Text style={[ex.label, mine && { color: 'white' }]}>Reply</Text>
                </Pressable>
                <DeleteOwnContentButton
                  ownerId={message.senderId}
                  viewerId={profile.id}
                  createdAtIso={message.createdAtIso}
                  kind="message"
                  light={mine}
                  onDelete={() => onDelete(message)}
                />
              </View>
            </View>
          );
        }}
      />
      {replyTo ? (
        <View style={ex.quote}>
          <Text style={ex.hint}>
            Replying to{' '}
            {replyTo.senderId === profile.id ? 'yourself' : conversation.peer.displayName}
          </Text>
          <Text numberOfLines={2} style={ex.body}>
            {[...conversation.messages, ...matches].find((m) => m.id === replyTo.id)?.body ??
              'Original message unavailable'}
          </Text>
          <ActionButton
            compact
            variant="outline"
            label="Cancel reply"
            onPress={() => setReplyTo(null)}
          />
        </View>
      ) : null}
      <View style={styles.messageComposer}>
        <TextInput
          value={draft}
          onChangeText={updateDraft}
          editable={!sending && draftLoaded}
          maxLength={4000}
          placeholder="Write a message…"
          placeholderTextColor={colors.muted}
          style={[styles.messageInput, { fontSize: 16 }]}
          onSubmitEditing={() => void send()}
          returnKeyType="send"
          accessibilityLabel="Message"
        />
        <ActionButton
          compact
          label={sending ? 'Sending…' : 'Send'}
          disabled={!draftLoaded || sending || !draft.trim()}
          onPress={() => void send()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

export function LoadingCards() {
  return (
    <View
      accessibilityLabel="Loading content"
      accessibilityRole="progressbar"
      style={{ padding: 20, gap: 16 }}
    >
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ height: 110, borderRadius: 18, backgroundColor: colors.line }} />
      ))}
    </View>
  );
}
