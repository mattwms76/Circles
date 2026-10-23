import React, { useEffect, useMemo, useState } from "react";
import { Image as ExpoImage, type ImageProps } from "expo-image";
import { Platform } from "react-native";
import { getApiBaseUrl, getApiRequestUrl } from "@/constants/oauth";
import { getSessionToken } from "@/lib/_core/auth";
import { useCircles } from "@/hooks/circles-context-core";
import {
  nativeMediaRequestKey,
  nativeMediaTokenForRequest,
  type NativeMediaTokenState,
} from "@/lib/media-cache";
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
  const resolvedUri = resolveMediaUrl(uri);
  const requiresNativeAuthorization = requiresNativeMediaAuthorization(
    uri,
    Platform.OS === "web",
  );
  const requestKey = nativeMediaRequestKey(user?.id, resolvedUri);
  const [tokenState, setTokenState] = useState<NativeMediaTokenState>({
    requestKey: "",
    settled: false,
    token: null,
  });
  useEffect(() => {
    if (!requiresNativeAuthorization) return;
    let active = true;
    void getSessionToken().then(
      (value) => {
        if (active) setTokenState({ requestKey, settled: true, token: value });
      },
      () => {
        if (active) setTokenState({ requestKey, settled: true, token: null });
      },
    );
    return () => {
      active = false;
    };
  }, [requestKey, requiresNativeAuthorization]);
  return useMemo(() => {
    if (requiresNativeAuthorization) {
      const token = nativeMediaTokenForRequest(tokenState, requestKey);
      // Returning null keeps Expo Image/Video idle rather than prefetching the
      // authenticated proxy URI without a bearer or with a stale account's one.
      if (!token) return null;
      return {
        uri: resolvedUri,
        headers: { Authorization: `Bearer ${token}` },
      };
    }
    return { uri: resolvedUri };
  }, [requestKey, requiresNativeAuthorization, resolvedUri, tokenState]);
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
    source = resolved ? { ...original, ...resolved } : null;
  return <ExpoImage {...props} source={source} />;
}
