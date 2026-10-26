import { useLiveAvatar } from "@/hooks/live-avatar-context";
import { Avatar, type AvatarProps } from "./circles-ui";

export type UserAvatarProps = AvatarProps & {
  /** Omit this for group/media sources that do not expose an exact person id. */
  userId?: number | null;
};

/**
 * Keeps the shared Avatar presentational. Only callsites with an authoritative
 * person id opt into live-status registration and pulse rendering.
 */
export function UserAvatar({ userId, ...avatarProps }: UserAvatarProps) {
  const { isForeground, isLive } = useLiveAvatar(userId);
  return <Avatar {...avatarProps} live={isLive} livePulse={isForeground} />;
}
