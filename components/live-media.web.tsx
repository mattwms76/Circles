import React, { useEffect, useRef, useState } from "react";
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

type PeerState = {
  connection: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
};

type DeferredTeardown = {
  streamId: number;
  host: boolean;
  controller: AbortController;
};

const ICE_CONFIGURATION: RTCConfiguration = {
  // This public STUN server enables direct candidate discovery. A production
  // TURN relay must be supplied separately for restrictive NAT/firewall paths.
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
): RTCSessionDescriptionInit {
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid session description.");
  const description = value as RTCSessionDescriptionInit;
  if (description.type !== type || typeof description.sdp !== "string") {
    throw new Error("Invalid session description.");
  }
  return description;
}

function parseCandidate(payload: string): RTCIceCandidateInit {
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid ICE candidate.");
  const candidate = value as RTCIceCandidateInit;
  if (typeof candidate.candidate !== "string" || !candidate.candidate) {
    throw new Error("Invalid ICE candidate.");
  }
  return candidate;
}

/** Actual browser WebRTC transport. Signaling is authenticated tRPC polling. */
export default function LiveMedia({
  streamId,
  host,
  onError,
  onReady,
}: LiveMediaProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<number, PeerState>>(new Map());
  const callbackRef = useRef({ onError, onReady });
  const deferredTeardownRef = useRef<DeferredTeardown | null>(null);
  const [api] = useState(createTRPCClient);
  const [status, setStatus] = useState(
    host ? "Preparing camera…" : "Joining live stream…",
  );

  useEffect(() => {
    callbackRef.current = { onError, onReady };
  }, [onError, onReady]);

  useEffect(() => {
    const previousTeardown = deferredTeardownRef.current;
    if (
      previousTeardown?.streamId === streamId &&
      previousTeardown.host === host
    ) {
      previousTeardown.controller.abort();
    }
    const teardownController = new AbortController();
    deferredTeardownRef.current = {
      streamId,
      host,
      controller: teardownController,
    };
    const localVideo = localVideoRef.current;
    const remoteVideo = remoteVideoRef.current;
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
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };

    const receiveIce = async (peer: PeerState, payload: string) => {
      const candidate = parseCandidate(payload);
      if (!peer.connection.remoteDescription) {
        peer.pendingIce.push(candidate);
        return;
      }
      await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
    };

    const signalIce = (participantId: number, candidate: RTCIceCandidate) => {
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

    const hostPeer = async (viewerId: number): Promise<PeerState> => {
      const existing = peersRef.current.get(viewerId);
      if (existing) return existing;
      const localStream = localStreamRef.current;
      if (!localStream) throw new Error("Camera and microphone are not ready.");

      const connection = new RTCPeerConnection(ICE_CONFIGURATION);
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

      const connection = new RTCPeerConnection(ICE_CONFIGURATION);
      const peer: PeerState = { connection, pendingIce: [] };
      peersRef.current.set(hostId, peer);
      connection.onicecandidate = (event) => {
        if (active && event.candidate) signalIce(hostId, event.candidate);
      };
      connection.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream || !event.track) return;
        if (remoteVideo) {
          remoteVideo.srcObject = stream;
          void remoteVideo.play().catch(() => undefined);
        }
        if (active && !viewerMediaReady) {
          viewerMediaReady = true;
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
          const peer = await hostPeer(signal.fromId);
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
            parseDescription(signal.payload, "answer"),
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
          parseDescription(signal.payload, "offer"),
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
      if (signal.kind === "ice") {
        await receiveIce(viewerPeer(signal.fromId), signal.payload);
      }
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
          // Advance even for a bad historic signal so polling cannot deadlock.
          cursor = Math.max(cursor, signal.id);
        }
      } catch (error) {
        report(error);
      } finally {
        polling = false;
      }
    };

    let hostedStreamEnded = false;
    const endHostedStream = () => {
      if (hostedStreamEnded) return;
      hostedStreamEnded = true;
      void api.live.end.mutate({ streamId }).catch(() => undefined);
    };

    const initialise = async () => {
      try {
        await api.live.join.mutate({ streamId });
        joined = true;
        if (!active) return;

        if (host) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: { facingMode: "user" },
          });
          if (!active) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          localStreamRef.current = stream;
          if (localVideo) {
            localVideo.srcObject = stream;
            void localVideo.play().catch(() => undefined);
          }
          // Do not expose this stream to viewers until camera capture has really
          // completed and the server has accepted the host heartbeat.
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
        if (host && !teardownController.signal.aborted) {
          endHostedStream();
        }
      }
    };

    const initialisePromise = initialise();
    const onPageHide = () => {
      if (host) endHostedStream();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", onPageHide);
    }
    return () => {
      active = false;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
      }
      stopAllPeers();
      const localStream = localStreamRef.current;
      localStreamRef.current = null;
      localStream?.getTracks().forEach((track) => track.stop());
      if (localVideo) localVideo.srcObject = null;
      if (remoteVideo) remoteVideo.srcObject = null;

      // Wait for an in-flight join before leaving. A matching Strict Mode replay
      // aborts this effect-owned teardown during its next setup; a true unmount
      // or stream change still releases the membership after join settles.
      if (!host) {
        void initialisePromise.then(async () => {
          if (joined && !teardownController.signal.aborted) {
            await api.live.leave.mutate({ streamId }).catch(() => undefined);
          }
        });
      } else {
        void initialisePromise.then(() => {
          if (!teardownController.signal.aborted) endHostedStream();
        });
      }
    };
  }, [api, host, streamId]);

  return (
    <div>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          overflow: "hidden",
          background: "#0a0a0a",
          borderRadius: 12,
        }}
      >
        {host ? (
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scaleX(-1)",
            }}
          />
        ) : (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            controls
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
        {status !== "Live" && (
          <div
            role="status"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 16,
              color: "#fff",
              background: "rgba(0, 0, 0, 0.45)",
              textAlign: "center",
            }}
          >
            {status}
          </div>
        )}
      </div>
      <div
        style={{
          padding: "10px 14px 12px",
          color: "#F9F8F5",
          fontSize: 12,
          lineHeight: "18px",
        }}
      >
        Some networks need a TURN relay for reliable video.
      </div>
    </div>
  );
}
