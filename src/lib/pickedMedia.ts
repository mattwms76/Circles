import * as FileSystem from 'expo-file-system/legacy';
import type { ImagePickerAsset } from 'expo-image-picker';

/** Validate the actual local recording, not only optional picker metadata. */
export async function inspectPickedMedia(
  asset: ImagePickerAsset,
  kind: 'image' | 'gif' | 'video',
  maxSeconds: number,
) {
  const info = await FileSystem.getInfoAsync(asset.uri);
  if (!info.exists || info.isDirectory || !Number.isFinite(info.size) || info.size <= 0)
    throw new Error(
      'The recording or attachment is unavailable. Please choose or record it again.',
    );
  const size = Math.max(info.size, asset.fileSize ?? 0);
  if (size > 25 * 1024 * 1024)
    throw new Error('File is too large. Choose media smaller than 25 MB.');
  const name = (asset.fileName || asset.uri.split('?')[0]).toLowerCase();
  const extension = name.split('.').pop();
  const types: Record<string, string> = {
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  const mimeType = asset.mimeType || types[extension ?? ''];
  if (kind === 'video') {
    if (!mimeType || !['video/mp4', 'video/quicktime', 'video/webm'].includes(mimeType))
      throw new Error('Choose an MP4, MOV or WebM video.');
    if (!Number.isFinite(asset.duration) || asset.duration! <= 0)
      throw new Error('Video duration could not be read. Please record or choose the video again.');
    if (asset.duration! > maxSeconds * 1000)
      throw new Error(`Choose a video that is ${maxSeconds} seconds or shorter.`);
  }
  return {
    size,
    mimeType: mimeType || 'image/jpeg',
    duration: asset.duration == null ? undefined : asset.duration / 1000,
  };
}
