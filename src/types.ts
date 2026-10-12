export type UUID = string;
export type MediaKind = 'image' | 'gif' | 'video';

export interface Profile {
  id: UUID;
  handle: string;
  displayName: string;
  avatarUrl: string;
  bio?: string;
  onboardingCompletedAt?: string | null;
  interests: string[];
}

export interface Circle {
  id: UUID;
  name: string;
  description: string;
  interest: string;
  members: number;
  isPrivate: boolean;
  isMember: boolean;
  isOwner?: boolean;
  welcomeText?: string;
  color: string;
  imageUrl: string;
}

export interface PostMedia {
  id: UUID;
  kind: MediaKind;
  url: string;
  width?: number;
  height?: number;
}

export interface CirclePost {
  id: UUID;
  circleId: UUID;
  circleName: string;
  author: Profile;
  body: string;
  media?: PostMedia;
  likes: number;
  createdAt: string;
  liked: boolean;
}

export interface PostComment {
  createdAtIso?: string;
  id: UUID;
  postId: UUID;
  author: Profile;
  body: string;
  createdAt: string;
}

export interface DirectMessage {
  id: UUID;
  senderId: UUID;
  body: string;
  createdAt: string;
  createdAtIso?: string;
}

export interface Conversation {
  id: UUID;
  peer: Profile;
  isMutual: boolean;
  unread: number;
  messages: DirectMessage[];
}

export type LiveStatus = 'live' | 'ended';
export type SeatRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface LiveSeat {
  user: Profile;
  role: 'host' | 'cohost';
}

export interface LiveSession {
  id: UUID;
  host: Profile;
  title: string;
  circleName?: string;
  viewerCount: number;
  status: LiveStatus;
  startedAt: string;
  seats: LiveSeat[];
}

export interface CoHostRequest {
  id: UUID;
  sessionId: UUID;
  requester: Profile;
  status: SeatRequestStatus;
}

export interface CircleJoinRequest {
  id: UUID;
  circleId: UUID;
  circleName: string;
  requester: Profile;
}

export interface Gift {
  id: UUID;
  name: string;
  emoji: string;
  coins: number;
  tier: 'tiny' | 'small' | 'medium' | 'large' | 'legendary';
}

export interface LiveGiftEvent {
  id: UUID;
  sender: Profile;
  giftName: string;
  emoji: string;
  coins: number;
  createdAt: string;
}

export interface ModerationAction {
  id: UUID;
  actorId: UUID;
  targetType: 'post' | 'profile' | 'circle' | 'message' | 'live_session';
  targetId: UUID;
  reason: string;
  createdAt: string;
}

export interface CreatePostInput {
  circleId: UUID;
  body: string;
  requestId?: string;
  media?: { uri: string; mimeType: string; fileName: string; kind: MediaKind };
}

export interface StreamingAdapter {
  join(input: { sessionId: UUID; role: 'host' | 'cohost' | 'viewer'; token: string; channel: string; uid: number }): Promise<void>;
  leave(): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  switchCamera(): Promise<void>;
  onRemoteUsersChanged?(listener: (uids: number[]) => void): () => void;
}
