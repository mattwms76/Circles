import type { ImagePickerAsset } from "expo-image-picker";

export type SupportedMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "video/mp4";
export function supportedMime(asset: ImagePickerAsset): SupportedMime {
  const mime =
    asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
  if (
    mime !== "image/jpeg" &&
    mime !== "image/png" &&
    mime !== "image/webp" &&
    mime !== "video/mp4"
  ) {
    throw new Error(
      "Choose a JPEG, PNG, WebP photo or MP4 video. Other formats aren’t supported yet.",
    );
  }
  if (asset.fileSize && asset.fileSize > 20 * 1024 * 1024)
    throw new Error("Keep your photo or video under 20 MB.");
  return mime;
}
export async function assetBase64(asset: ImagePickerAsset): Promise<string> {
  supportedMime(asset);
  if (asset.base64) return asset.base64;
  const response = await fetch(asset.uri);
  const blob = await response.blob();
  if (blob.size > 20 * 1024 * 1024)
    throw new Error("Keep your photo or video under 20 MB.");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("This media file could not be read."));
    reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
}
