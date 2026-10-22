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
import { hostGenerationFromRestartSignal } from "@/shared/live-generation-restart";
import { terminateLiveTransportForError } from "./live-media-terminal";

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
    join: {
      mutate(input: { streamId: number }): Promise<{
        hostId: number;
        generation: number;
        hostGeneration: number;
        signalCursor: number;
      }>;
    };
    leave: { mutate(input: { streamId: number }): Promise<{ success: true }> };
    end: { mutate(input: { streamId: number }): Promise<{ success: true }> };
    heartbeat: {
      mutate(input: {
        streamId: number;
        ready?: boolean;
      }): Promise<{ success: true }>;
    };
    signals: {
      query(input: {
        streamId: number;
        generation: number;
        afterId?: number;
      }): Promise<Signal[]>;
    };
    signal: {
      mutate(input: {
        streamId: number;
        toId: number;
        kind: "offer" | "answer" | "ice";
        generation: number;
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

function isNativeWebRTC(value: unknown): value is NativeWebRTC {
  if (!value || typeof value !== "object") return false;
  const mediaDevices = Reflect.get(value, "mediaDevices");
  return (
    typeof Reflect.get(value, "RTCPeerConnection") === "function" &&
    typeof Reflect.get(value, "RTCIceCandidate") === "function" &&
    typeof Reflect.get(value, "RTCSessionDescription") === "function" &&
    typeof Reflect.get(value, "RTCView") === "function" &&
    !!mediaDevices &&
    typeof mediaDevices === "object" &&
    typeof Reflect.get(mediaDevices, "getUserMedia") === "function"
  );
}

type LifecycleCoordinator = {
  begin: () => symbol;
  isCurrent: (token: symbol) => boolean;
  complete: (token: symbol) => void;
};

/**
 * Coordinates an asynchronous setup/teardown pair without reading a React ref
 * during render. A replacement effect adopts the active live membership before
 * a previous setup has settled (including React strict-mode effect replay).
 */
function createLifecycleCoordinator(): LifecycleCoordinator {
  let current: symbol | null = null;
  return {
    begin: () => {
      const token = Symbol("live-media-lifecycle");
      current = token;
      return token;
    },
    isCurrent: (token) => current === token,
    complete: (token) => {
      if (current === token) current = null;
    },
  };
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
  const [api] = useState<LiveApi>(
    () => createTRPCClient() as unknown as LiveApi,
  );
  const [lifecycle] = useState(createLifecycleCoordinator);
  const [RTCView, setRTCView] =
    useState<React.ComponentType<RTCViewProps> | null>(null);
  const [streamURL, setStreamURL] = useState<string | null>(null);
  const [status, setStatus] = useState(
    host ? "Preparing camera…" : "Joining live stream…",
  );
  const expoGoMessage =
    Constants.appOwnership === "expo" ||
    Constants.executionEnvironment === "storeClient"
      ? "Live video needs a development or release build; Expo Go cannot load react-native-webrtc."
      : null;
  const displayedStatus = expoGoMessage ?? status;

  useEffect(() => {
    callbackRef.current = { onError, onReady };
  }, [onError, onReady]);

  useEffect(() => {
    if (expoGoMessage) {
      callbackRef.current.onError?.(expoGoMessage);
      if (host) void api.live.end.mutate({ streamId }).catch(() => undefined);
      return;
    }

    let webRtc: NativeWebRTC;
    const lifecycleToken = lifecycle.begin();
    let active = true;
    let joined = false;
    let nativeModuleUnavailable = false;
    let polling = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let cursor = 0;
    let generation: number | null = null;
    let hostId: number | null = null;
    let hostGeneration: number | null = null;
    let viewerRestarting = false;
    let viewerMediaReady = false;
    let terminal = false;

    const report = (error: unknown) => {
      if (terminateLiveTransportForError(error, terminate)) return;
      const message = messageFor(error);
      if (active) setStatus(message);
      callbackRef.current.onError?.(message);
    };

    const closePeer = (participantId: number) => {
      const peer = peersRef.current.get(participantId);
      if (!peer) return;
      peer.connection.onicecandidate = null;
      peer.connection.ontrack = null;
      peer.connection.onconnectionstatechange = null;
      peer.connection.close();
      peersRef.current.delete(participantId);
    };

    const stopAllPeers = () => {
      for (const participantId of [...peersRef.current.keys()])
        closePeer(participantId);
    };

    const stopTransport = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      stopAllPeers();
      const localStream = localStreamRef.current;
      localStreamRef.current = null;
      localStream?.getTracks().forEach((track) => track.stop());
      setStreamURL(null);
    };

    const terminate = (state: { message: string }) => {
      if (terminal) return;
      terminal = true;
      active = false;
      stopTransport();
      setStatus(state.message);
      callbackRef.current.onError?.(state.message);
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

    const requireGeneration = (): number => {
      if (generation === null)
        throw new Error("Live media session is not ready.");
      return generation;
    };

    const signalIce = (participantId: number, candidate: NativeCandidate) => {
      if (!active || generation === null) return;
      const serialized = candidate.toJSON ? candidate.toJSON() : candidate;
      void api.live.signal
        .mutate({
          streamId,
          toId: participantId,
          kind: "ice",
          generation,
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

    /**
     * Server resets are recoverable: close the old direct peer and replace the
     * viewer media lifecycle with exactly one fresh, generation-bound join.
     */
    const restartViewer = async (
      restartedHostId: number,
      restartedHostGeneration: number,
    ) => {
      if (
        host ||
        !active ||
        viewerRestarting ||
        (hostGeneration !== null && restartedHostGeneration <= hostGeneration)
      ) {
        return;
      }
      viewerRestarting = true;
      closePeer(restartedHostId);
      viewerMediaReady = false;
      setStreamURL(null);
      setStatus("Rejoining live stream…");
      try {
        const session = await api.live.join.mutate({ streamId });
        if (!active) return;
        generation = session.generation;
        hostId = session.hostId;
        hostGeneration = session.hostGeneration;
        cursor = session.signalCursor;
      } catch (error) {
        report(error);
      } finally {
        viewerRestarting = false;
      }
    };

    const handleSignal = async (signal: Signal) => {
      if (!host && hostId !== null) {
        const restartedHostGeneration = hostGenerationFromRestartSignal({
          kind: signal.kind,
          fromId: signal.fromId,
          expectedHostId: hostId,
          payload: signal.payload,
        });
        if (restartedHostGeneration !== null) {
          await restartViewer(hostId, restartedHostGeneration);
          return;
        }
      }

      if (host) {
        if (signal.kind === "join") {
          const peer = hostPeer(signal.fromId);
          const offer = await peer.connection.createOffer();
          if (!active) return;
          await peer.connection.setLocalDescription(offer);
          if (!active || !peer.connection.localDescription) return;
          try {
            await api.live.signal.mutate({
              streamId,
              toId: signal.fromId,
              kind: "offer",
              generation: requireGeneration(),
              payload: JSON.stringify(peer.connection.localDescription),
            });
          } catch (error) {
            closePeer(signal.fromId);
            throw error;
          }
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
          generation: requireGeneration(),
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
          generation: requireGeneration(),
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
        const session = await api.live.join.mutate({ streamId });
        generation = session.generation;
        hostId = session.hostId;
        hostGeneration = session.hostGeneration;
        cursor = session.signalCursor;
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
        if (host && !terminal) {
          void api.live.end.mutate({ streamId }).catch(() => undefined);
        }
      }
    };

    const initialisePromise = (async () => {
      try {
        // Dynamic loading remains behind the Expo Go guard, so the stock Expo
        // client never evaluates an unlinked react-native-webrtc module.
        const nativeModule: unknown = await import("react-native-webrtc");
        if (!isNativeWebRTC(nativeModule)) {
          throw new Error("The native WebRTC module is incomplete.");
        }
        webRtc = nativeModule;
        if (!active) return;
        setRTCView(() => webRtc.RTCView);
        await initialise();
      } catch {
        if (!active) return;
        nativeModuleUnavailable = true;
        const message =
          "Live video native support is unavailable. Rebuild the app with the WebRTC config plugin.";
        setStatus(message);
        callbackRef.current.onError?.(message);
        if (host) void api.live.end.mutate({ streamId }).catch(() => undefined);
      }
    })();
    return () => {
      active = false;
      stopTransport();

      // Setup must settle before a joined viewer can leave. If another effect
      // took over meanwhile, it owns the membership and no stale cleanup can
      // terminate the replacement session.
      void initialisePromise.then(async () => {
        if (!lifecycle.isCurrent(lifecycleToken)) return;
        if (terminal || nativeModuleUnavailable) {
          lifecycle.complete(lifecycleToken);
        } else if (!host && joined) {
          await api.live.leave.mutate({ streamId }).catch(() => undefined);
        } else if (host) {
          await api.live.end.mutate({ streamId }).catch(() => undefined);
        }
        lifecycle.complete(lifecycleToken);
      });
    };
  }, [api, expoGoMessage, host, lifecycle, streamId]);

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
        {displayedStatus !== "Live" ? (
          <View style={styles.overlay}>
            <Text style={styles.status}>{displayedStatus}</Text>
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
