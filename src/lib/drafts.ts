import { secureStorage as AsyncStorage } from './secureStorage';
import * as FileSystem from 'expo-file-system/legacy';
import type { CreatePostInput } from '../types';
export interface PostDraft {
  body: string;
  circleId: string;
  media?: CreatePostInput['media'];
  mediaItems?: CreatePostInput['mediaItems'];
  topicId?: string | null;
  requestId: string;
}
const draftKey = (userId: string) => `circles:post-draft:${userId}`;
export async function readDraft(userId: string): Promise<PostDraft | null> {
  const raw = await AsyncStorage.getItem(draftKey(userId));
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    if (
      !draft ||
      typeof draft.body !== 'string' ||
      draft.body.length > 5000 ||
      typeof draft.circleId !== 'string' ||
      typeof draft.requestId !== 'string' ||
      !draft.requestId ||
      draft.requestId.length > 128
    )
      return null;
    if (draft.topicId !== undefined && draft.topicId !== null && typeof draft.topicId !== 'string')
      return null;
    const items = draft.mediaItems ?? (draft.media ? [draft.media] : []);
    if (
      !Array.isArray(items) ||
      items.length > 10 ||
      (items.length > 1 && items.some((m: any) => m.kind !== 'image'))
    )
      return null;
    for (const media of [...items, ...(draft.media ? [draft.media] : [])]) {
      if (
        !media ||
        typeof media.uri !== 'string' ||
        typeof media.fileName !== 'string' ||
        typeof media.mimeType !== 'string' ||
        !['image', 'gif', 'video'].includes(media.kind)
      )
        return null;
      if (media.coverUri !== undefined && typeof media.coverUri !== 'string') return null;
      if (
        media.durationMs !== undefined &&
        (!Number.isFinite(media.durationMs) || media.durationMs <= 0 || media.durationMs > 120000)
      )
        return null;
      if (media.subtitles !== undefined) {
        if (!Array.isArray(media.subtitles) || media.subtitles.length > 100) return null;
        let previous = 0;
        for (const cue of media.subtitles) {
          if (
            !cue ||
            typeof cue.text !== 'string' ||
            !cue.text.trim() ||
            cue.text.length > 300 ||
            !Number.isFinite(cue.start) ||
            !Number.isFinite(cue.end) ||
            cue.start < previous ||
            cue.end <= cue.start ||
            cue.end > 120
          )
            return null;
          previous = cue.end;
        }
      }
    }
    const legacyDirectory = `${FileSystem.documentDirectory}drafts/${userId}/`;
    if (
      FileSystem.cacheDirectory &&
      [...items].some(
        (media) =>
          media.uri.startsWith(legacyDirectory) || media.coverUri?.startsWith(legacyDirectory),
      )
    ) {
      const migrated = await Promise.all(items.map((media) => retainDraftMedia(userId, media)));
      draft.mediaItems = migrated;
      draft.media = migrated[0];
      await saveDraft(userId, draft);
      await FileSystem.deleteAsync(legacyDirectory, { idempotent: true });
    }
    return draft as PostDraft;
  } catch {
    return null;
  }
}
export async function saveDraft(userId: string, draft: PostDraft) {
  await AsyncStorage.setItem(draftKey(userId), JSON.stringify(draft));
}
export async function retainDraftMedia(
  userId: string,
  media: NonNullable<CreatePostInput['media']>,
) {
  // Unpublished media stays out of device backups. The OS may reclaim cached files.
  const directory = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}drafts/${userId}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  if (media.uri.startsWith(directory) && (!media.coverUri || media.coverUri.startsWith(directory)))
    return media;
  const destination = `${directory}${Date.now()}-${media.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await FileSystem.copyAsync({ from: media.uri, to: destination });
  let coverUri = media.coverUri;
  if (coverUri) {
    const target = `${directory}${Date.now()}-cover.jpg`;
    await FileSystem.copyAsync({ from: coverUri, to: target });
    coverUri = target;
  }
  return { ...media, uri: destination, ...(coverUri ? { coverUri } : {}) };
}
// Demo posts keep their own media; clearing a composer must not delete published images.
export async function retainPublishedMedia(
  userId: string,
  media: NonNullable<CreatePostInput['media']>,
) {
  const directory = `${FileSystem.documentDirectory}demo-posts/${userId}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const uri = `${directory}${Date.now()}-${Math.random().toString(36).slice(2)}-${media.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await FileSystem.copyAsync({ from: media.uri, to: uri });
  let coverUri = media.coverUri;
  if (coverUri) {
    const target = uri + '-cover.jpg';
    await FileSystem.copyAsync({ from: coverUri, to: target });
    coverUri = target;
  }
  return { ...media, uri, coverUri };
}
export async function clearDraft(userId: string) {
  await AsyncStorage.removeItem(draftKey(userId));
  await FileSystem.deleteAsync(`${FileSystem.documentDirectory}drafts/${userId}/`, {
    idempotent: true,
  });
  if (FileSystem.cacheDirectory)
    await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}drafts/${userId}/`, {
      idempotent: true,
    });
}

export async function clearAccountDrafts(userId: string) {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(
    keys.filter(
      (key) =>
        key === draftKey(userId) ||
        key.startsWith(`circles:experience:${userId}:`) ||
        key.startsWith(`circles:comment-draft:${userId}:`) ||
        key.startsWith(`circles:message-draft:${userId}:`) ||
        key.startsWith(`circles:pending-gift:${userId}:`) ||
        key === 'circles:device-push-token',
    ),
  );
  await FileSystem.deleteAsync(`${FileSystem.documentDirectory}drafts/${userId}/`, {
    idempotent: true,
  });
  if (FileSystem.cacheDirectory)
    await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}drafts/${userId}/`, {
      idempotent: true,
    });
}
