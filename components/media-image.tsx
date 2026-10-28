import { controlAccessibilityProps } from "../lib/control-accessibility";
import React, { useEffect, useMemo, useState } from "react";
import { Image as ExpoImage, type ImageProps } from "expo-image";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
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

export type MediaImageProps = ImageProps & {
  /** Rendered for a safe native-bearer wait and for generic image failures. */
  fallback?: React.ReactNode;
  /** A visible, truthful failure state for attachment callers. */
  unavailableLabel?: string;
  /** Lets consumers use the shared announced-status component inside a failure. */
  unavailableContent?: React.ReactNode;
  /** Optional caller cleanup when the user begins the single allowed retry. */
  onRetry?: () => void;
  retryLabel?: string;
};

export function MediaPlaceholder({
  label,
  style,
  children,
  onRetry,
  retryLabel = "Retry attachment",
  testID,
}: {
  label: string;
  style?: ImageProps["style"];
  children?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  testID?: string;
}) {
  const canRetry = !!onRetry;
  const exposeContainer = !children && !canRetry;
  return (
    <View
      accessible={exposeContainer}
      accessibilityRole={exposeContainer ? "image" : undefined}
      accessibilityLabel={exposeContainer ? label : undefined}
      testID={testID}
      style={[styles.fallback, style as unknown as ViewStyle]}
    >
      {children ?? <View style={styles.neutralFallback} />}
      {onRetry && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={onRetry}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

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
  unavailableLabel,
  unavailableContent,
  onRetry,
  retryLabel,
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
      unavailableLabel={unavailableLabel}
      unavailableContent={unavailableContent}
      onRetry={onRetry}
      retryLabel={retryLabel}
    />
  );
}

function ImageRenderer({
  source,
  onError,
  style,
  fallback,
  unavailableLabel,
  unavailableContent,
  onRetry,
  retryLabel,
  ...props
}: MediaImageProps) {
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const handleError: NonNullable<ImageProps["onError"]> = (event) => {
    try {
      onError?.(event);
    } finally {
      setFailed(true);
    }
  };
  const retry = () => {
    if (retryCount > 0) return;
    setRetryCount(1);
    setFailed(false);
    onRetry?.();
  };

  // A protected native request deliberately receives source=null until this
  // account's bearer resolves. Do not replace that idle state with an
  // unauthenticated URI or a prior account's error fallback.
  if (source === null) {
    return (
      <View
        accessible={props.accessible}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityHint={props.accessibilityHint}
        accessibilityRole={props.accessibilityRole}
        {...controlAccessibilityProps(props.accessibilityState)}
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

  if (failed && source !== null) {
    if (unavailableLabel) {
      return (
        <MediaPlaceholder
          label={unavailableLabel}
          style={style}
          testID={props.testID}
          retryLabel={retryLabel ?? `Retry ${unavailableLabel.toLowerCase()}`}
          onRetry={retryCount === 0 ? retry : undefined}
        >
          {unavailableContent ?? (
            <Text style={styles.unavailableText}>{unavailableLabel}</Text>
          )}
        </MediaPlaceholder>
      );
    }
    return (
      <View
        accessible={props.accessible}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityHint={props.accessibilityHint}
        accessibilityRole={props.accessibilityRole}
        {...controlAccessibilityProps(props.accessibilityState)}
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
    <ExpoImage
      key={retryCount}
      {...props}
      source={source}
      onError={handleError}
      style={style}
    />
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
  unavailableText: {
    color: "#4D5948",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 16,
  },
  retry: {
    minHeight: 44,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#4D5948",
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    color: "#4D5948",
    fontSize: 14,
    fontWeight: "700",
  },
});
