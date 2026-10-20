import React, { useEffect, useMemo, useState } from "react";
import { Image as ExpoImage, type ImageProps } from "expo-image";
import { Platform } from "react-native";
import { getApiBaseUrl, getApiRequestUrl } from "@/constants/oauth";
import { getSessionToken } from "@/lib/_core/auth";
import { useCircles } from "@/hooks/circles-context";

export function resolveMediaUrl(uri: string): string {
  if (uri.startsWith("/manus-storage/social-encrypted/")) {
    return getApiRequestUrl(
      `/api/media/${uri.slice("/manus-storage/".length)}`,
    );
  }
  // Ordinary managed web assets are resolved by the stable Preview gateway.
  return Platform.OS !== "web" && uri.startsWith("/manus-storage/")
    ? `${getApiBaseUrl()}${uri}`
    : uri;
}
export function useMediaSource(uri: string) {
  const { user } = useCircles();
  const [token, setToken] = useState<string | null>(null);
  const encrypted = uri.startsWith("/manus-storage/social-encrypted/");
  useEffect(() => {
    let active = true;
    if (Platform.OS !== "web" && encrypted) {
      void getSessionToken().then((value) => {
        if (active) setToken(value);
      });
    } else setToken(null);
    return () => {
      active = false;
    };
  }, [encrypted, user?.id]);
  return useMemo(
    () => ({
      uri: resolveMediaUrl(uri),
      ...(token && encrypted
        ? { headers: { Authorization: `Bearer ${token}` } }
        : {}),
    }),
    [uri, token, encrypted],
  );
}
export function Image(props: ImageProps) {
  const original = props.source;
  const uri =
    typeof original === "string"
      ? original
      : original &&
          typeof original === "object" &&
          !Array.isArray(original) &&
          "uri" in original
        ? original.uri || ""
        : "";
  const resolved = useMediaSource(uri);
  let source = original;
  if (typeof original === "string") source = resolved;
  else if (
    original &&
    typeof original === "object" &&
    !Array.isArray(original) &&
    "uri" in original &&
    original.uri
  )
    source = { ...original, ...resolved };
  return <ExpoImage {...props} source={source} />;
}
