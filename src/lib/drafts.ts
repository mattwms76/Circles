import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import type { CreatePostInput } from "../types";
export interface PostDraft {
  body: string;
  circleId: string;
  media?: CreatePostInput["media"];
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
      typeof draft.body !== "string" ||
      draft.body.length > 5000 ||
      typeof draft.circleId !== "string" ||
      typeof draft.requestId !== "string" ||
      !draft.requestId ||
      draft.requestId.length > 128
    )
      return null;
    const media = draft.media;
    if (
      media &&
      (typeof media.uri !== "string" ||
        typeof media.fileName !== "string" ||
        typeof media.mimeType !== "string" ||
        !["image", "gif", "video"].includes(media.kind))
    )
      return null;
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
  media: NonNullable<CreatePostInput["media"]>,
) {
  const directory = `${FileSystem.documentDirectory}drafts/${userId}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const destination = `${directory}${Date.now()}-${media.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await FileSystem.copyAsync({ from: media.uri, to: destination });
  return { ...media, uri: destination };
}
// Demo posts keep their own media; clearing a composer must not delete published images.
export async function retainPublishedMedia(
  userId: string,
  media: NonNullable<CreatePostInput["media"]>,
) {
  const directory = `${FileSystem.documentDirectory}demo-posts/${userId}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const uri = `${directory}${Date.now()}-${Math.random().toString(36).slice(2)}-${media.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await FileSystem.copyAsync({ from: media.uri, to: uri });
  return { ...media, uri };
}
export async function clearDraft(userId: string) {
  await AsyncStorage.removeItem(draftKey(userId));
  await FileSystem.deleteAsync(
    `${FileSystem.documentDirectory}drafts/${userId}/`,
    { idempotent: true },
  );
}

export async function clearAccountDrafts(userId: string) {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(
    keys.filter(
      (key) =>
        key === draftKey(userId) ||
        key.startsWith(`circles:message-draft:${userId}:`) ||
        key.startsWith(`circles:pending-gift:${userId}:`) ||
        key === "circles:device-push-token",
    ),
  );
  await FileSystem.deleteAsync(
    `${FileSystem.documentDirectory}drafts/${userId}/`,
    { idempotent: true },
  );
}
