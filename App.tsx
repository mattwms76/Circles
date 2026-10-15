import { inspectPickedMedia } from './src/lib/pickedMedia';
import { Stories } from './src/components/Stories';
import { parseContentLink, type ContentLink } from './src/lib/contentLinks';
import { PostActionsProvider } from './src/components/PostActions';
import {
  defaultDiscovery,
  filterDiscovery,
  loadNotificationById,
  loadScheduledRooms,
  markActivitiesRead,
} from './src/lib/experience';
import { canDeleteOwnContent } from './src/lib/contentDeletion';
import { applyPostReaction, mergeUniquePage } from './src/lib/feedState';
import * as Notifications from 'expo-notifications';
import {
  OnboardingSheet,
  SettingsSheet,
  RecoverySheet,
  ActivitySheet,
  CircleTools,
  ModeratorSheet,
  ReportSheet,
} from './src/screens/CommunityScreens';
import {
  ActivityNotification,
  beatLiveSeat,
  releaseLiveSeat,
  searchDiscovery,
  loadNotifications,
  loadBlockedPeople,
  signOutDevice,
  uploadAvatar,
} from './src/lib/community';
import {
  readDraft,
  saveDraft,
  retainDraftMedia,
  retainPublishedMedia,
  clearDraft,
} from './src/lib/drafts';
import { clearMediaCache } from './src/lib/media';
import { AppErrorBoundary, reportDiagnostic } from './src/lib/diagnostics';
import React, { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, AppState, Alert, Linking, StatusBar, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { streamProvider } from './src/lib/streaming';
import { CoinStore } from './src/components/CoinStore';
import { colors, useThemeMode } from './src/theme';
import { styles } from './src/appStyles';
import {
  Attachment,
  Tab,
  HomeScreen,
  ExploreScreen,
  LiveScreen,
  InboxScreen,
  ProfileScreen,
  PublicProfileScreen,
  CircleDetailScreen,
  PostRepliesSheet,
  TabBar,
  CreatePostSheet,
  CreateCircleSheet,
  StartLiveSheet,
  LiveRoom,
  ChatScreen,
} from './src/screens/AppScreens';
import {
  circles as seedCircles,
  conversations as seedConversations,
  currentUser as demoUser,
  gifts as seedGifts,
  liveSessions as seedLives,
  people,
  posts as seedPosts,
} from './src/data/demo';
import { backendReady, supabase } from './src/lib/supabase';
import {
  blockUser,
  createCircle,
  createIdempotencyKey,
  createLiveSession,
  createPost,
  createPostComment,
  decideCircleJoinRequest,
  decideCoHostRequest,
  endLiveSession,
  followUser,
  heartbeatLiveSession,
  joinCircle,
  leaveCircle,
  loadCirclePosts,
  loadCircleRequests,
  loadCircles,
  loadConversationMessages,
  loadConversations,
  loadFollowers,
  loadFollowing,
  loadGiftCatalog,
  loadLiveGiftEvents,
  loadLiveSessions,
  loadMyPendingCircleIds,
  loadOwnProfile,
  loadPeopleAndFollows,
  loadPosts,
  loadPostComments,
  markConversationRead,
  reportContent,
  requestCoHost,
  sendDirectMessage,
  deleteDirectMessage,
  deletePostComment,
  sendGift,
  togglePostLike,
  unfollowUser,
  updateOwnProfile,
  loadPublicProfile,
  loadUserFollowers,
  loadUserFollowing,
  loadProfilePosts,
  loadPostById,
  loadCircleById,
} from './src/lib/repositories';
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
} from './src/types';

const CIRCLE_PAGE_SIZE = 30;
const PEOPLE_PAGE_SIZE = 20;
const FEED_PAGE_SIZE = 20;
const MESSAGE_PAGE_SIZE = 40;

export default function App() {
  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <CirclesApp />
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}

