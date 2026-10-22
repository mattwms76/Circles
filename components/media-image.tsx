import React, { useEffect, useMemo, useState } from "react";
import { Image as ExpoImage, type ImageProps } from "expo-image";
import { Platform } from "react-native";
import { getApiBaseUrl, getApiRequestUrl } from "@/constants/oauth";
import { getSessionToken } from "@/lib/_core/auth";
import { useCircles } from "@/hooks/circles-context";
import {
  requiresNativeMediaAuthorization,
  resolveMediaUrlForRenderer,
} from "@/shared/media";

export function resolveMediaUrl(uri: string): string {
  return resolveMediaUrlForRenderer(uri, {
    isWeb: Platform.OS === "web",
    apiBaseUrl: getApiBaseUrl(),
    apiRequestUrl: getApiRequestUrl,
  });
}
export function useMediaSource(uri: string) {
  const { user } = useCircles();
  const [token, setToken] = useState<string | null>(null);
  const requiresNativeAuthorization = requiresNativeMediaAuthorization(uri, Platform.OS === "web");
  useEffect(() => {
    if (!requiresNativeAuthorization) return;
    let active = true;
    void getSessionToken().then((value) => {
      if (active) setToken(value);
    });
    return () => {
      active = false;
    };
  }, [requiresNativeAuthorization, user?.id]);
  return useMemo(
    () => ({
      uri: resolveMediaUrl(uri),
      ...(token && requiresNativeAuthorization
        ? { headers: { Authorization: `Bearer ${token}` } }
        : {}),
    }),
    [uri, token, requiresNativeAuthorization],
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
