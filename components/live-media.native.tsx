import Constants from "expo-constants";
import React, { useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { createTRPCClient } from "@/lib/trpc";

export type LiveMediaProps = {
  streamId: number;
  host: boolean;
  onError?: (message: string) => void;
  onReady?: () => void;
};

type SignalKind = "join" | "offer" | "answer" | "ice" | "leave";
type Signal = {
  id: number;
  fromId: number;
  toId: number | null;
  kind: SignalKind;
  payload: string;
};

type LiveApi = {
  live: {
    join: { mutate(input: { streamId: number }): Promise<{ hostId: number }> };
    leave: { mutate(input: { streamId: number }): Promise<{ success: true }> };
    end: { mutate(input: { streamId: number }): Promise<{ success: true }> };
    heartbeat: {
      mutate(input: {
        streamId: number;
        ready?: boolean;
      }): Promise<{ success: true }>;
    };
    signals: {
      query(input: { streamId: number; afterId?: number }): Promise<Signal[]>;
    };
    signal: {
      mutate(input: {
        streamId: number;
        toId: number;
        kind: "offer" | "answer" | "ice";
        payload: string;
      }): Promise<{ success: true }>;
    };
  };
};

type NativeDescription = { type: "offer" | "answer"; sdp: string };
type NativeCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  toJSON?: () => Record<string, unknown>;
};
type NativeTrack = { stop: () => void };
type NativeStream = {
  getTracks: () => NativeTrack[];
  toURL: () => string;
};
type NativePeer = {
  localDescription: NativeDescription | null;
  remoteDescription: NativeDescription | null;
  connectionState: string;
  onicecandidate:
    | ((event: { candidate: NativeCandidate | null }) => void)
    | null;
  ontrack: ((event: { streams: NativeStream[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  addTrack: (track: NativeTrack, stream: NativeStream) => void;
  createOffer: () => Promise<NativeDescription>;
  createAnswer: () => Promise<NativeDescription>;
  setLocalDescription: (description: NativeDescription) => Promise<void>;
  setRemoteDescription: (description: unknown) => Promise<void>;
  addIceCandidate: (candidate: unknown) => Promise<void>;
  close: () => void;
};
type RTCViewProps = {
  streamURL: string;
  style?: StyleProp<ViewStyle>;
  objectFit?: "contain" | "cover";
  mirror?: boolean;
};
type NativeWebRTC = {
  RTCPeerConnection: new (configuration: {
    iceServers: { urls: string }[];
  }) => NativePeer;
  RTCIceCandidate: new (candidate: NativeCandidate) => unknown;
  RTCSessionDescription: new (description: NativeDescription) => unknown;
  RTCView: React.ComponentType<RTCViewProps>;
  mediaDevices: {
    getUserMedia: (constraints: {
      audio: boolean;
      video: { facingMode: "user" };
    }) => Promise<NativeStream>;
  };
};

type PeerState = { connection: NativePeer; pendingIce: NativeCandidate[] };

const ICE_CONFIGURATION = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function messageFor(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Unable to connect to the live stream.";
}

function parseDescription(
  payload: string,
  type: "offer" | "answer",
): NativeDescription {
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid session description.");
  const description = value as Partial<NativeDescription>;
  if (description.type !== type || typeof description.sdp !== "string") {
    throw new Error("Invalid session description.");
  }
  return { type, sdp: description.sdp };
}

function parseCandidate(payload: string): NativeCandidate {
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid ICE candidate.");
  const candidate = value as Partial<NativeCandidate>;
  if (typeof candidate.candidate !== "string" || !candidate.candidate) {
    throw new Error("Invalid ICE candidate.");
  }
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? null,
    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
  };
}

/** Native RTC transport. Expo Go deliberately never loads the native module. */
export default function LiveMedia({
  streamId,
  host,
  onError,
  onReady,
}: LiveMediaProps) {
  const localStreamRef = useRef<NativeStream | null>(null);
  const peersRef = useRef<Map<number, PeerState>>(new Map());
  const callbackRef = useRef({ onError, onReady });
  const lifecycleRef = useRef(0);
  const clientRef = useRef<LiveApi | null>(null);
  const [RTCView, setRTCView] =
    useState<React.ComponentType<RTCViewProps> | null>(null);
  const [streamURL, setStreamURL] = useState<string | null>(null);
  const [status, setStatus] = useState(
    host ? "Preparing camera…" : "Joining live stream…",
  );

  if (!clientRef.current) {
    clientRef.current = createTRPCClient() as unknown as LiveApi;
  }

  useEffect(() => {
    callbackRef.current = { onError, onReady };
  }, [onError, onReady]);

  useEffect(() => {
    const api = clientRef.current;
    if (!api) return;

    const isExpoGo =
      Constants.appOwnership === "expo" ||
      Constants.executionEnvironment === "storeClient";
    if (isExpoGo) {
      const message =
        "Live video needs a development or release build; Expo Go cannot load react-native-webrtc.";
      setStatus(message);
      callbackRef.current.onError?.(message);
      if (host) void api.live.end.mutate({ streamId }).catch(() => undefined);
      return;
    }

    let webRtc: NativeWebRTC;
    try {
      // Requiring only after the Expo Go guard prevents an unlinked native module
      // from being evaluated by the stock Expo client.
      webRtc = require("react-native-webrtc") as NativeWebRTC;
      setRTCView(() => webRtc.RTCView);
    } catch {
      const message =
        "Live video native support is unavailable. Rebuild the app with the WebRTC config plugin.";
      setStatus(message);
      callbackRef.current.onError?.(message);
      if (host) void api.live.end.mutate({ streamId }).catch(() => undefined);
      return;
    }

    const lifecycle = ++lifecycleRef.current;
    let active = true;
    let joined = false;
    let polling = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let cursor = 0;
    let viewerMediaReady = false;

    const report = (error: unknown) => {
      const message = messageFor(error);
      if (active) setStatus(message);
      callbackRef.current.onError?.(message);
    };

    const closePeer = (participantId: number) => {
      const peer = peersRef.current.get(participantId);
      if (!peer) return;
      peer.connection.onicecandidate = null;
      peer.connection.ontrack = null;
      peer.connection.close();
      peersRef.current.delete(participantId);
    };

    const stopAllPeers = () => {
      for (const participantId of [...peersRef.current.keys()])
        closePeer(participantId);
    };

    const addQueuedIce = async (peer: PeerState) => {
      if (!peer.connection.remoteDescription) return;
      const pending = peer.pendingIce.splice(0);
      for (const candidate of pending) {
        await peer.connection.addIceCandidate(
          new webRtc.RTCIceCandidate(candidate),
        );
      }
    };

    const receiveIce = async (peer: PeerState, payload: string) => {
      const candidate = parseCandidate(payload);
      if (!peer.connection.remoteDescription) {
        peer.pendingIce.push(candidate);
        return;
      }
      await peer.connection.addIceCandidate(
        new webRtc.RTCIceCandidate(candidate),
      );
    };

    const signalIce = (participantId: number, candidate: NativeCandidate) => {
      const serialized = candidate.toJSON ? candidate.toJSON() : candidate;
      void api.live.signal
        .mutate({
          streamId,
          toId: participantId,
          kind: "ice",
          payload: JSON.stringify(serialized),
        })
        .catch(report);
    };

    const hostPeer = (viewerId: number): PeerState => {
      const existing = peersRef.current.get(viewerId);
      if (existing) return existing;
      const localStream = localStreamRef.current;
      if (!localStream) throw new Error("Camera and microphone are not ready.");

      const connection = new webRtc.RTCPeerConnection(ICE_CONFIGURATION);
      const peer: PeerState = { connection, pendingIce: [] };
      peersRef.current.set(viewerId, peer);
      localStream
        .getTracks()
        .forEach((track) => connection.addTrack(track, localStream));
      connection.onicecandidate = (event) => {
        if (active && event.candidate) signalIce(viewerId, event.candidate);
      };
      connection.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(connection.connectionState))
          closePeer(viewerId);
      };
      return peer;
    };

    const viewerPeer = (hostId: number): PeerState => {
      const existing = peersRef.current.get(hostId);
      if (existing) return existing;
      const connection = new webRtc.RTCPeerConnection(ICE_CONFIGURATION);
      const peer: PeerState = { connection, pendingIce: [] };
      peersRef.current.set(hostId, peer);
      connection.onicecandidate = (event) => {
        if (active && event.candidate) signalIce(hostId, event.candidate);
      };
      connection.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream || stream.getTracks().length === 0 || !active) return;
        if (!viewerMediaReady) {
          viewerMediaReady = true;
          setStreamURL(stream.toURL());
          setStatus("Live");
          callbackRef.current.onReady?.();
        }
      };
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === "failed" && active) {
          report(new Error("The live video connection failed."));
        }
      };
      return peer;
    };

    const handleSignal = async (signal: Signal) => {
      if (host) {
        if (signal.kind === "join") {
          const peer = hostPeer(signal.fromId);
          const offer = await peer.connection.createOffer();
          if (!active) return;
          await peer.connection.setLocalDescription(offer);
          if (!active || !peer.connection.localDescription) return;
          await api.live.signal.mutate({
            streamId,
            toId: signal.fromId,
            kind: "offer",
            payload: JSON.stringify(peer.connection.localDescription),
          });
          return;
        }
        if (signal.kind === "answer") {
          const peer = peersRef.current.get(signal.fromId);
          if (!peer) return;
          await peer.connection.setRemoteDescription(
            new webRtc.RTCSessionDescription(
              parseDescription(signal.payload, "answer"),
            ),
          );
          await addQueuedIce(peer);
          return;
        }
        if (signal.kind === "ice") {
          const peer = peersRef.current.get(signal.fromId);
          if (peer) await receiveIce(peer, signal.payload);
          return;
        }
        if (signal.kind === "leave") closePeer(signal.fromId);
        return;
      }

      if (signal.kind === "offer") {
        const peer = viewerPeer(signal.fromId);
        await peer.connection.setRemoteDescription(
          new webRtc.RTCSessionDescription(
            parseDescription(signal.payload, "offer"),
          ),
        );
        await addQueuedIce(peer);
        const answer = await peer.connection.createAnswer();
        if (!active) return;
        await peer.connection.setLocalDescription(answer);
        if (!active || !peer.connection.localDescription) return;
        await api.live.signal.mutate({
          streamId,
          toId: signal.fromId,
          kind: "answer",
          payload: JSON.stringify(peer.connection.localDescription),
        });
        return;
      }
      if (signal.kind === "ice")
        await receiveIce(viewerPeer(signal.fromId), signal.payload);
    };

    const poll = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        const signals = await api.live.signals.query({
          streamId,
          afterId: cursor,
        });
        for (const signal of signals) {
          if (!active) return;
          try {
            await handleSignal(signal);
          } catch (error) {
            report(error);
          }
          cursor = Math.max(cursor, signal.id);
        }
      } catch (error) {
        report(error);
      } finally {
        polling = false;
      }
    };

    const initialise = async () => {
      try {
        await api.live.join.mutate({ streamId });
        joined = true;
        if (!active) return;

        if (host) {
          const stream = await webRtc.mediaDevices.getUserMedia({
            audio: true,
            video: { facingMode: "user" },
          });
          if (!active) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          localStreamRef.current = stream;
          setStreamURL(stream.toURL());
          // The stream is discoverable only after a successful native capture
          // and a server-side ready heartbeat, never merely after create().
          await api.live.heartbeat.mutate({ streamId, ready: true });
          if (!active) return;
          setStatus("Live");
          callbackRef.current.onReady?.();
        } else {
          setStatus("Waiting for host video…");
        }

        await poll();
        if (active) pollTimer = setInterval(() => void poll(), 900);
        if (active) {
          heartbeatTimer = setInterval(() => {
            void api.live.heartbeat.mutate({ streamId }).catch(report);
          }, 5_000);
        }
      } catch (error) {
        report(error);
        if (host) {
          void api.live.end.mutate({ streamId }).catch(() => undefined);
        }
      }
    };

    const initialisePromise = initialise();
    return () => {
      active = false;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      stopAllPeers();
      const localStream = localStreamRef.current;
      localStreamRef.current = null;
      localStream?.getTracks().forEach((track) => track.stop());
      setStreamURL(null);

      if (!host) {
        void initialisePromise.then(async () => {
          if (joined && lifecycleRef.current === lifecycle) {
            await api.live.leave.mutate({ streamId }).catch(() => undefined);
          }
        });
      } else {
        // A new strict-mode setup increments the lifecycle before this deferred
        // task executes. A real unmount still ends if camera startup is pending.
        setTimeout(() => {
          if (lifecycleRef.current === lifecycle) {
            void api.live.end.mutate({ streamId }).catch(() => undefined);
          }
        }, 0);
      }
    };
  }, [host, streamId]);

  return (
    <View>
      <View style={styles.frame}>
        {RTCView && streamURL ? (
          <RTCView
            streamURL={streamURL}
            style={styles.video}
            objectFit="cover"
            mirror={host}
          />
        ) : null}
        {status !== "Live" ? (
          <View style={styles.overlay}>
            <Text style={styles.status}>{status}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.networkNote}>
        <Text style={styles.networkNoteText}>
          Some networks need a TURN relay for reliable video.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    aspectRatio: 16 / 9,
    overflow: "hidden",
    borderRadius: 12,
    backgroundColor: "#0a0a0a",
  },
  video: { width: "100%", height: "100%" },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  status: { color: "#fff", textAlign: "center" },
  networkNote: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
  },
  networkNoteText: { color: "#F9F8F5", fontSize: 12, lineHeight: 18 },
});