function CirclesApp() {
  const theme = useThemeMode();
  const [tab, setTab] = useState<Tab>('home');
  const [discovery, setDiscovery] = useState(defaultDiscovery);
  const [showSettings, setShowSettings] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showModerator, setShowModerator] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState<'request' | 'update' | null>(null);
  const [activity, setActivity] = useState<ActivityNotification[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    targetType: 'post' | 'profile' | 'circle' | 'message' | 'live_session';
    targetId: UUID;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(backendReady);
  const [loadError, setLoadError] = useState('');
  const [searchCircles, setSearchCircles] = useState<Circle[]>(seedCircles);
  const [searchPeople, setSearchPeople] = useState<Profile[]>(people);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchRevision, setSearchRevision] = useState(0);
  const circleSearchOffset = useRef(0);
  const peopleSearchOffset = useRef(0);
  const searchGeneration = useRef(0);
  const [publicProfilePosts, setPublicProfilePosts] = useState<CirclePost[]>([]);
  const [publicProfileHasMore, setPublicProfileHasMore] = useState(false);
  const [postRequestId, setPostRequestId] = useState<string>(createIdempotencyKey);
  const [draftReady, setDraftReady] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [postError, setPostError] = useState('');
  const uploadController = useRef<AbortController | null>(null);
  const pendingLikes = useRef(new Set<UUID>());
  const deletedMessageIds = useRef(new Set<UUID>());
  const deletedCommentIds = useRef(new Set<UUID>());
  const visibleMessages = (items: DirectMessage[]) =>
    items.filter((item) => !deletedMessageIds.current.has(item.id));
  const visibleComments = (items: PostComment[]) =>
    items.filter((item) => !deletedCommentIds.current.has(item.id));

  const [profile, setProfile] = useState<Profile>(demoUser);
  const [signedIn, setSignedIn] = useState(!backendReady);
  const [circles, setCircles] = useState<Circle[]>(seedCircles);
  const [circlesHasMore, setCirclesHasMore] = useState(false);
  const [circlesLoadingMore, setCirclesLoadingMore] = useState(false);
  const [circleRequests, setCircleRequests] = useState<CircleJoinRequest[]>([]);
  const [feed, setFeed] = useState<CirclePost[]>(seedPosts);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [lives, setLives] = useState<LiveSession[]>(seedLives);
  const [conversations, setConversations] = useState<Conversation[]>(seedConversations);
  const [peopleHasMore, setPeopleHasMore] = useState(false);
  const [peopleLoadingMore, setPeopleLoadingMore] = useState(false);
  const [followingIds, setFollowingIds] = useState<Set<UUID>>(
    new Set(seedConversations.map((conversation) => conversation.peer.id)),
  );
  const [followerProfiles, setFollowerProfiles] = useState<Profile[]>(
    people.filter((person) =>
      seedConversations.some((conversation) => conversation.peer.id === person.id),
    ),
  );
  const [followingProfiles, setFollowingProfiles] = useState<Profile[]>(
    people.filter((person) =>
      seedConversations.some((conversation) => conversation.peer.id === person.id),
    ),
  );
  const [gifts, setGifts] = useState<Gift[]>(seedGifts);
  const [walletBalance, setWalletBalance] = useState(320);
  const [requestedCircles, setRequestedCircles] = useState<Set<UUID>>(new Set());
  const [mutualIds, setMutualIds] = useState<Set<UUID>>(
    new Set(seedConversations.map((conversation) => conversation.peer.id)),
  );
  const [followerIds, setFollowerIds] = useState<Set<UUID>>(
    new Set(seedConversations.map((conversation) => conversation.peer.id)),
  );
  const [blockedIds, setBlockedIds] = useState<Set<UUID>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [interestFilter, setInterestFilter] = useState('For you');
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showCreateCircle, setShowCreateCircle] = useState(false);
  const [createCircleBusy, setCreateCircleBusy] = useState(false);
  const createCircleBusyRef = useRef(false);
  const [createPostBusy, setCreatePostBusy] = useState(false);
  const createPostBusyRef = useRef(false);
  const attachmentPicker = useRef<symbol | null>(null);
  const [joiningCircleIds, setJoiningCircleIds] = useState<Set<UUID>>(new Set());
  const [showCoinStore, setShowCoinStore] = useState(false);
  const [selectedLive, setSelectedLive] = useState<LiveSession | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [selectedPublicProfile, setSelectedPublicProfile] = useState<Profile | null>(null);
  const [publicProfileFollowers, setPublicProfileFollowers] = useState<Profile[]>([]);
  const [publicProfileFollowing, setPublicProfileFollowing] = useState<Profile[]>([]);
  const [publicProfileLoading, setPublicProfileLoading] = useState(false);
  const publicProfileRequest = useRef(0);
  const [chatHasOlder, setChatHasOlder] = useState(false);
  const [selectedCircle, setSelectedCircle] = useState<Circle | null>(null);
  const [circlePosts, setCirclePosts] = useState<CirclePost[]>([]);
  const [circlePostsLoading, setCirclePostsLoading] = useState(false);
  const [circlePostsHasMore, setCirclePostsHasMore] = useState(false);
  const [circlePostsLoadingMore, setCirclePostsLoadingMore] = useState(false);
  const activeCircleId = useRef<UUID | null>(null);
  const [pendingContentLink, setPendingContentLink] = useState<ContentLink | null>(null);
  const [selectedPost, setSelectedPost] = useState<CirclePost | null>(null);
  const [postComments, setPostComments] = useState<PostComment[]>([]);
  const [commentLimit, setCommentLimit] = useState(50);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState('');
  const [commentsRevision, setCommentsRevision] = useState(0);
  const replyViewEpoch = useRef(0),
    commentRefreshRequest = useRef(0);
  const pendingCommentSends = useRef(new Set<string>());
  const [demoComments, setDemoComments] = useState<Record<UUID, PostComment[]>>({});
  const [commentDraft, setCommentDraft] = useState('');
  const [selectedGift, setSelectedGift] = useState<Gift | null>(null);
  const [giftSending, setGiftSending] = useState(false);
  const giftSendingRef = useRef(false);
  const [liveRequestStatus, setLiveRequestStatus] = useState<
    'none' | 'pending' | 'accepted' | 'declined'
  >('none');
  const [liveRequests, setLiveRequests] = useState<{ id: UUID; requester: Profile }[]>([]);
  const [liveGiftEvents, setLiveGiftEvents] = useState<LiveGiftEvent[]>([]);
  const [streamingAdapter, setStreamingAdapter] = useState<ReturnType<
    typeof streamProvider.adapter
  > | null>(null);
  const streamAdapterRef = useRef<ReturnType<typeof streamProvider.adapter> | null>(null);
  const remoteUsersCleanup = useRef<(() => void) | null>(null);
  const streamAttempt = useRef(0);
  const [streamCredentials, setStreamCredentials] = useState<{
    sessionId: UUID;
    uid: number;
    role: string;
  } | null>(null);
  const [streamError, setStreamError] = useState('');
  const [connectionState, setConnectionState] = useState('connecting');
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [showStartLive, setShowStartLive] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createCircleName, setCreateCircleName] = useState('');
  const [createCircleDescription, setCreateCircleDescription] = useState('');
  const [createCircleInterest, setCreateCircleInterest] = useState('');
  const [createCirclePrivate, setCreateCirclePrivate] = useState(false);
  const [postBody, setPostBody] = useState('');
  const [postCircleId, setPostCircleId] = useState(
    seedCircles.find((circle) => circle.isMember)?.id ?? seedCircles[0].id,
  );
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [toast, setToast] = useState('');
  const activeUserId = useRef<UUID | null>(null);
  const accountEpoch = useRef(0);
  const captureAccount = () => {
    const epoch = accountEpoch.current;
    const owner = profile.id;
    return () =>
      epoch === accountEpoch.current && (!backendReady || activeUserId.current === owner);
  };

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const clearAccountState = () => {
      accountEpoch.current += 1;
      searchGeneration.current += 1;
      pendingLikes.current.clear();
      deletedMessageIds.current.clear();
      deletedCommentIds.current.clear();
      setSearchCircles([]);
      setSearchPeople([]);
      setSearchLoading(false);
      streamAttempt.current += 1;
      remoteUsersCleanup.current?.();
      remoteUsersCleanup.current = null;
      const previousAdapter = streamAdapterRef.current;
      streamAdapterRef.current = null;
      void previousAdapter?.leave();
      setCircles([]);
      setCircleRequests([]);
      setFeed([]);
      setLives([]);
      setConversations([]);
      setFollowingIds(new Set());
      setFollowerIds(new Set());
      setMutualIds(new Set());
      setRequestedCircles(new Set());
      setFollowerProfiles([]);
      setFollowingProfiles([]);
      setBlockedIds(new Set());
      setCirclesHasMore(false);
      setCirclesLoadingMore(false);
      setFeedHasMore(false);
      setFeedLoadingMore(false);
      setPeopleHasMore(false);
      setPeopleLoadingMore(false);
      setChatHasOlder(false);
      setJoiningCircleIds(new Set());
      setWalletBalance(0);
      setSelectedConversation(null);
      setSelectedLive(null);
      setLiveGiftEvents([]);
      setSelectedCircle(null);
      activeCircleId.current = null;
      setCirclePosts([]);
      setSelectedPost(null);
      setPostComments([]);
      setCommentDraft('');
      setSelectedGift(null);
      setLiveRequests([]);
      setLiveRequestStatus('none');
      clearMediaCache();
      uploadController.current?.abort();
      setDraftReady(null);
      setShowOnboarding(false);
      setShowSettings(false);
      setShowActivity(false);
      setShowModerator(false);
      setActivity([]);
      setActivityLoading(false);
      setActivityHasMore(false);
      setPublicProfilePosts([]);
      setReportTarget(null);
      setSelectedPublicProfile(null);
      setPublicProfileFollowers([]);
      setPublicProfileFollowing([]);
      setPublicProfileLoading(false);
      publicProfileRequest.current += 1;
      setShowCreateCircle(false);
      setShowCreatePost(false);
      setShowCoinStore(false);
      setShowStartLive(false);
      setAttachment(null);
      setPostBody('');
      setCreateTitle('');
      setCreateCircleName('');
      setCreateCircleDescription('');
      setCreateCircleInterest('');
      setCreateCirclePrivate(false);
      setStreamingAdapter(null);
      setStreamCredentials(null);
      setStreamError('');
      setRemoteUids([]);
      setToast('');
      setAuthEmail('');
      setAuthPassword('');
      setAuthError('');
      setProfileSaving(false);
      setCreateCircleBusy(false);
      setCreatePostBusy(false);
      setGiftSending(false);
      createCircleBusyRef.current = false;
      attachmentPicker.current = null;
      createPostBusyRef.current = false;
      giftSendingRef.current = false;
    };
    const applySignedInUser = (user: {
      id: UUID;
      email?: string | null;
      user_metadata?: Record<string, unknown>;
    }) => {
      if (activeUserId.current !== user.id) {
        clearAccountState();
        activeUserId.current = user.id;
        setProfile({
          id: user.id,
          handle: String(user.user_metadata?.handle ?? user.email?.split('@')[0] ?? 'member'),
          displayName: String(
            user.user_metadata?.display_name ?? user.email?.split('@')[0] ?? 'Circles member',
          ),
          avatarUrl: '',
          bio: '',
          interests: [],
        });
      }
      setSignedIn(true);
    };
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        const user = data.session?.user;
        if (user) applySignedInUser(user);
      })
      .catch((error) => {
        if (mounted)
          showMessage(error instanceof Error ? error.message : 'Could not restore your session.');
      });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (session?.user) {
        if (event === 'TOKEN_REFRESHED') return;
        applySignedInUser(session.user);
        if (event === 'PASSWORD_RECOVERY') setRecoveryMode('update');
      } else {
        activeUserId.current = null;
        setSignedIn(false);
        setProfile(demoUser);
        clearAccountState();
      }
    });
    const handledUrls = new Set<string>();
    const processAuthUrl = async (url: string) => {
      if (!mounted || handledUrls.has(url) || !url.startsWith('circles://')) return;
      handledUrls.add(url);
      try {
        const parsed = new URL(url);
        const params = new URLSearchParams(parsed.search);
        new URLSearchParams(parsed.hash.replace(/^#/, '')).forEach((value, key) => {
          if (!params.has(key)) params.set(key, value);
        });
        const code = params.get('code');
        const tokenHash = params.get('token_hash');
        const otpType = params.get('type');
        let error: Error | null = null;
        let session: any = null;
        if (code) {
          const result = await supabase!.auth.exchangeCodeForSession(code);
          error = result.error;
          session = result.data.session;
        } else if (
          tokenHash &&
          ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'].includes(
            otpType ?? '',
          )
        ) {
          const result = await supabase!.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType as
              | 'signup'
              | 'invite'
              | 'magiclink'
              | 'recovery'
              | 'email_change'
              | 'email',
          });
          error = result.error;
          session = result.data.session;
        } else {
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (accessToken && refreshToken) {
            const result = await supabase!.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            error = result.error;
            session = result.data.session;
          }
        }
        if (error) throw error;
        if (session?.user) {
          applySignedInUser(session.user);
          setAuthError('');
          if (
            otpType === 'recovery' ||
            (parsed.hostname === 'auth' && parsed.pathname === '/recovery')
          ) {
            setRecoveryMode('update');
            setTab('profile');
          } else {
            setTab('home');
            showMessage('Your email is confirmed. Welcome to Circles.');
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not confirm your email.';
        setAuthError(message);
        Alert.alert('Email confirmation failed', message);
      }
    };
    void Linking.getInitialURL()
      .then((url) => {
        if (url) void processAuthUrl(url);
      })
      .catch((error) => {
        if (mounted)
          showMessage(
            error instanceof Error ? error.message : 'Could not open the confirmation link.',
          );
      });
    const linkingListener = Linking.addEventListener('url', ({ url }) => {
      void processAuthUrl(url);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
      linkingListener.remove();
    };
  }, []);

  useEffect(() => {
    streamAdapterRef.current = streamingAdapter;
  }, [streamingAdapter]);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    const owner = profile.id;
    void readDraft(owner)
      .then((draft) => {
        if (!active) return;
        if (draft) {
          setPostBody(draft.body);
          setPostCircleId(draft.circleId);
          setAttachment(draft.media ?? null);
          setPostRequestId(draft.requestId);
        }
        setDraftReady(owner);
      })
      .catch(() => {
        if (active) setDraftReady(owner);
      });
    return () => {
      active = false;
    };
  }, [profile.id, signedIn]);
  useEffect(() => {
    if (draftReady !== profile.id || !signedIn) return;
    const timer = setTimeout(() => {
      void saveDraft(profile.id, {
        body: postBody,
        circleId: postCircleId,
        media: attachment ?? undefined,
        requestId: postRequestId,
      }).catch(() => setPostError('Your draft could not be saved on this device.'));
    }, 400);
    return () => clearTimeout(timer);
  }, [draftReady, profile.id, signedIn, postBody, postCircleId, attachment, postRequestId]);

  useEffect(() => {
    if (backendReady && !signedIn) return;
    if (!backendReady) {
      const query = searchText.trim().toLowerCase();
      const matches = circles.filter(
        (c) =>
          (['All', 'For you'].includes(interestFilter) || c.interest === interestFilter) &&
          `${c.name} ${c.description} ${c.interest}`.toLowerCase().includes(query),
      );
      if (interestFilter === 'For you')
        matches.sort(
          (a, b) =>
            Number(profile.interests.includes(b.interest)) -
            Number(profile.interests.includes(a.interest)),
        );
      setSearchCircles(filterDiscovery(matches, discovery, profile.interests));
      setSearchPeople(
        people.filter(
          (p) =>
            p.id !== profile.id &&
            !blockedIds.has(p.id) &&
            `${p.displayName} ${p.handle} ${p.interests.join(' ')}`.toLowerCase().includes(query),
        ),
      );
      setCirclesHasMore(false);
      setPeopleHasMore(false);
      setSearchLoading(false);
      setSearchError('');
      return;
    }
    let active = true;
    const generation = ++searchGeneration.current;
    setSearchLoading(true);
    setSearchError('');
    setCirclesLoadingMore(false);
    setPeopleLoadingMore(false);
    const timer = setTimeout(() => {
      void searchDiscovery(searchText, interestFilter, 0, 0, discovery)
        .then((result) => {
          if (!active || generation !== searchGeneration.current) return;
          setSearchCircles(result.circles);
          setSearchPeople(
            backendReady
              ? result.people
              : people.filter(
                  (p) =>
                    p.id !== profile.id &&
                    `${p.displayName} ${p.handle} ${p.interests.join(' ')}`
                      .toLowerCase()
                      .includes(searchText.toLowerCase()),
                ),
          );
          circleSearchOffset.current = result.circles.length;
          peopleSearchOffset.current = result.people.length;
          setCirclesHasMore(result.circles.length === CIRCLE_PAGE_SIZE);
          setPeopleHasMore(result.people.length === PEOPLE_PAGE_SIZE);
        })
        .catch(() => {
          if (active) setSearchError('Search could not connect. Try again.');
        })
        .finally(() => {
          if (active) setSearchLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    discovery,
    searchText,
    interestFilter,
    profile.id,
    signedIn,
    searchRevision,
    backendReady ? null : circles,
    backendReady ? null : blockedIds,
    backendReady ? null : profile.interests,
  ]);

  const notificationRoute = useRef(openActivityItem);
  notificationRoute.current = openActivityItem;
  const handledPush = useRef<string | null>(null);
  useEffect(() => {
    if (!supabase || !signedIn) return;
    let active = true;
    const navigate = async (id: unknown) => {
      if (typeof id !== 'string' || handledPush.current === `${profile.id}:${id}`) return;
      handledPush.current = `${profile.id}:${id}`;
      try {
        const item = await loadNotificationById(id);
        if (!active) return;
        if (item) await notificationRoute.current(item);
        else {
          setShowActivity(true);
          refresh();
        }
      } catch {
        if (active) {
          setShowActivity(true);
          refresh();
        }
      }
    };
    const refresh = () => {
      void loadNotifications()
        .then((items) => {
          if (active) {
            setActivity(items);
            setActivityHasMore(items.length === 30);
          }
        })
        .catch((error) => void reportDiagnostic(error, 'network'));
    };
    refresh();
    const channel = supabase
      .channel(`activity-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        refresh,
      )
      .subscribe();
    const listener = Notifications.addNotificationResponseReceivedListener((response) => {
      void navigate(response.notification.request.content.data?.notificationId);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (active) void navigate(response?.notification.request.content.data?.notificationId);
    });
    void loadBlockedPeople()
      .then((items) => {
        if (active) setBlockedIds(new Set(items.map((p) => p.id)));
      })
      .catch((error) => void reportDiagnostic(error, 'network'));
    return () => {
      active = false;
      void supabase?.removeChannel(channel);
      listener.remove();
    };
  }, [profile.id, signedIn]);

  useEffect(() => {
    if (!supabase || !signedIn) return;
    let active = true;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(scheduled);
      scheduled = setTimeout(() => {
        void loadLiveSessions()
          .then((items) => {
            if (active) setLives(items);
          })
          .catch((error) => void reportDiagnostic(error, 'network'));
      }, 300);
    };
    const channel = supabase
      .channel(`live-discovery-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions' }, refresh)
      .subscribe();
    const focus = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
        clearMediaCache();
      }
    });
    const timer = setInterval(refresh, 30_000);
    return () => {
      active = false;
      clearTimeout(scheduled);
      clearInterval(timer);
      void supabase?.removeChannel(channel);
      focus.remove();
    };
  }, [profile.id, signedIn]);

  useEffect(() => {
    if (
      !selectedLive ||
      !backendReady ||
      streamCredentials?.sessionId !== selectedLive.id ||
      streamCredentials.role === 'viewer'
    )
      return;
    const id = selectedLive.id;
    const beat = () =>
      void beatLiveSeat(id).catch((error) => void reportDiagnostic(error, 'stream'));
    beat();
    const timer = setInterval(beat, 20_000);
    return () => clearInterval(timer);
  }, [selectedLive?.id, streamCredentials?.role, streamCredentials?.sessionId]);

  useEffect(() => {
    if (!backendReady || !signedIn) return;
    let active = true;
    void loadOwnProfile()
      .then(async (ownProfile) => {
        const { data: auth } = await supabase!.auth.getUser();
        if (active && auth.user?.id === ownProfile.id) {
          setProfile(ownProfile);
          setShowOnboarding(!ownProfile.onboardingCompletedAt);
        }
      })
      .catch((error) => {
        if (active)
          showMessage(error instanceof Error ? error.message : 'Could not load your profile.');
      });
    void loadWallet().catch((error) => {
      if (active)
        showMessage(error instanceof Error ? error.message : 'Could not load your wallet.');
    });
    return () => {
      active = false;
    };
  }, [signedIn, profile.id]);

  useEffect(() => {
    if (!backendReady || !signedIn) {
      setInitialLoading(false);
      return;
    }
    let active = true;
    setInitialLoading(true);
    void Promise.all([
      loadCircles(0, CIRCLE_PAGE_SIZE),
      loadPosts(0, FEED_PAGE_SIZE),
      loadLiveSessions(),
      loadGiftCatalog(),
      loadCircleRequests(),
      loadMyPendingCircleIds(),
    ])
      .then(([nextCircles, nextFeed, nextLives, nextGifts, nextRequests, pendingIds]) => {
        if (!active) return;
        setInitialLoading(false);
        setLoadError('');
        setCircles(nextCircles);

        setFeed(nextFeed);
        setFeedHasMore(nextFeed.length === FEED_PAGE_SIZE);
        setLives(nextLives);
        setGifts(nextGifts.slice(0, 300));
        setCircleRequests(nextRequests);
        setRequestedCircles(new Set(pendingIds));
      })
      .catch((error) => {
        if (active) {
          setLoadError('Could not load your circles. Try again.');
          void reportDiagnostic(error, 'network');
        }
      })
      .finally(() => {
        if (active) setInitialLoading(false);
      });
    const refreshMemberships = async () => {
      try {
        const [nextCircles, nextRequests, pendingIds, nextFeed] = await Promise.all([
          loadCircles(0, CIRCLE_PAGE_SIZE),
          loadCircleRequests(),
          loadMyPendingCircleIds(),
          loadPosts(0, FEED_PAGE_SIZE),
        ]);
        if (!active) return;
        setCircles(nextCircles);

        setCircleRequests(nextRequests);
        setRequestedCircles(new Set(pendingIds));
        setFeed(nextFeed);
        setFeedHasMore(nextFeed.length === FEED_PAGE_SIZE);
      } catch (error) {
        if (active)
          showMessage(
            error instanceof Error ? error.message : 'Could not refresh circle memberships.',
          );
      }
    };
    const channel = supabase!
      .channel(`memberships-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'circle_memberships' },
        () => void refreshMemberships(),
      )
      .subscribe();
    const postsChannel = supabase!
      .channel(`posts-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, async () => {
        try {
          const nextFeed = await loadPosts(0, FEED_PAGE_SIZE);
          if (active) {
            setFeed(nextFeed);
            setFeedHasMore(nextFeed.length === FEED_PAGE_SIZE);
          }
        } catch (error) {
          if (active)
            showMessage(error instanceof Error ? error.message : 'Could not refresh posts.');
        }
      })
      .subscribe();
    return () => {
      active = false;
      void supabase?.removeChannel(channel);
      void supabase?.removeChannel(postsChannel);
    };
  }, [signedIn, profile.id]);

  useEffect(() => {
    if (!selectedCircle) return;
    if (!backendReady) {
      setCirclePosts(
        selectedCircle.isMember ? feed.filter((p) => p.circleId === selectedCircle.id) : [],
      );
      setCirclePostsLoading(false);
      setCirclePostsHasMore(false);
      return;
    }
    let active = true;
    const refreshCirclePosts = async () => {
      try {
        const nextPosts = await loadCirclePosts(selectedCircle.id, 0, FEED_PAGE_SIZE);
        if (active) {
          setCirclePosts(nextPosts);
          setCirclePostsHasMore(nextPosts.length === FEED_PAGE_SIZE);
        }
      } catch (error) {
        if (active)
          showMessage(
            error instanceof Error ? error.message : 'Could not load posts in this circle.',
          );
      } finally {
        if (active) setCirclePostsLoading(false);
      }
    };
    setCirclePosts([]);
    setCirclePostsLoading(true);
    void refreshCirclePosts();
    if (!backendReady || !signedIn || !supabase)
      return () => {
        active = false;
      };
    const channel = supabase
      .channel(`circle-posts-${selectedCircle.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'posts',
          filter: `circle_id=eq.${selectedCircle.id}`,
        },
        () => void refreshCirclePosts(),
      )
      .subscribe();
    return () => {
      active = false;
      void supabase?.removeChannel(channel);
    };
  }, [selectedCircle?.id, selectedCircle?.isMember, signedIn, backendReady ? null : feed]);

  useEffect(() => {
    if (!backendReady || !signedIn) return;
    let active = true;
    const refreshFollowState = async () => {
      const [followState, nextConversations, nextFollowers, nextFollowing] = await Promise.all([
        loadPeopleAndFollows(0, PEOPLE_PAGE_SIZE),
        loadConversations(),
        loadFollowers(),
        loadFollowing(),
      ]);
      if (!active) return;
      const following = new Set(followState.followingIds);
      const followers = new Set(followState.followerIds);
      const mutual = new Set([...following].filter((id) => followers.has(id)));

      setFollowingIds(following);
      setFollowerIds(followers);
      setFollowerProfiles(nextFollowers);
      setFollowingProfiles(nextFollowing);
      setMutualIds(mutual);
      setConversations(
        nextConversations
          .filter((conversation) => mutual.has(conversation.peer.id))
          .map((conversation) => ({
            ...conversation,
            messages: visibleMessages(conversation.messages),
          })),
      );
      setSelectedConversation((old) => (old && !mutual.has(old.peer.id) ? null : old));
    };
    const refreshFollowStateSafely = () => {
      void refreshFollowState().catch((error) => {
        if (active)
          showMessage(
            error instanceof Error ? error.message : 'Could not refresh messages and follows.',
          );
      });
    };
    refreshFollowStateSafely();
    const channel = supabase!
      .channel(`follows-${profile.id}`)
      // Postgres Changes cannot filter DELETE events, so follow deletions must be observed unfiltered.
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'follows' },
        refreshFollowStateSafely,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'follows',
          filter: `follower_id=eq.${profile.id}`,
        },
        refreshFollowStateSafely,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'follows',
          filter: `followee_id=eq.${profile.id}`,
        },
        refreshFollowStateSafely,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_id=eq.${profile.id}`,
        },
        refreshFollowStateSafely,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `sender_id=eq.${profile.id}`,
        },
        refreshFollowStateSafely,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_id=eq.${profile.id}`,
        },
        refreshFollowStateSafely,
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'direct_messages' },
        (payload) => {
          if (!active) return;
          if (payload.old.id) removeMessageLocally(payload.old.id);
          refreshFollowStateSafely();
        },
      )
      .subscribe((status) => {
        if (active && status === 'SUBSCRIBED') refreshFollowStateSafely();
      });
    const foreground = AppState.addEventListener('change', (state) => {
      if (active && state === 'active') refreshFollowStateSafely();
    });
    return () => {
      active = false;
      foreground.remove();
      void supabase?.removeChannel(channel);
    };
  }, [signedIn, profile.id]);

  useEffect(() => {
    if (!backendReady || !signedIn || !selectedConversation) return;
    let active = true;
    const refreshMessages = async () => {
      try {
        await markConversationRead(selectedConversation.peer.id);
        const messages = visibleMessages(
          await loadConversationMessages(
            selectedConversation.peer.id,
            undefined,
            MESSAGE_PAGE_SIZE,
          ),
        );
        if (!active) return;
        setChatHasOlder(messages.length === MESSAGE_PAGE_SIZE);
        setSelectedConversation((old) =>
          old?.peer.id === selectedConversation.peer.id ? { ...old, messages, unread: 0 } : old,
        );
        setConversations((old) =>
          old.map((conversation) =>
            conversation.peer.id === selectedConversation.peer.id
              ? { ...conversation, messages, unread: 0 }
              : conversation,
          ),
        );
      } catch (error) {
        if (active)
          showMessage(error instanceof Error ? error.message : 'Could not load this conversation.');
      }
    };
    void refreshMessages();
    const channel = supabase!
      .channel(`dm-${profile.id}-${selectedConversation.peer.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `sender_id=eq.${profile.id}`,
        },
        () => void refreshMessages(),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_id=eq.${profile.id}`,
        },
        () => void refreshMessages(),
      )
      .subscribe((status) => {
        if (active && status === 'SUBSCRIBED') void refreshMessages();
      });
    const foreground = AppState.addEventListener('change', (state) => {
      if (active && state === 'active') void refreshMessages();
    });
    return () => {
      active = false;
      foreground.remove();
      void supabase?.removeChannel(channel);
    };
  }, [selectedConversation?.peer.id, signedIn, profile.id]);

  useEffect(() => {
    if (!backendReady || !signedIn || !selectedPost || !supabase) return;
    let active = true;
    const accountCurrent = captureAccount(),
      view = replyViewEpoch.current;
    const refresh = async () => {
      const request = ++commentRefreshRequest.current;
      const current = () =>
        active &&
        accountCurrent() &&
        view === replyViewEpoch.current &&
        request === commentRefreshRequest.current;
      setCommentsLoading(true);
      setCommentsError('');
      try {
        const comments = await loadPostComments(selectedPost.id, commentLimit + 1);
        if (current()) {
          setCommentsHasMore(comments.length > commentLimit);
          setPostComments(visibleComments(comments.slice(-commentLimit)));
        }
      } catch (error) {
        if (current())
          setCommentsError(error instanceof Error ? error.message : 'Could not load replies.');
      } finally {
        if (current()) setCommentsLoading(false);
      }
    };
    void refresh();
    const channel = supabase
      .channel(`post-comments-${selectedPost.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'post_comments',
          filter: `post_id=eq.${selectedPost.id}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'post_comments',
          filter: `post_id=eq.${selectedPost.id}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'post_comments' },
        (payload) => {
          if (active && payload.old.id) removeCommentLocally(payload.old.id);
        },
      )
      .subscribe((status) => {
        if (active && status === 'SUBSCRIBED') void refresh();
      });
    const foreground = AppState.addEventListener('change', (state) => {
      if (active && state === 'active') void refresh();
    });
    return () => {
      active = false;
      foreground.remove();
      void supabase?.removeChannel(channel);
    };
  }, [selectedPost?.id, signedIn, profile.id, commentLimit, commentsRevision]);

  useEffect(() => {
    if (!backendReady || !signedIn || !selectedLive) return;
    let active = true;
    const refresh = async () => {
      try {
        const [sessions, giftsInRoom] = await Promise.all([
          loadLiveSessions(),
          loadLiveGiftEvents(selectedLive.id),
        ]);
        if (!active) return;
        setLives((old) =>
          sessions.map((session) => {
            const current = old.find((item) => item.id === session.id);
            return current ? { ...session, viewerCount: current.viewerCount } : session;
          }),
        );
        setLiveGiftEvents(giftsInRoom);
        const latest = sessions.find((item) => item.id === selectedLive.id);
        if (latest)
          setSelectedLive((old) =>
            old?.id === latest.id ? { ...latest, viewerCount: old.viewerCount } : latest,
          );
        else {
          streamAttempt.current += 1;
          remoteUsersCleanup.current?.();
          remoteUsersCleanup.current = null;
          void streamingAdapter?.leave();
          setStreamingAdapter(null);
          setStreamCredentials(null);
          setSelectedLive(null);
          showMessage('This live room has ended.');
        }
      } catch (error) {
        if (active)
          showMessage(error instanceof Error ? error.message : 'Could not refresh the live room.');
      }
    };
    void refresh();
    const channel = supabase!
      .channel(`room-${selectedLive.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_sessions',
          filter: `id=eq.${selectedLive.id}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_seats',
          filter: `session_id=eq.${selectedLive.id}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'live_gifts',
          filter: `session_id=eq.${selectedLive.id}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      active = false;
      void supabase?.removeChannel(channel);
    };
  }, [selectedLive?.id, signedIn, profile.id, streamingAdapter]);

  useEffect(() => {
    if (
      !backendReady ||
      !signedIn ||
      !selectedLive ||
      !streamCredentials ||
      streamCredentials.sessionId !== selectedLive.id
    )
      return;
    const role =
      selectedLive.host.id === profile.id
        ? 'host'
        : selectedLive.seats.some((seat) => seat.user.id === profile.id && seat.role === 'cohost')
          ? 'cohost'
          : 'viewer';
    if (streamCredentials.role === role) return;
    if (role === 'cohost') setLiveRequestStatus('accepted');
    void joinStream(selectedLive, role);
  }, [selectedLive, signedIn, profile.id, streamCredentials]);

  useEffect(() => {
    if (
      !backendReady ||
      !signedIn ||
      !selectedLive ||
      selectedLive.host.id !== profile.id ||
      streamCredentials?.sessionId !== selectedLive.id ||
      streamCredentials.role !== 'host'
    )
      return;
    let active = true;
    const beat = () => {
      void heartbeatLiveSession(selectedLive.id).catch((error) => {
        if (active)
          showMessage(error instanceof Error ? error.message : 'Live connection heartbeat failed.');
      });
    };
    beat();
    const timer = setInterval(beat, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    selectedLive?.id,
    selectedLive?.host.id,
    profile.id,
    signedIn,
    streamCredentials?.sessionId,
    streamCredentials?.role,
  ]);

  useEffect(() => {
    const client = supabase;
    if (!client || !signedIn || lives.length === 0) return;
    const liveIds = [...new Set(lives.map((live) => live.id))];
    const channels = liveIds.map((liveId) => {
      const presence = client.channel(`live-presence-${liveId}`, {
        config: { presence: { key: profile.id } },
      });
      const updateViewerCount = () => {
        const users = new Map<string, string>();
        for (const records of Object.values(presence.presenceState())) {
          for (const record of records as { userId?: string; role?: string }[]) {
            if (record.userId) users.set(record.userId, record.role ?? 'viewer');
          }
        }
        const viewerCount = [...users.values()].filter((role) => role === 'viewer').length;
        setSelectedLive((old) => (old?.id === liveId ? { ...old, viewerCount } : old));
        setLives((old) =>
          old.map((live) => (live.id === liveId ? { ...live, viewerCount } : live)),
        );
      };
      presence.on('presence', { event: 'sync' }, updateViewerCount).subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (selectedLive?.id === liveId && streamCredentials?.sessionId === liveId) {
          void presence
            .track({ userId: profile.id, role: streamCredentials.role })
            .catch((error) =>
              showMessage(
                error instanceof Error ? error.message : 'Could not update the live viewer count.',
              ),
            );
        }
        updateViewerCount();
      });
      return presence;
    });
    return () => {
      for (const channel of channels) void client.removeChannel(channel);
    };
  }, [
    lives.map((live) => live.id).join(','),
    signedIn,
    profile.id,
    selectedLive?.id,
    streamCredentials?.sessionId,
    streamCredentials?.role,
  ]);

  useEffect(() => {
    if (signedIn) return;
    streamAttempt.current += 1;
    remoteUsersCleanup.current?.();
    remoteUsersCleanup.current = null;
    const adapter = streamAdapterRef.current;
    streamAdapterRef.current = null;
    void adapter?.leave();
    setStreamingAdapter(null);
  }, [signedIn]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selectedLive || !supabase || !signedIn || selectedLive.host.id !== profile.id) return;
    const fetchRequests = async () => {
      const { data } = await supabase!
        .from('live_seat_requests')
        .select(
          'id,requester:profiles!live_seat_requests_requester_id_fkey(id,handle,display_name,avatar_url)',
        )
        .eq('session_id', selectedLive.id)
        .eq('status', 'pending')
        .order('created_at');
      if (data)
        setLiveRequests(
          data.map((row: any) => ({
            id: row.id,
            requester: {
              id: row.requester.id,
              handle: row.requester.handle,
              displayName: row.requester.display_name,
              avatarUrl: row.requester.avatar_url ?? '',
              interests: [],
            },
          })),
        );
    };
    void fetchRequests();
    const channel = supabase
      .channel(`seat-requests-${selectedLive.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_seat_requests',
          filter: `session_id=eq.${selectedLive.id}`,
        },
        () => void fetchRequests(),
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [selectedLive?.id, profile.id, signedIn]);

  useEffect(() => {
    if (!selectedLive || !supabase || !signedIn || selectedLive.host.id === profile.id) return;
    const channel = supabase
      .channel(`my-seat-${selectedLive.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'live_seat_requests',
          filter: `session_id=eq.${selectedLive.id}`,
        },
        (payload) => {
          const request = payload.new as { requester_id: string; status: string };
          if (request.requester_id !== profile.id) return;
          if (request.status === 'accepted') {
            setLiveRequestStatus('accepted');
            setSelectedLive((old) =>
              old && !old.seats.some((seat) => seat.user.id === profile.id)
                ? { ...old, seats: [...old.seats, { user: profile, role: 'cohost' }] }
                : old,
            );
          } else if (request.status === 'declined') setLiveRequestStatus('declined');
        },
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [selectedLive?.id, profile.id, signedIn]);

  async function loadMoreCircles() {
    if (searchLoading || circlesLoadingMore || !circlesHasMore) return;
    const generation = searchGeneration.current;
    setCirclesLoadingMore(true);
    try {
      const page = await searchDiscovery(
        searchText,
        interestFilter,
        circleSearchOffset.current,
        0,
        discovery,
      );
      if (generation !== searchGeneration.current) return;
      circleSearchOffset.current += page.circles.length;
      setSearchCircles((old) => mergeUniquePage(old, page.circles));
      setCirclesHasMore(page.circles.length === CIRCLE_PAGE_SIZE);
    } catch {
      if (generation === searchGeneration.current)
        setSearchError('Could not load more circles. Try again.');
    } finally {
      if (generation === searchGeneration.current) setCirclesLoadingMore(false);
    }
  }
  async function loadMorePeople() {
    if (searchLoading || peopleLoadingMore || !peopleHasMore) return;
    const generation = searchGeneration.current;
    setPeopleLoadingMore(true);
    try {
      const page = await searchDiscovery(
        searchText,
        interestFilter,
        0,
        peopleSearchOffset.current,
        discovery,
      );
      if (generation !== searchGeneration.current) return;
      peopleSearchOffset.current += page.people.length;
      setSearchPeople((old) => mergeUniquePage(old, page.people));
      setPeopleHasMore(page.people.length === PEOPLE_PAGE_SIZE);
    } catch {
      if (generation === searchGeneration.current)
        setSearchError('Could not load more people. Try again.');
    } finally {
      if (generation === searchGeneration.current) setPeopleLoadingMore(false);
    }
  }
  async function refreshAll() {
    if (!backendReady || !signedIn) {
      setRefreshing(false);
      return;
    }
    const current = captureAccount();
    setRefreshing(true);
    setLoadError('');
    clearMediaCache();
    try {
      const [nextCircles, nextPosts, nextLives, nextRequests, pending] = await Promise.all([
        loadCircles(),
        loadPosts(),
        loadLiveSessions(),
        loadCircleRequests(),
        loadMyPendingCircleIds(),
      ]);
      if (!current()) return;
      setCircles(nextCircles);
      setFeed(nextPosts);
      setLives(nextLives);
      setCircleRequests(nextRequests);
      setRequestedCircles(new Set(pending));
      setFeedHasMore(nextPosts.length === FEED_PAGE_SIZE);
      setSearchRevision((v) => v + 1);
    } catch (error) {
      if (current()) {
        setLoadError('Could not refresh. Check your connection and try again.');
        void reportDiagnostic(error, 'network');
      }
    } finally {
      if (current()) {
        setRefreshing(false);
        setInitialLoading(false);
      }
    }
  }
  async function refreshActivity(more = false) {
    if (activityLoading) return;
    const current = captureAccount();
    setActivityLoading(true);
    try {
      const items = await loadNotifications(more ? activity.length : 0);
      if (!current()) return;
      setActivity((old) => (more ? mergeUniquePage(old, items) : items));
      setActivityHasMore(items.length === 30);
    } catch {
      if (current()) showMessage('Could not load activity. Pull to refresh and try again.');
    } finally {
      if (current()) setActivityLoading(false);
    }
  }
  async function openActivityItem(item: ActivityNotification, groupIds?: string[]) {
    const current = captureAccount();
    try {
      if (item.kind === 'messages') {
        const person = await loadPublicProfile(item.target_id);
        if (!current()) return;
        if (!person) throw new Error('This conversation is no longer available.');
        openProfileConversation(person);
      } else if (item.kind === 'replies') {
        const post = await loadPostById(item.target_id);
        if (!current()) return;
        if (!post) throw new Error('This post is no longer available.');
        await openPostReplies(post);
      } else if (item.kind === 'live') {
        const sessions = await loadLiveSessions();
        if (!current()) return;
        const session = sessions.find((l) => l.id === item.target_id);
        if (session) await openLive(session);
        else {
          const scheduled = (await loadScheduledRooms()).find((r) => r.id === item.target_id);
          if (!current()) return;
          if (!scheduled) throw new Error('This room is no longer available.');
          if (scheduled.live_session_id) {
            const live = sessions.find((l) => l.id === scheduled.live_session_id);
            if (live) await openLive(live);
            else throw new Error('This live room has ended.');
          } else {
            setTab('live');
            closeCircle();
            closePublicProfile();
            showMessage(`${scheduled.title} · ${new Date(scheduled.starts_at).toLocaleString()}`);
          }
        }
      } else if (item.circle_id) {
        const circle = await loadCircleById(item.circle_id);
        if (!current()) return;
        if (!circle) throw new Error('This circle is no longer available.');
        openCircle(circle);
      }
      if (!current()) return;
      const ids = groupIds ?? [item.id];
      await markActivitiesRead(ids);
      if (!current()) return;
      setActivity((old) =>
        old.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      setShowActivity(false);
    } catch (error) {
      if (!current()) return;
      showMessage(error instanceof Error ? error.message : 'This activity is no longer available.');
    }
  }
  async function loadMoreProfilePosts() {
    if (!selectedPublicProfile || publicProfileLoading || !publicProfileHasMore) return;
    const id = selectedPublicProfile.id;
    const request = publicProfileRequest.current;
    setPublicProfileLoading(true);
    try {
      const page = await loadProfilePosts(id, publicProfilePosts.length, FEED_PAGE_SIZE);
      if (request !== publicProfileRequest.current) return;
      setPublicProfilePosts((old) => mergeUniquePage(old, page));
      setPublicProfileHasMore(page.length === FEED_PAGE_SIZE);
    } catch {
      showMessage('Could not load more posts. Try again.');
    } finally {
      if (request === publicProfileRequest.current) setPublicProfileLoading(false);
    }
  }

  async function loadMorePosts() {
    if (feedLoadingMore || !feedHasMore) return;
    const current = captureAccount();
    setFeedLoadingMore(true);
    try {
      const page = await loadPosts(feed.length, FEED_PAGE_SIZE);
      if (!current()) return;
      setFeed((old) => mergeUniquePage(old, page));
      setFeedHasMore(page.length === FEED_PAGE_SIZE);
    } catch (error) {
      if (current())
        showMessage(error instanceof Error ? error.message : 'Could not load more posts.');
    } finally {
      if (current()) setFeedLoadingMore(false);
    }
  }

  function openCircle(circle: Circle) {
    activeCircleId.current = circle.id;
    setSelectedCircle(circle);
  }

  function closeCircle() {
    activeCircleId.current = null;
    setSelectedCircle(null);
    setCirclePosts([]);
    setCirclePostsHasMore(false);
  }

  async function loadMoreCirclePosts() {
    if (!selectedCircle || circlePostsLoadingMore || !circlePostsHasMore) return;
    const circleId = selectedCircle.id;
    setCirclePostsLoadingMore(true);
    try {
      const next = await loadCirclePosts(circleId, circlePosts.length, FEED_PAGE_SIZE);
      if (activeCircleId.current !== circleId) return;
      setCirclePosts((old) => mergeUniquePage(old, next));
      setCirclePostsHasMore(next.length === FEED_PAGE_SIZE);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not load more circle posts.');
    } finally {
      setCirclePostsLoadingMore(false);
    }
  }

  async function loadWallet() {
    if (!supabase) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { data, error } = await supabase
      .from('coin_wallets')
      .select('balance')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (error) throw error;
    const { data: currentAuth } = await supabase.auth.getUser();
    if (data && currentAuth.user?.id === userData.user.id) setWalletBalance(Number(data.balance));
  }

  function applyOwnProfile(updated: Profile) {
    const person = (value: Profile) => (value.id === updated.id ? updated : value);
    const post = (value: CirclePost) => ({ ...value, author: person(value.author) });
    const live = (value: LiveSession) => ({
      ...value,
      host: person(value.host),
      seats: value.seats.map((seat) => ({ ...seat, user: person(seat.user) })),
    });
    setProfile(updated);
    setFeed((items) => items.map(post));
    setCirclePosts((items) => items.map(post));
    setPublicProfilePosts((items) => items.map(post));
    setSelectedPost((value) => (value ? post(value) : null));
    setPostComments((items) => items.map((value) => ({ ...value, author: person(value.author) })));
    setDemoComments((groups) =>
      Object.fromEntries(
        Object.entries(groups).map(([id, items]) => [
          id,
          items.map((value) => ({ ...value, author: person(value.author) })),
        ]),
      ),
    );
    setLives((items) => items.map(live));
    setSelectedLive((value) => (value ? live(value) : null));
    setLiveGiftEvents((items) =>
      items.map((value) => ({ ...value, sender: person(value.sender) })),
    );
    setSelectedPublicProfile((value) => (value ? person(value) : null));
  }

  async function saveProfile(
    input: Pick<Profile, 'displayName' | 'bio' | 'interests'>,
    photo?: Pick<Attachment, 'uri' | 'mimeType'>,
  ) {
    if (!ensureSignedIn('edit your profile') || profileSaving) return;
    const current = captureAccount();
    setProfileSaving(true);
    try {
      const avatarUrl = photo
        ? backendReady
          ? await uploadAvatar(photo.uri, photo.mimeType, profile.id)
          : photo.uri
        : undefined;
      if (!current()) return;
      const changes = { ...input, ...(avatarUrl !== undefined ? { avatarUrl } : {}) };
      const updated = backendReady
        ? await updateOwnProfile(changes, profile.id)
        : { ...profile, ...changes };
      if (!current()) return;
      applyOwnProfile(updated);
      showMessage('Profile saved.');
    } catch (error) {
      if (!current()) return;
      showMessage(error instanceof Error ? error.message : 'Could not save your profile.');
      throw error;
    } finally {
      if (current()) setProfileSaving(false);
    }
  }

  function showMessage(message: string) {
    setToast(message);
    AccessibilityInfo.announceForAccessibility(message);
  }
  function ensureSignedIn(action: string) {
    if (!backendReady || signedIn) return true;
    Alert.alert('Sign in to continue', `Create an account or sign in to ${action}.`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open profile', onPress: () => setTab('profile') },
    ]);
    return false;
  }

  async function handleAuth(kind: 'signIn' | 'signUp') {
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      const result =
        kind === 'signUp'
          ? await supabase.auth.signUp({
              email: authEmail.trim(),
              password: authPassword,
              options: {
                data: { display_name: authEmail.split('@')[0] },
                emailRedirectTo: 'circles://auth/callback',
              },
            })
          : await supabase.auth.signInWithPassword({
              email: authEmail.trim(),
              password: authPassword,
            });
      if (result.error) {
        setAuthError(result.error.message);
        return;
      }
      if (kind === 'signUp' && !result.data.session)
        setAuthError('Check your email to confirm your new account.');
      else {
        setSignedIn(true);
        setAuthEmail('');
        setAuthPassword('');
        setToast(kind === 'signUp' ? 'Welcome to Circles.' : 'You’re signed in.');
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Could not connect to Circles. Try again.',
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleJoin(circle: Circle) {
    if (!ensureSignedIn('join circles')) return;
    if (joiningCircleIds.has(circle.id)) return;
    const current = captureAccount();
    setJoiningCircleIds((old) => new Set(old).add(circle.id));
    try {
      const result = await joinCircle(circle);
      if (!current()) return;
      setSearchRevision((v) => v + 1);
      if (result === 'pending') {
        setRequestedCircles((old) => new Set(old).add(circle.id));
        showMessage('Your request is with the circle host.');
      } else {
        setCircles((old) =>
          old.map((item) =>
            item.id === circle.id
              ? {
                  ...item,
                  isMember: true,
                  members: item.members + (!backendReady && !item.isMember ? 1 : 0),
                }
              : item,
          ),
        );
        setSelectedCircle((old) =>
          old?.id === circle.id
            ? {
                ...old,
                isMember: true,
                members: old.members + (!backendReady && !old.isMember ? 1 : 0),
              }
            : old,
        );
        if (backendReady) {
          void Promise.all([loadCircles(0, CIRCLE_PAGE_SIZE), loadPosts(0, FEED_PAGE_SIZE)])
            .then(([nextCircles, nextFeed]) => {
              if (!current()) return;
              setCircles(nextCircles);

              setFeed(nextFeed);
              setFeedHasMore(nextFeed.length === FEED_PAGE_SIZE);
              const refreshed = nextCircles.find((item) => item.id === circle.id);
              if (refreshed) setSelectedCircle((old) => (old?.id === circle.id ? refreshed : old));
            })
            .catch((error) =>
              showMessage(
                error instanceof Error
                  ? error.message
                  : 'You joined, but the circle could not refresh yet.',
              ),
            );
        }
        showMessage(`You joined ${circle.name}.`);
      }
    } catch (error) {
      if (!current()) return;
      showMessage(error instanceof Error ? error.message : 'Could not join this circle.');
    } finally {
      if (current())
        setJoiningCircleIds((old) => {
          const next = new Set(old);
          next.delete(circle.id);
          return next;
        });
    }
  }

  async function handleLeave(circle: Circle) {
    if (!ensureSignedIn('leave circles')) return;
    if (circle.isOwner) {
      showMessage('Circle owners cannot leave until ownership is transferred.');
      return;
    }
    const current = captureAccount();
    const wasPending = requestedCircles.has(circle.id);
    try {
      const result = await leaveCircle(circle.id, wasPending);
      if (!current()) return;
      clearMediaCache();
      setPublicProfilePosts((old) => old.filter((p) => p.circleId !== circle.id));
      setSearchRevision((v) => v + 1);
      setCircles((old) =>
        old.map((item) =>
          item.id === circle.id
            ? {
                ...item,
                isMember: false,
                isOwner: false,
                members:
                  result === 'left' && !backendReady ? Math.max(0, item.members - 1) : item.members,
              }
            : item,
        ),
      );
      setSelectedCircle((old) =>
        old?.id === circle.id
          ? {
              ...old,
              isMember: false,
              isOwner: false,
              members:
                result === 'left' && !backendReady ? Math.max(0, old.members - 1) : old.members,
            }
          : old,
      );
      setRequestedCircles((old) => {
        const next = new Set(old);
        next.delete(circle.id);
        return next;
      });
      setFeed((old) =>
        result === 'left' ? old.filter((post) => post.circleId !== circle.id) : old,
      );
      if (postCircleId === circle.id)
        setPostCircleId(
          circles.find((item) => item.id !== circle.id && item.isMember)?.id ??
            circles[0]?.id ??
            '',
        );
      showMessage(
        result === 'request_cancelled'
          ? `Request to join ${circle.name} cancelled.`
          : result === 'not_member'
            ? `You are not a member of ${circle.name}.`
            : `You left ${circle.name}.`,
      );
      if (backendReady) {
        void Promise.all([
          loadCircles(0, CIRCLE_PAGE_SIZE),
          loadPosts(0, FEED_PAGE_SIZE),
          loadMyPendingCircleIds(),
        ])
          .then(([nextCircles, nextPosts, pendingIds]) => {
            if (!current()) return;
            setCircles(nextCircles);

            setFeed(nextPosts);
            setFeedHasMore(nextPosts.length === FEED_PAGE_SIZE);
            setRequestedCircles(new Set(pendingIds));
            const refreshed = nextCircles.find((item) => item.id === circle.id);
            if (refreshed) setSelectedCircle((old) => (old?.id === circle.id ? refreshed : old));
            if (postCircleId === circle.id)
              setPostCircleId(nextCircles.find((item) => item.isMember)?.id ?? '');
          })
          .catch((error) =>
            showMessage(
              error instanceof Error
                ? error.message
                : 'Your circle change was saved, but the screen could not refresh.',
            ),
          );
      }
    } catch (error) {
      if (!current()) return;
      showMessage(error instanceof Error ? error.message : 'Could not leave this circle.');
    }
  }

  async function handleCreateCircle() {
    if (!ensureSignedIn('create a circle')) return;
    if (createCircleBusyRef.current) return;
    const current = captureAccount();
    if (createCircleName.trim().length < 2 || !createCircleInterest.trim()) {
      showMessage('Add a name and an interest to continue.');
      return;
    }
    const input = {
      name: createCircleName.trim(),
      description: createCircleDescription.trim(),
      interest: createCircleInterest.trim(),
      isPrivate: createCirclePrivate,
    };
    createCircleBusyRef.current = true;
    setCreateCircleBusy(true);
    try {
      const newCircle: Circle = backendReady
        ? await createCircle(input)
        : {
            id: `circle-${Date.now()}`,
            ...input,
            members: 1,
            isMember: true,
            isOwner: true,
            color: colors.lilac,
            imageUrl:
              'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=720&h=520&fit=crop',
          };
      if (!current()) return;
      setCircles((old) => [newCircle, ...old]);
      setSearchRevision((v) => v + 1);
      setShowCreateCircle(false);
      setCreateCircleName('');
      setCreateCircleDescription('');
      setCreateCircleInterest('');
      setCreateCirclePrivate(false);
      showMessage('Your circle is ready.');
    } catch (error) {
      if (!current()) return;
      showMessage(error instanceof Error ? error.message : 'Could not create your circle.');
    } finally {
      if (current()) {
        createCircleBusyRef.current = false;
        setCreateCircleBusy(false);
      }
    }
  }

  async function pickAttachment(
    kind: 'image' | 'gif' | 'video',
    source: 'library' | 'camera' = 'library',
  ) {
    if (attachmentPicker.current || createPostBusyRef.current) return;
    const picker = Symbol();
    attachmentPicker.current = picker;
    const accountCurrent = captureAccount();
    const current = () => accountCurrent() && attachmentPicker.current === picker;
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!current()) return;
        if (!permission.granted) {
          Alert.alert(
            'Camera access needed',
            'Allow camera access in your device settings to record a video. You can still upload a video from your library.',
          );
          return;
        }
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ['videos'],
              allowsEditing: false,
              videoMaxDuration: 120,
              videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: kind === 'video' ? ['videos'] : ['images'],
              quality: kind === 'image' ? 0.8 : 1,
              allowsEditing: false,
            });
      if (!current()) return;
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const { mimeType } = await inspectPickedMedia(asset, kind, 120);
      if (!current()) return;
      if (kind === 'gif' && mimeType !== 'image/gif') {
        Alert.alert('Choose a GIF', 'Please select an animated GIF file.');
        return;
      }
      const media: Attachment = {
        uri: asset.uri,
        mimeType,
        fileName:
          asset.fileName ??
          `${Date.now()}.${kind === 'video' ? 'mp4' : kind === 'gif' ? 'gif' : 'jpg'}`,
        kind: kind === 'video' ? 'video' : mimeType === 'image/gif' ? 'gif' : kind,
      };
      const retained = await retainDraftMedia(profile.id, media);
      if (!current()) return;
      setAttachment(retained);
      setPostRequestId(createIdempotencyKey());
    } catch (error) {
      if (!current()) return;
      showMessage(
        error instanceof Error
          ? error.message
          : source === 'camera'
            ? 'Could not record video. Check camera and microphone permissions in device settings.'
            : 'Could not open your media library.',
      );
    } finally {
      if (attachmentPicker.current === picker) attachmentPicker.current = null;
    }
  }

  async function handleCreatePost() {
    if (!ensureSignedIn('share a post')) return;
    if (createPostBusyRef.current || attachmentPicker.current) return;
    const current = captureAccount();
    if (!circles.some((circle) => circle.id === postCircleId && circle.isMember)) {
      showMessage('Join a circle before sharing a post.');
      return;
    }
    if (!postBody.trim() && !attachment) {
      showMessage('Write a note or add a photo or video first.');
      return;
    }
    createPostBusyRef.current = true;
    setCreatePostBusy(true);
    setPostError('');
    setUploadProgress(0);
    uploadController.current = new AbortController();
    try {
      if (backendReady) {
        await createPost(
          {
            circleId: postCircleId,
            body: postBody,
            media: attachment ?? undefined,
            requestId: postRequestId,
          },
          { onProgress: setUploadProgress, signal: uploadController.current.signal },
        );
        if (!current()) return;
        void refreshAll();
      } else {
        const circle = circles.find((item) => item.id === postCircleId) ?? circles[0];
        const publishedMedia = attachment
          ? await retainPublishedMedia(profile.id, attachment)
          : null;
        const local: CirclePost = {
          id: `post-${Date.now()}`,
          circleId: circle.id,
          circleName: circle.name,
          author: profile,
          body: postBody.trim(),
          media: attachment
            ? { id: `media-${Date.now()}`, kind: attachment.kind, url: publishedMedia!.uri }
            : undefined,
          likes: 0,
          createdAt: 'now',
          liked: false,
        };
        setFeed((old) => [local, ...old]);
      }
      await clearDraft(profile.id);
      if (!current()) return;
      setPostRequestId(createIdempotencyKey());
      setShowCreatePost(false);
      setPostBody('');
      setAttachment(null);
      setTab('home');
      showMessage('Shared with your circle.');
    } catch (error) {
      if (!current()) return;
      setPostError(
        error instanceof Error ? error.message : 'Could not create this post. Your draft is saved.',
      );
      void reportDiagnostic(error, 'upload');
    } finally {
      if (current()) {
        createPostBusyRef.current = false;
        setCreatePostBusy(false);
      }
    }
  }

  async function handleStartLive() {
    if (!ensureSignedIn('go live')) return;
    const title = createTitle.trim() || 'A little live moment';
    try {
      let session: LiveSession;
      if (backendReady) session = await createLiveSession(title);
      else
        session = {
          id: `live-${Date.now()}`,
          host: profile,
          title,
          viewerCount: 1,
          status: 'live',
          startedAt: new Date().toISOString(),
          seats: [{ user: profile, role: 'host' }],
        };
      setLives((old) => [session, ...old]);
      setCreateTitle('');
      setSelectedLive(session);
      setTab('live');
      const connected = await joinStream(session, 'host');
      if (!connected && backendReady) {
        try {
          await endLiveSession(session.id);
        } catch (error) {
          showMessage(
            error instanceof Error
              ? `Streaming failed and the live room could not be ended: ${error.message}`
              : 'Streaming failed and the live room could not be ended.',
          );
        }
        setLives((old) => old.filter((live) => live.id !== session.id));
        setSelectedLive((old) => (old?.id === session.id ? null : old));
      }
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not start your live room.');
    }
  }

  async function joinStream(
    session: LiveSession,
    role: 'host' | 'cohost' | 'viewer',
  ): Promise<boolean> {
    if (!backendReady) {
      setStreamCredentials(null);
      return true;
    }
    if (!ensureSignedIn('join a livestream')) return false;
    const attempt = ++streamAttempt.current;
    remoteUsersCleanup.current?.();
    remoteUsersCleanup.current = null;
    setStreamingAdapter(null);
    setStreamCredentials(null);
    setRemoteUids([]);
    setStreamError('');
    let joiningAdapter: ReturnType<typeof streamProvider.adapter> | null = null;
    try {
      const previous = streamAdapterRef.current;
      streamAdapterRef.current = null;
      await previous?.leave();
      if (attempt !== streamAttempt.current) return false;
      const credentials = await streamProvider.issueCredentials(session.id, role);
      if (attempt !== streamAttempt.current) return false;
      const adapter = streamProvider.adapter(
        (error) => {
          if (attempt === streamAttempt.current) {
            setStreamError(error.message);
            void reportDiagnostic(error, 'stream');
          }
        },
        (state) => {
          if (attempt === streamAttempt.current) {
            setConnectionState(state);
            if (state === 'connected') setStreamError('');
          }
        },
      );
      joiningAdapter = adapter;
      await adapter.join({
        sessionId: session.id,
        role,
        token: credentials.token,
        channel: credentials.channel,
        uid: credentials.uid,
      });
      if (attempt !== streamAttempt.current) {
        await adapter.leave();
        return false;
      }
      if (role !== 'viewer')
        await Promise.all([
          adapter.setMicrophoneEnabled(micEnabled),
          adapter.setCameraEnabled(cameraEnabled),
        ]);
      if (attempt !== streamAttempt.current) {
        await adapter.leave();
        return false;
      }
      remoteUsersCleanup.current = adapter.onRemoteUsersChanged?.(setRemoteUids) ?? null;
      streamAdapterRef.current = adapter;
      joiningAdapter = null;
      setStreamingAdapter(adapter);
      setStreamCredentials({ sessionId: session.id, uid: credentials.uid, role });
      return true;
    } catch (error) {
      try {
        await joiningAdapter?.leave();
      } catch {
        /* Preserve the connection error. */
      }
      if (attempt !== streamAttempt.current) return false;
      const message =
        error instanceof Error
          ? error.message
          : 'Check your streaming configuration and try again.';
      setStreamError(message);
      Alert.alert('Could not join the stream', message);
      return false;
    }
  }

  async function openLive(session: LiveSession) {
    if (selectedLive && selectedLive.id !== session.id) await closeLiveRoom(selectedLive);
    setSelectedLive(session);
    setSelectedGift(null);
    setLiveRequestStatus('none');
    setLiveRequests([]);
    setRemoteUids([]);
    setLiveGiftEvents([]);
    setStreamError('');
    if (backendReady)
      void joinStream(
        session,
        session.host.id === profile.id
          ? 'host'
          : session.seats.some((seat) => seat.user.id === profile.id && seat.role === 'cohost')
            ? 'cohost'
            : 'viewer',
      );
  }

  async function handleRequestCoHost() {
    if (!selectedLive || !ensureSignedIn('request a co-host seat')) return;
    try {
      if (backendReady) await requestCoHost(selectedLive.id);
      setLiveRequestStatus('pending');
      showMessage('Your request was sent to the host.');
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not send your request.');
    }
  }

  async function handleSeatDecision(requestId: UUID, requester: Profile, accepted: boolean) {
    if (!selectedLive) return;
    try {
      if (backendReady) await decideCoHostRequest(requestId, accepted);
      setLiveRequests((old) => old.filter((request) => request.id !== requestId));
      if (accepted)
        setSelectedLive((old) =>
          old ? { ...old, seats: [...old.seats, { user: requester, role: 'cohost' }] } : old,
        );
      showMessage(accepted ? `${requester.displayName} is joining you.` : 'Request declined.');
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not update that request.');
    }
  }

  async function handleCircleRequestDecision(request: CircleJoinRequest, accepted: boolean) {
    try {
      if (backendReady)
        await decideCircleJoinRequest(request.circleId, request.requester.id, accepted);
      setCircleRequests((old) => old.filter((item) => item.id !== request.id));
      showMessage(
        accepted
          ? `${request.requester.displayName} joined ${request.circleName}.`
          : 'Request declined.',
      );
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not update this request.');
    }
  }

  async function handleFollow(person: Profile) {
    if (!ensureSignedIn('follow people')) return;
    const currentlyFollowing = followingIds.has(person.id);
    const current = captureAccount();
    try {
      if (backendReady) {
        if (currentlyFollowing) await unfollowUser(person.id);
        else await followUser(person.id);
        const [followState, nextConversations, nextFollowers, nextFollowing] = await Promise.all([
          loadPeopleAndFollows(0, PEOPLE_PAGE_SIZE),
          loadConversations(),
          loadFollowers(),
          loadFollowing(),
        ]);
        if (!current()) return;
        const following = new Set(followState.followingIds);
        const followers = new Set(followState.followerIds);
        const mutual = new Set([...following].filter((id) => followers.has(id)));

        setFollowingIds(following);
        setFollowerIds(followers);
        setFollowerProfiles(nextFollowers);
        setFollowingProfiles(nextFollowing);
        setMutualIds(mutual);
        setConversations(
          nextConversations
            .filter((conversation) => mutual.has(conversation.peer.id))
            .map((conversation) => ({
              ...conversation,
              messages: visibleMessages(conversation.messages),
            })),
        );
        setSelectedConversation((old) => (old && !mutual.has(old.peer.id) ? null : old));
      } else {
        const nextFollowing = new Set(followingIds);
        currentlyFollowing ? nextFollowing.delete(person.id) : nextFollowing.add(person.id);
        const nextMutual = new Set([...nextFollowing].filter((id) => followerIds.has(id)));
        setFollowingIds(nextFollowing);
        setMutualIds(nextMutual);
        setConversations(
          seedConversations.filter((conversation) => nextMutual.has(conversation.peer.id)),
        );
        setSelectedConversation((old) => (old && !nextMutual.has(old.peer.id) ? null : old));
      }
      showMessage(
        currentlyFollowing
          ? `You unfollowed ${person.displayName}.`
          : `You’re following ${person.displayName}.`,
      );
    } catch (error) {
      if (!current()) return;
      showMessage(error instanceof Error ? error.message : 'Could not update your follows.');
    }
  }

  async function handleGift(gift: Gift) {
    if (giftSendingRef.current) return;
    if (!selectedLive || !ensureSignedIn('send a live gift')) return;
    if (walletBalance < gift.coins) {
      setShowCoinStore(true);
      showMessage('Add coins to send this gift.');
      return;
    }
    giftSendingRef.current = true;
    setGiftSending(true);
    try {
      let activityRefreshed = true;
      if (backendReady) {
        const storageKey = `circles:pending-gift:${profile.id}:${selectedLive.id}:${gift.id}`;
        let idempotencyKey = await AsyncStorage.getItem(storageKey);
        if (!idempotencyKey) {
          idempotencyKey = createIdempotencyKey();
          await AsyncStorage.setItem(storageKey, idempotencyKey);
        }
        const authoritativeBalance = await sendGift(selectedLive.id, gift, idempotencyKey);
        void AsyncStorage.removeItem(storageKey).catch(() => {});
        if (authoritativeBalance !== null) setWalletBalance(authoritativeBalance);
        try {
          setLiveGiftEvents(await loadLiveGiftEvents(selectedLive.id));
        } catch {
          activityRefreshed = false;
        }
      } else {
        setLiveGiftEvents((old) =>
          [
            {
              id: `gift-${Date.now()}`,
              sender: profile,
              giftName: gift.name,
              emoji: gift.emoji,
              coins: gift.coins,
              createdAt: 'now',
            },
            ...old,
          ].slice(0, 8),
        );
        setWalletBalance((old) => old - gift.coins);
      }
      setSelectedGift(null);
      showMessage(
        activityRefreshed
          ? `${gift.emoji} ${gift.name} sent to ${selectedLive.host.displayName}.`
          : 'Gift sent. Room activity will refresh shortly.',
      );
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not send this gift.');
    } finally {
      giftSendingRef.current = false;
      setGiftSending(false);
    }
  }

  function removeMessageLocally(id: UUID) {
    deletedMessageIds.current.add(id);
    setSelectedConversation((old) =>
      old ? { ...old, messages: visibleMessages(old.messages) } : null,
    );
    setConversations((old) =>
      old.map((conversation) => ({
        ...conversation,
        messages: visibleMessages(conversation.messages),
      })),
    );
  }

  function removeCommentLocally(id: UUID) {
    deletedCommentIds.current.add(id);
    setPostComments(visibleComments);
    setDemoComments((old) =>
      Object.fromEntries(
        Object.entries(old).map(([postId, comments]) => [postId, visibleComments(comments)]),
      ),
    );
  }

  async function handleDeleteMessage(message: DirectMessage) {
    if (!canDeleteOwnContent(message.senderId, profile.id, message.createdAtIso))
      throw new Error('You can only delete your own messages within 15 minutes of sending.');
    const current = captureAccount();
    if (backendReady) await deleteDirectMessage(message.id);
    if (!current()) return;
    removeMessageLocally(message.id);
    showMessage('Message deleted for everyone.');
  }

  async function handleDeleteComment(comment: PostComment) {
    if (!canDeleteOwnContent(comment.author.id, profile.id, comment.createdAtIso))
      throw new Error('You can only delete your own comments within 15 minutes of posting.');
    const current = captureAccount();
    if (backendReady) await deletePostComment(comment.id);
    if (!current()) return;
    removeCommentLocally(comment.id);
    showMessage('Comment deleted for everyone.');
  }

  async function handleSendMessage(body: string, replyToId?: string) {
    if (!selectedConversation || !mutualIds.has(selectedConversation.peer.id)) {
      showMessage('Direct messages are available while you follow each other.');
      throw new Error('Follow each other before messaging.');
    }
    if (!ensureSignedIn('send a direct message')) throw new Error('Sign in before sending.');
    if (backendReady) {
      try {
        await sendDirectMessage(selectedConversation.peer.id, body, replyToId);
        const messages = visibleMessages(
          await loadConversationMessages(
            selectedConversation.peer.id,
            undefined,
            MESSAGE_PAGE_SIZE,
          ),
        );
        setChatHasOlder(messages.length === MESSAGE_PAGE_SIZE);
        setSelectedConversation((old) =>
          old?.peer.id === selectedConversation.peer.id ? { ...old, messages } : old,
        );
        setConversations((old) =>
          old.map((conversation) =>
            conversation.peer.id === selectedConversation.peer.id
              ? { ...conversation, messages }
              : conversation,
          ),
        );
      } catch (error) {
        showMessage(error instanceof Error ? error.message : 'Could not send your message.');
        throw error;
      }
      return;
    }
    const message = {
      id: `message-${Date.now()}`,
      senderId: profile.id,
      body,
      replyToId,
      createdAt: 'now',
      createdAtIso: new Date().toISOString(),
    };
    setConversations((old) =>
      old.map((conversation) =>
        conversation.id === selectedConversation.id
          ? { ...conversation, messages: [...conversation.messages, message], unread: 0 }
          : conversation,
      ),
    );
    setSelectedConversation((old) =>
      old ? { ...old, messages: [...old.messages, message] } : old,
    );
  }

  async function openConversation(conversation: Conversation) {
    setSelectedConversation(conversation);
    setChatHasOlder(false);
    if (!backendReady || !mutualIds.has(conversation.peer.id)) return;
    try {
      await markConversationRead(conversation.peer.id);
      const messages = visibleMessages(
        await loadConversationMessages(conversation.peer.id, undefined, MESSAGE_PAGE_SIZE),
      );
      setChatHasOlder(messages.length === MESSAGE_PAGE_SIZE);
      setSelectedConversation((old) =>
        old?.peer.id === conversation.peer.id ? { ...old, messages, unread: 0 } : old,
      );
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not open this conversation.');
    }
  }

  function closePublicProfile() {
    publicProfileRequest.current += 1;
    setSelectedPublicProfile(null);
    setPublicProfileLoading(false);
  }

  async function openPublicProfile(person: Profile) {
    if (person.id === profile.id) {
      closePublicProfile();
      setTab('profile');
      return;
    }
    if (blockedIds.has(person.id)) {
      showMessage('This profile is unavailable.');
      return;
    }
    const requestId = ++publicProfileRequest.current;
    setSelectedPublicProfile(person);
    setPublicProfilePosts([]);
    setPublicProfileHasMore(false);
    setPublicProfileLoading(true);
    setPublicProfileFollowers([]);
    setPublicProfileFollowing([]);
    try {
      const [loadedProfile, followers, following, posts] = await Promise.all([
        loadPublicProfile(person.id),
        loadUserFollowers(person.id),
        loadUserFollowing(person.id),
        loadProfilePosts(person.id, 0, FEED_PAGE_SIZE),
      ]);
      if (requestId !== publicProfileRequest.current) return;
      if (!loadedProfile) throw new Error('This profile is no longer available.');
      setSelectedPublicProfile(loadedProfile);
      setPublicProfilePosts(posts);
      setPublicProfileHasMore(posts.length === FEED_PAGE_SIZE);
      setPublicProfileFollowers(followers.filter((item) => !blockedIds.has(item.id)));
      setPublicProfileFollowing(following.filter((item) => !blockedIds.has(item.id)));
    } catch (error) {
      if (requestId === publicProfileRequest.current)
        showMessage(error instanceof Error ? error.message : 'Could not load this profile.');
    } finally {
      if (requestId === publicProfileRequest.current) setPublicProfileLoading(false);
    }
  }

  function openProfileConversation(person: Profile) {
    const conversation = conversations.find((item) => item.peer.id === person.id) ?? {
      id: [profile.id, person.id].sort().join(':'),
      peer: person,
      isMutual: true,
      unread: 0,
      messages: [],
    };
    void openConversation(conversation);
  }

  async function loadOlderMessages(before: string): Promise<DirectMessage[]> {
    if (!selectedConversation) return [];
    try {
      const older = visibleMessages(
        await loadConversationMessages(selectedConversation.peer.id, before, MESSAGE_PAGE_SIZE),
      );
      setChatHasOlder(older.length === MESSAGE_PAGE_SIZE);
      setSelectedConversation((old) =>
        old?.peer.id === selectedConversation.peer.id
          ? {
              ...old,
              messages: [
                ...older,
                ...old.messages.filter((message) => !older.some((item) => item.id === message.id)),
              ],
            }
          : old,
      );
      return older;
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not load earlier messages.');
      throw error;
    }
  }

  async function openPostReplies(post: CirclePost) {
    replyViewEpoch.current++;
    commentRefreshRequest.current++;
    setSelectedPost(post);
    setCommentDraft('');
    setPostComments([]);
    setCommentLimit(50);
    setCommentsHasMore(false);
    setCommentsError('');
    setCommentsLoading(backendReady);
    if (!backendReady) setPostComments(demoComments[post.id] ?? []);
  }

  function closePostReplies() {
    replyViewEpoch.current++;
    commentRefreshRequest.current++;
    setSelectedPost(null);
  }

  async function handlePostReply(replyToId?: string) {
    if (!selectedPost || !commentDraft.trim()) throw new Error('Write a reply before sending.');
    if (!ensureSignedIn('reply to a post')) throw new Error('Sign in before replying.');
    const postId = selectedPost.id,
      body = commentDraft.trim(),
      owner = profile.id,
      view = replyViewEpoch.current;
    const accountCurrent = captureAccount(),
      sendKey = `${owner}:${postId}`;
    if (pendingCommentSends.current.has(sendKey))
      throw new Error('Your reply is already being sent.');
    pendingCommentSends.current.add(sendKey);
    try {
      const comment = backendReady
        ? await createPostComment(postId, body, replyToId, owner)
        : {
            id: createIdempotencyKey(),
            postId,
            author: profile,
            body,
            replyToId,
            createdAt: 'now',
            createdAtIso: new Date().toISOString(),
          };
      if (!accountCurrent()) return;
      if (!backendReady)
        setDemoComments((old) => ({ ...old, [postId]: [...(old[postId] ?? []), comment] }));
      if (view !== replyViewEpoch.current) return;
      commentRefreshRequest.current++;
      setCommentsLoading(false);
      setPostComments((old) =>
        visibleComments([...old.filter((item) => item.id !== comment.id), comment]),
      );
      setCommentDraft('');
    } catch (error) {
      if (accountCurrent() && view === replyViewEpoch.current)
        showMessage(error instanceof Error ? error.message : 'Could not add your reply.');
      throw error;
    } finally {
      pendingCommentSends.current.delete(sendKey);
    }
  }

  async function performBlockUser(targetUserId: UUID) {
    if (!ensureSignedIn('block people')) return;
    if (backendReady) await blockUser(targetUserId);
    clearMediaCache();
    setSearchRevision((v) => v + 1);
    setCirclePosts((old) => old.filter((p) => p.author.id !== targetUserId));
    setPublicProfilePosts((old) => old.filter((p) => p.author.id !== targetUserId));
    setSelectedPublicProfile((old) => (old?.id === targetUserId ? null : old));
    setBlockedIds((old) => new Set(old).add(targetUserId));
    setFeed((old) => old.filter((post) => post.author.id !== targetUserId));
    setLives((old) => old.filter((live) => live.host.id !== targetUserId));
    setFollowerProfiles((old) => old.filter((person) => person.id !== targetUserId));
    setFollowingProfiles((old) => old.filter((person) => person.id !== targetUserId));
    setConversations((old) => old.filter((conversation) => conversation.peer.id !== targetUserId));
    setFollowingIds((old) => {
      const next = new Set(old);
      next.delete(targetUserId);
      return next;
    });
    setMutualIds((old) => {
      const next = new Set(old);
      next.delete(targetUserId);
      return next;
    });
    setFollowerIds((old) => {
      const next = new Set(old);
      next.delete(targetUserId);
      return next;
    });
    setSelectedConversation((old) => (old?.peer.id === targetUserId ? null : old));
    if (selectedLive?.host.id === targetUserId) void closeLiveRoom(selectedLive);
    setSelectedLive((old) => (old?.host.id === targetUserId ? null : old));
    showMessage(
      backendReady
        ? 'This person is blocked and removed from your followers.'
        : 'This person is blocked for this demo session.',
    );
  }

  function confirmBlockFollower(follower: Profile) {
    if (!ensureSignedIn('block followers')) return;
    Alert.alert(
      'Block this follower?',
      `${follower.displayName} will be removed as a follower and won’t be able to follow or message you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block follower',
          style: 'destructive',
          onPress: () => {
            void performBlockUser(follower.id).catch((error) =>
              showMessage(
                error instanceof Error ? error.message : 'Could not block this follower.',
              ),
            );
          },
        },
      ],
    );
  }

  async function handleReport(
    targetType: 'post' | 'profile' | 'circle' | 'message' | 'live_session',
    targetId: UUID,
    targetUserId?: UUID,
  ) {
    if (!ensureSignedIn('report or block content')) return;
    Alert.alert('Keep Circles kind', 'What would you like to do?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', onPress: () => setReportTarget({ targetType, targetId }) },
      ...(targetUserId
        ? [
            {
              text: 'Block user',
              style: 'destructive' as const,
              onPress: () => {
                void performBlockUser(targetUserId).catch((error) =>
                  showMessage(
                    error instanceof Error ? error.message : 'Could not block this person.',
                  ),
                );
              },
            },
          ]
        : []),
    ]);
  }

  async function toggleLike(postId: UUID) {
    const post =
      [...feed, ...circlePosts, ...publicProfilePosts].find((item) => item.id === postId) ??
      (selectedPost?.id === postId ? selectedPost : null);
    if (!post || pendingLikes.current.has(postId) || !ensureSignedIn('like posts')) return;
    pendingLikes.current.add(postId);
    const apply = (liked: boolean, likes: number) => {
      const update = (items: CirclePost[]) => applyPostReaction(items, postId, liked, likes);
      setFeed(update);
      setCirclePosts(update);
      setPublicProfilePosts(update);
      setSelectedPost((old) => (old?.id === postId ? { ...old, liked, likes } : old));
    };
    apply(!post.liked, Math.max(0, post.likes + (post.liked ? -1 : 1)));
    try {
      if (backendReady) await togglePostLike(postId, !post.liked);
    } catch (error) {
      apply(post.liked, post.likes);
      showMessage('Your like could not be saved. Try again.');
      void reportDiagnostic(error, 'network');
    } finally {
      pendingLikes.current.delete(postId);
    }
  }

  async function closeLiveRoom(session: LiveSession) {
    streamAttempt.current += 1;
    remoteUsersCleanup.current?.();
    remoteUsersCleanup.current = null;
    if (backendReady && session.host.id === profile.id) {
      try {
        await endLiveSession(session.id);
        setLives((old) => old.filter((live) => live.id !== session.id));
      } catch (error) {
        showMessage(error instanceof Error ? error.message : 'Could not end the live room.');
      }
    }
    if (backendReady && session.host.id !== profile.id) {
      try {
        await releaseLiveSeat(session.id);
      } catch (error) {
        void reportDiagnostic(error, 'stream');
      }
    }
    try {
      await streamingAdapter?.leave();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not disconnect from live video.');
    }
    setStreamingAdapter(null);
    setStreamCredentials(null);
    setStreamError('');
    setLiveGiftEvents([]);
    setSelectedLive(null);
    setSelectedGift(null);
  }

  async function refreshSelectedCircle() {
    const id = activeCircleId.current;
    if (!id) return;
    setCirclePostsLoading(true);
    try {
      const page = await loadCirclePosts(id);
      if (activeCircleId.current !== id) return;
      setCirclePosts(page);
      setCirclePostsHasMore(page.length === FEED_PAGE_SIZE);
    } catch {
      if (activeCircleId.current === id) showMessage('Could not refresh posts.');
    } finally {
      if (activeCircleId.current === id) setCirclePostsLoading(false);
    }
  }

  function screenContent() {
    if (selectedCircle)
      return (
        <CircleDetailScreen
          stories={
            <Stories
              key={profile.id + selectedCircle.id}
              profile={profile}
              circles={[selectedCircle]}
              scope={selectedCircle.id}
              connected={backendReady}
              enabled={signedIn || !backendReady}
              refreshing={refreshing}
            />
          }
          tools={<CircleTools key={selectedCircle.id} circle={selectedCircle} />}
          refreshing={circlePostsLoading}
          onRefresh={() => void refreshSelectedCircle()}
          circle={selectedCircle}
          posts={circlePosts}
          postsLoading={circlePostsLoading}
          requested={requestedCircles.has(selectedCircle.id)}
          joining={joiningCircleIds.has(selectedCircle.id)}
          postsHasMore={circlePostsHasMore}
          postsLoadingMore={circlePostsLoadingMore}
          onBack={closeCircle}
          onJoin={() => void handleJoin(selectedCircle)}
          onLeave={() => void handleLeave(selectedCircle)}
          onPost={openPostReplies}
          onLike={toggleLike}
          onCreatePost={() => {
            if (postCircleId !== selectedCircle.id) setPostRequestId(createIdempotencyKey());
            setPostCircleId(selectedCircle.id);
            closeCircle();
            setShowCreatePost(true);
          }}
          onLoadMore={() => void loadMoreCirclePosts()}
        />
      );
    if (selectedPublicProfile)
      return (
        <PublicProfileScreen
          profile={selectedPublicProfile}
          followers={publicProfileFollowers}
          following={publicProfileFollowing}
          key={selectedPublicProfile.id}
          posts={publicProfilePosts}
          hasMore={publicProfileHasMore}
          onLoadMore={() => void loadMoreProfilePosts()}
          isFollowing={followingIds.has(selectedPublicProfile.id)}
          isMutual={mutualIds.has(selectedPublicProfile.id)}
          loading={publicProfileLoading}
          signedIn={signedIn}
          onBack={closePublicProfile}
          onFollow={() => void handleFollow(selectedPublicProfile)}
          onMessage={() => openProfileConversation(selectedPublicProfile)}
          onOpenProfile={(person) => void openPublicProfile(person)}
          onLike={toggleLike}
          onReply={openPostReplies}
        />
      );
    if (tab === 'home')
      return (
        <HomeScreen
          stories={
            <Stories
              key={profile.id + String(signedIn)}
              profile={profile}
              circles={circles}
              connected={backendReady}
              enabled={signedIn || !backendReady}
              refreshing={refreshing}
            />
          }
          loading={initialLoading}
          refreshing={refreshing}
          error={loadError}
          onRefresh={() => void refreshAll()}
          onActivity={() => setShowActivity(true)}
          unreadActivity={activity.filter((n) => !n.read_at).length}
          profile={profile}
          circles={circles}
          lives={lives}
          feed={feed}
          feedHasMore={feedHasMore}
          feedLoadingMore={feedLoadingMore}
          onLoadMore={loadMorePosts}
          onProfile={() => setTab('profile')}
          onLive={openLive}
          onLiveList={() => setTab('live')}
          onCreatePost={() => setShowCreatePost(true)}
          onExplore={() => setTab('circles')}
          onLike={toggleLike}
          onReply={openPostReplies}
          onReport={handleReport}
          onCircle={openCircle}
        />
      );
    if (tab === 'circles')
      return (
        <ExploreScreen
          discovery={discovery}
          onDiscovery={setDiscovery}
          profile={profile}
          loading={searchLoading}
          error={searchError}
          onRetry={() => setSearchRevision((v) => v + 1)}
          people={searchPeople.filter(
            (person) => person.id !== profile.id && !blockedIds.has(person.id),
          )}
          followingIds={followingIds}
          onFollow={handleFollow}
          onOpenProfile={(person) => void openPublicProfile(person)}
          peopleHasMore={peopleHasMore}
          peopleLoadingMore={peopleLoadingMore}
          onLoadMorePeople={loadMorePeople}
          circles={searchCircles}
          joiningCircleIds={joiningCircleIds}
          circlesHasMore={circlesHasMore}
          circlesLoadingMore={circlesLoadingMore}
          onLoadMoreCircles={loadMoreCircles}
          requested={requestedCircles}
          requests={circleRequests}
          searchText={searchText}
          onSearch={setSearchText}
          filter={interestFilter}
          onFilter={setInterestFilter}
          onJoin={handleJoin}
          onCreate={() => setShowCreateCircle(true)}
          onProfile={() => setTab('profile')}
          onReport={handleReport}
          onCircle={openCircle}
          onRequestDecision={handleCircleRequestDecision}
        />
      );
    if (tab === 'live')
      return (
        <LiveScreen
          circles={circles}
          refreshing={refreshing}
          onRefresh={() => void refreshAll()}
          profile={profile}
          lives={lives}
          onProfile={() => setTab('profile')}
          onLive={openLive}
          onStart={() => {
            setCreateTitle('');
            setCreateCircleName('');
            setShowStartLive(true);
          }}
        />
      );
    if (tab === 'inbox')
      return (
        <InboxScreen
          profile={profile}
          conversations={conversations.filter((conversation) =>
            mutualIds.has(conversation.peer.id),
          )}
          onProfile={() => setTab('profile')}
          onConversation={(conversation) => void openConversation(conversation)}
        />
      );
    return (
      <ProfileScreen
        onSettings={() => setShowSettings(true)}
        onForgotPassword={() => setRecoveryMode('request')}
        onOnboarding={() => setShowOnboarding(true)}
        key={profile.id}
        profile={profile}
        circles={circles.filter((circle) => circle.isMember)}
        followers={followerProfiles}
        following={followingProfiles}
        walletBalance={walletBalance}
        followingCount={followingIds.size}
        followerCount={followerIds.size}
        signedIn={signedIn}
        backendReady={backendReady}
        authEmail={authEmail}
        authPassword={authPassword}
        authError={authError}
        authBusy={authBusy}
        profileSaving={profileSaving}
        onSaveProfile={saveProfile}
        onEmail={setAuthEmail}
        onPassword={setAuthPassword}
        onAuth={handleAuth}
        onStore={() => setShowCoinStore(true)}
        onCircle={openCircle}
        onBlockFollower={confirmBlockFollower}
        onOpenProfile={(person) => void openPublicProfile(person)}
        onSignOut={() => {
          void signOutDevice().catch(() =>
            showMessage('Could not sign out. Check your connection and retry.'),
          );
        }}
      />
    );
  }

  useEffect(() => {
    const receive = (url: string) => {
      const link = parseContentLink(url);
      if (link) setPendingContentLink(link);
    };
    void Linking.getInitialURL()
      .then((url) => {
        if (url) receive(url);
      })
      .catch(() => {});
    const subscription = Linking.addEventListener('url', ({ url }) => receive(url));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!signedIn || !pendingContentLink) return;
    let active = true;
    void (async () => {
      try {
        if (pendingContentLink.kind === 'post') {
          const post = await loadPostById(pendingContentLink.id);
          if (!active) return;
          if (post) {
            await openPostReplies(post);
            setPendingContentLink(null);
            return;
          }
        }
        const id =
          pendingContentLink.kind === 'circle'
            ? pendingContentLink.id
            : pendingContentLink.circleId;
        const circle = id ? await loadCircleById(id) : null;
        if (!active) return;
        if (circle) {
          setSelectedCircle(circle);
          setTab('circles');
          showMessage('Join this circle to access member posts.');
        } else showMessage('This content is unavailable or you do not have access.');
        // Keep post intent while awaiting membership approval; retry after membership refresh.
        if (!circle || circle.isMember || pendingContentLink.kind === 'circle')
          setPendingContentLink(null);
      } catch {
        if (active) {
          showMessage('Could not open this link. Open the link again to retry.');
          setPendingContentLink(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [
    signedIn,
    profile.id,
    pendingContentLink,
    circles.map((c) => `${c.id}:${c.isMember}`).join(','),
  ]);

  // This local state keeps the start-live sheet independent of the bottom tab.

  return (
    <PostActionsProvider
      key={signedIn ? profile.id : 'signed-out'}
      userId={profile.id}
      onOpen={openPostReplies}
      onChanged={(id, body) => {
        const update = (rows: CirclePost[]) =>
          body === null
            ? rows.filter((p) => p.id !== id)
            : rows.map((p) => (p.id === id ? { ...p, body } : p));
        setFeed(update);
        setCirclePosts(update);
        setPublicProfilePosts(update);
        if (selectedPost?.id === id)
          setSelectedPost(body === null ? null : { ...selectedPost, body });
      }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar barStyle={selectedLive || theme === 'dark' ? 'light-content' : 'dark-content'} />
        <View style={styles.appShell}>
          {screenContent()}
          <TabBar
            selected={tab}
            onChange={(nextTab) => {
              closeCircle();
              closePublicProfile();
              setTab(nextTab);
            }}
          />
          {toast ? (
            <View accessibilityLiveRegion="polite" style={styles.toast}>
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          ) : null}
          {showCreatePost ? (
            <CreatePostSheet
              progress={uploadProgress}
              error={postError}
              onCancel={() => uploadController.current?.abort()}
              onDiscard={() => {
                void clearDraft(profile.id);
                setPostBody('');
                setAttachment(null);
                setPostRequestId(createIdempotencyKey());
                setPostError('');
              }}
              busy={createPostBusy}
              circles={circles.filter((circle) => circle.isMember)}
              selectedCircleId={postCircleId}
              onSelectCircle={(value) => {
                setPostCircleId(value);
                setPostRequestId(createIdempotencyKey());
              }}
              body={postBody}
              onBody={(value) => {
                setPostBody(value);
                setPostRequestId(createIdempotencyKey());
                setPostError('');
              }}
              attachment={attachment}
              onPick={pickAttachment}
              onRecordVideo={() => void pickAttachment('video', 'camera')}
              onClearAttachment={() => {
                setAttachment(null);
                setPostRequestId(createIdempotencyKey());
              }}
              onClose={() => {
                if (!createPostBusy) {
                  attachmentPicker.current = null;
                  setShowCreatePost(false);
                }
              }}
              onSubmit={() => void handleCreatePost()}
            />
          ) : null}
          {showCreateCircle ? (
            <CreateCircleSheet
              busy={createCircleBusy}
              name={createCircleName}
              description={createCircleDescription}
              interest={createCircleInterest}
              isPrivate={createCirclePrivate}
              onName={setCreateCircleName}
              onDescription={setCreateCircleDescription}
              onInterest={setCreateCircleInterest}
              onPrivate={setCreateCirclePrivate}
              onClose={() => setShowCreateCircle(false)}
              onSubmit={() => void handleCreateCircle()}
            />
          ) : null}
          {showStartLive ? (
            <StartLiveSheet
              title={createTitle}
              onTitle={setCreateTitle}
              onClose={() => setShowStartLive(false)}
              onSubmit={() => {
                setShowStartLive(false);
                void handleStartLive();
              }}
            />
          ) : null}
          {selectedLive ? (
            <LiveRoom
              session={selectedLive}
              profile={profile}
              walletBalance={walletBalance}
              gifts={gifts}
              giftEvents={liveGiftEvents}
              selectedGift={selectedGift}
              giftSending={giftSending}
              liveRequestStatus={liveRequestStatus}
              liveRequests={liveRequests}
              signedIn={signedIn}
              backendReady={backendReady}
              streamCredentials={streamCredentials}
              streamError={streamError}
              connectionState={connectionState}
              onReconnect={() => {
                if (selectedLive)
                  void joinStream(
                    selectedLive,
                    selectedLive.host.id === profile.id
                      ? 'host'
                      : selectedLive.seats.some((seat) => seat.user.id === profile.id)
                        ? 'cohost'
                        : 'viewer',
                  );
              }}
              remoteUids={remoteUids}
              micEnabled={micEnabled}
              cameraEnabled={cameraEnabled}
              onClose={() => void closeLiveRoom(selectedLive)}
              onGiftSelect={setSelectedGift}
              onGiftSend={handleGift}
              onBuyCoins={() => setShowCoinStore(true)}
              onRequestCoHost={() => void handleRequestCoHost()}
              onDecision={handleSeatDecision}
              onReport={() =>
                void handleReport('live_session', selectedLive.id, selectedLive.host.id)
              }
              onToggleMic={() => {
                const next = !micEnabled;
                if (!streamingAdapter) return;
                void streamingAdapter
                  .setMicrophoneEnabled(next)
                  .then(() => setMicEnabled(next))
                  .catch((error) =>
                    showMessage(
                      error instanceof Error ? error.message : 'Could not update your microphone.',
                    ),
                  );
              }}
              onToggleCamera={() => {
                const next = !cameraEnabled;
                if (!streamingAdapter) return;
                void streamingAdapter
                  .setCameraEnabled(next)
                  .then(() => setCameraEnabled(next))
                  .catch((error) =>
                    showMessage(
                      error instanceof Error ? error.message : 'Could not update your camera.',
                    ),
                  );
              }}
              onSwitchCamera={() => {
                void streamingAdapter
                  ?.switchCamera()
                  .catch((error) =>
                    showMessage(
                      error instanceof Error ? error.message : 'Could not switch cameras.',
                    ),
                  );
              }}
            />
          ) : null}
          {selectedConversation ? (
            <ChatScreen
              key={selectedConversation.peer.id}
              conversation={selectedConversation}
              profile={profile}
              hasOlder={chatHasOlder}
              onLoadOlder={loadOlderMessages}
              onClose={() => setSelectedConversation(null)}
              onSend={handleSendMessage}
              onDelete={handleDeleteMessage}
              onReport={() => {
                const lastMessage = selectedConversation.messages.at(-1);
                void handleReport(
                  lastMessage ? 'message' : 'profile',
                  lastMessage?.id ?? selectedConversation.peer.id,
                  selectedConversation.peer.id,
                );
              }}
            />
          ) : null}
          {showCoinStore ? (
            <CoinStore
              balance={walletBalance}
              onClose={() => setShowCoinStore(false)}
              onBalance={setWalletBalance}
            />
          ) : null}
          {showOnboarding && !recoveryMode ? (
            <OnboardingSheet
              key={profile.id}
              profile={profile}
              onComplete={(updated, introduceIn) => {
                setProfile(updated);
                setShowOnboarding(false);
                void refreshAll();
                if (introduceIn) {
                  setPostCircleId(introduceIn.id);
                  setPostBody('');
                  setPostRequestId(createIdempotencyKey());
                  setCircles((old) =>
                    old.map((c) => (c.id === introduceIn.id ? { ...c, isMember: true } : c)),
                  );
                  setShowCreatePost(true);
                } else setTab('circles');
              }}
            />
          ) : null}
          {showSettings ? (
            <SettingsSheet
              onClose={() => setShowSettings(false)}
              onBlocksChanged={() => {
                clearMediaCache();
                setSearchRevision((v) => v + 1);
                void loadBlockedPeople().then((items) =>
                  setBlockedIds(new Set(items.map((p) => p.id))),
                );
                void refreshAll();
              }}
              onDeleted={() => {
                void clearDraft(profile.id);
                setShowSettings(false);
                setSignedIn(false);
                setTab('profile');
              }}
              onModerator={() => {
                setShowSettings(false);
                setShowModerator(true);
              }}
            />
          ) : null}
          {recoveryMode ? (
            <RecoverySheet
              email={authEmail}
              recovery={recoveryMode === 'update'}
              onClose={() => setRecoveryMode(null)}
            />
          ) : null}
          {showActivity ? (
            <ActivitySheet
              items={activity}
              loading={activityLoading}
              hasMore={activityHasMore}
              onMore={() => void refreshActivity(true)}
              onRefresh={() => void refreshActivity()}
              onOpen={(item, ids) => void openActivityItem(item, ids)}
              onClose={() => setShowActivity(false)}
            />
          ) : null}
          {showModerator ? (
            <ModeratorSheet
              onClose={() => {
                setShowModerator(false);
                void refreshAll();
              }}
            />
          ) : null}
          {reportTarget ? (
            <ReportSheet
              onClose={() => setReportTarget(null)}
              onSubmit={async (reason) => {
                if (backendReady) await reportContent({ ...reportTarget, reason });
                showMessage('Your report has been sent for review.');
              }}
            />
          ) : null}
          {selectedPost ? (
            <PostRepliesSheet
              key={`${profile.id}:${selectedPost.id}`}
              loading={commentsLoading}
              loadError={commentsError}
              hasMore={commentsHasMore}
              onRetry={() => setCommentsRevision((v) => v + 1)}
              onLoadMore={() => setCommentLimit((v) => v + 50)}
              post={selectedPost}
              comments={postComments}
              profile={profile}
              onDelete={handleDeleteComment}
              draft={commentDraft}
              onDraft={setCommentDraft}
              onSend={handlePostReply}
              onClose={closePostReplies}
            />
          ) : null}
        </View>
      </SafeAreaView>
    </PostActionsProvider>
  );
}
