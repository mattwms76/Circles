import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { createTRPCClient } from "@/lib/trpc";
import type { A26LiveMediaPhaseChange } from "@/lib/a26-live-media-state";
import type { LiveHostLease } from "./design31-live-ui";
import { StatusMessage } from "./status-message";

export type LiveMediaProps = {
  streamId: number;
  host: boolean;
  currentUserId: number | null;
  onError?: (message: string) => void;
  onReady?: (generation?: number) => void;
  onHostLease?: (lease: LiveHostLease) => void;
  onMediaPhaseChange?: (change: A26LiveMediaPhaseChange) => void;
};

/** Graceful fallback for an unsupported platform; web and native use platform files. */
export default function LiveMedia({
  streamId,
  host,
  onError,
  onMediaPhaseChange,
}: LiveMediaProps) {
  const message = "Live video is not supported on this platform.";
  const callbackRef = useRef({ onError, onMediaPhaseChange });
  const [client] = useState(createTRPCClient);

  useEffect(() => {
    callbackRef.current = { onError, onMediaPhaseChange };
  }, [onError, onMediaPhaseChange]);

  useEffect(() => {
    callbackRef.current.onMediaPhaseChange?.({
      phase: "joining",
      generation: null,
    });
    callbackRef.current.onMediaPhaseChange?.({
      phase: "error",
      generation: null,
      message,
    });
    callbackRef.current.onError?.(message);
    if (host) {
      // Even this fallback may only end the host lifecycle that it just joined;
      // it never treats an omitted generation as current authority.
      void client.live.join
        .mutate({ streamId })
        .then(({ generation }) =>
          client.live.end.mutate({ streamId, generation }),
        )
        .catch(() => undefined);
    }
    // Callback identities intentionally do not restart this lifecycle.
  }, [client, host, streamId]);

  return (
    <View style={styles.frame}>
      <View style={styles.statusBackplate}>
        <StatusMessage message={message} tone="error" style={styles.message} />
      </View>
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
  statusBackplate: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  message: { textAlign: "center" },
});
