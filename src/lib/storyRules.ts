export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
export const STORY_VIDEO_SECONDS = 60;
export interface StoryMedia {
  uri: string;
  kind: 'image' | 'video';
  mimeType: string;
  size: number;
  duration?: number;
}
export function validateStoryMedia(media: StoryMedia) {
  const allowed =
    media.kind === 'image'
      ? ['image/jpeg', 'image/png', 'image/webp']
      : ['video/mp4', 'video/quicktime', 'video/webm'];
  if (!allowed.includes(media.mimeType))
    throw new Error('Choose a JPG, PNG, WebP, MP4, MOV or WebM file.');
  if (
    !Number.isFinite(media.size) ||
    media.size <= 0 ||
    media.size > (media.kind === 'image' ? 10 : 25) * 1024 * 1024
  )
    throw new Error(
      media.kind === 'image'
        ? 'Photos must be 10 MB or smaller.'
        : 'Videos must be 25 MB or smaller.',
    );
  if (
    media.kind === 'video' &&
    (!Number.isFinite(media.duration) ||
      media.duration! <= 0 ||
      media.duration! > STORY_VIDEO_SECONDS)
  )
    throw new Error('Choose a video up to 60 seconds long with a readable duration.');
}
export function activeStories<T extends { expiresAt: string; createdAt: string }>(
  stories: T[],
  now = Date.now(),
) {
  return stories.filter((s) => {
    const created = Date.parse(s.createdAt);
    return created <= now && Math.min(Date.parse(s.expiresAt), created + STORY_TTL_MS) > now;
  });
}
