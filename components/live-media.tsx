import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { createTRPCClient } from "@/lib/trpc";

export type LiveMediaProps = {
  streamId: number;
  host: boolean;
  onError?: (message: string) => void;
  onReady?: () => void;
};

/** Graceful fallback for an unsupported platform; web and native use platform files. */
export default function LiveMedia({ streamId, host, onError }: LiveMediaProps) {
  const message = "Live video is not supported on this platform.";
  const callbackRef = useRef({ onError });
  const clientRef = useRef<{
    live: { end: { mutate(input: { streamId: number }): Promise<unknown> } };
  } | null>(null);

  if (!clientRef.current) {
    clientRef.current = createTRPCClient() as unknown as NonNullable<
      typeof clientRef.current
    >;
  }

  useEffect(() => {
    callbackRef.current = { onError };
  }, [onError]);

  useEffect(() => {
    callbackRef.current.onError?.(message);
    if (host) {
      void clientRef.current?.live.end
        .mutate({ streamId })
        .catch(() => undefined);
    }
    // Callback identities intentionally do not restart this lifecycle.
  }, [host, streamId]);

  return (
    <View style={styles.frame} accessibilityRole="alert">
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    aspectRatio: 16 / 9,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#161616",
  },
  message: { color: "#fff", textAlign: "center" },
});
