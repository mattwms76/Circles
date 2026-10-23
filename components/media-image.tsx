import React, { useEffect, useMemo, useState } from "react";
import { Image as ExpoImage, type ImageProps } from "expo-image";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { getApiBaseUrl, getApiRequestUrl } from "@/constants/oauth";
import { getSessionToken } from "@/lib/_core/auth";
import { useCircles } from "@/hooks/circles-context-core";
import {
  mediaArrayAuthorizationUri,
  mediaFallbackIdentity,
  resolveMediaSourceArray,
} from "@/lib/media-fallback";
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

export type MediaImageProps = ImageProps & { fallback?: React.ReactNode };

function sourceUri(source: ImageProps["source"]): string {
  if (typeof source === "string") return source;
  if (
    source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    "uri" in source
  ) {
    const uri = (source as { uri?: unknown }).uri;
    return typeof uri === "string" ? uri : "";
  }
  return "";
}

export function Image({
  source: original,
  onError,
  style,
  fallback,
  ...props
}: MediaImageProps) {
  const { user } = useCircles();
  const uri = Array.isArray(original)
    ? mediaArrayAuthorizationUri(original, Platform.OS === "web")
    : sourceUri(original);
  const resolved = useMediaSource(uri);
  const fallbackIdentity = mediaFallbackIdentity({
    accountId: user?.id,
    source: original,
    resolvedUri: uri ? resolveMediaUrl(uri) : "",
  });

  let source: ImageProps["source"] = original;
  if (typeof original === "string") source = resolved;
  else if (Array.isArray(original))
    source = resolveMediaSourceArray(original, resolved, {
      isWeb: Platform.OS === "web",
      resolveUri: resolveMediaUrl,
    }) as ImageProps["source"];
  else if (
    original &&
    typeof original === "object" &&
    !Array.isArray(original) &&
    "uri" in original &&
    original.uri
  )
    source = resolved ? { ...original, ...resolved } : null;

  return (
    <ImageRenderer
      key={fallbackIdentity}
      {...props}
      source={source}
      onError={onError}
      style={style}
      fallback={fallback}
    />
  );
}

function ImageRenderer({
  source,
  onError,
  style,
  fallback,
  ...props
}: MediaImageProps) {
  const [failed, setFailed] = useState(false);
  const handleError: NonNullable<ImageProps["onError"]> = (event) => {
    try {
      onError?.(event);
    } finally {
      setFailed(true);
    }
  };

  // A protected native request deliberately receives source=null until this
  // account's bearer resolves. Do not replace that idle state with an
  // unauthenticated URI or a prior account's error fallback.
  if (failed && source !== null) {
    return (
      <View
        accessible={props.accessible}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityHint={props.accessibilityHint}
        accessibilityRole={props.accessibilityRole}
        accessibilityState={props.accessibilityState}
        accessibilityValue={props.accessibilityValue}
        importantForAccessibility={props.importantForAccessibility}
        nativeID={props.nativeID}
        testID={props.testID}
        style={[styles.fallback, style as unknown as ViewStyle]}
      >
        {fallback ?? <View style={styles.neutralFallback} />}
      </View>
    );
  }

  return (
    <ExpoImage {...props} source={source} onError={handleError} style={style} />
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: "#E8E9E2",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  neutralFallback: {
    width: "38%",
    height: "38%",
    borderRadius: 999,
    backgroundColor: "#D4D8CE",
  },
});
