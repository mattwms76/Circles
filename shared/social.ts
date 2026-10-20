export type Profile = {
  id: number;
  name: string;
  handle: string;
  bio: string;
  avatar: string;
  cover?: string;
  followers: number;
  following: number;
  isFollowing?: boolean;
};
export type Circle = {
  id: number;
  name: string;
  description: string;
  category: string;
  image: string;
  color: string;
  memberCount: number;
  ownerId: number;
  privacy: "public" | "private";
  role?: "owner" | "moderator" | "member" | "pending" | null;
  joined?: boolean;
};
export type Post = {
  id: number;
  author: Profile;
  circleId: number | null;
  circleName: string | null;
  text: string;
  media: string | null;
  mediaType: "photo" | "video" | "text";
  likes: number;
  comments: number;
  liked: boolean;
  saved: boolean;
  createdAt: string;
};
export type Comment = {
  id: number;
  author: Profile;
  text: string;
  createdAt: string;
};
export type Conversation = {
  id: number;
  name: string;
  avatar: string;
  kind: "direct" | "circle";
  circleId: number | null;
  lastMessage: string;
  updatedAt: string;
  unread: number;
};
export type Message = {
  id: number;
  conversationId: number;
  author: Profile;
  text: string;
  media: string | null;
  createdAt: string;
  read: boolean;
};
export type Member = {
  user: Profile;
  role: "owner" | "moderator" | "member" | "pending";
};
export type LiveStream = {
  id: number;
  host: Profile;
  title: string;
  circleId: number | null;
  thumbnail: string;
  viewers: number;
  status: "live" | "ended";
  createdAt: string;
};
