import React, { useEffect, useRef, useState } from "react";
import {
  createLiveIceConfiguration,
  LIVE_RELAY_REFRESH_SKEW_MS,
  liveRelayExpiryMs,
  liveRelayNeedsRefresh,
  type LiveTurnCredentials,
} from "@/lib/live-ice";
import { createTRPCClient } from "@/lib/trpc";
import { hostGenerationFromRestartSignal } from "@/shared/live-generation-restart";
import { terminateLiveTransportForError } from "./live-media-terminal";

export type LiveMediaProps = {
  streamId: number;
  host: boolean;
  onError?: (message: string) => void;
  /** Hosts receive their owned join generation; viewers receive no argument. */
  onReady?: (generation?: number) => void;
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
  restartPending: boolean;
};

type DeferredTeardown = {
  streamId: number;
  host: boolean;
  controller: AbortController;
};

function browserIceConfiguration(
  relay: LiveTurnCredentials | null,
): RTCConfiguration {
  const configuration = createLiveIceConfiguration(relay);
  return {
    iceServers: configuration.iceServers.map((server) => ({
      urls: [...server.urls],
      ...(server.username === undefined ? {} : { username: server.username }),
      ...(server.credential === undefined
        ? {}
        : { credential: server.credential }),
      ...(server.credentialType === undefined
        ? {}
        : { credentialType: server.credentialType }),
    })),
  };
}

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
    let relayRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    let relayRefreshPromise: Promise<void> | null = null;
    let relay: LiveTurnCredentials | null = null;
    let iceConfiguration: RTCConfiguration | null = null;
    let relayVersion = 0;
    let cursor = 0;
    let generation: number | null = null;
    let hostId: number | null = null;
    let hostGeneration: number | null = null;
    let viewerRestarting = false;
    let viewerMediaReady = false;
    let terminal = false;
    let pageHideHandler: (() => void) | null = null;

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
      if (relayRefreshTimer) clearTimeout(relayRefreshTimer);
      stopAllPeers();
      const localStream = localStreamRef.current;
      localStreamRef.current = null;
      localStream?.getTracks().forEach((track) => track.stop());
      if (localVideo) localVideo.srcObject = null;
      if (remoteVideo) remoteVideo.srcObject = null;
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

    const requireGeneration = (): number => {
      if (generation === null)
        throw new Error("Live media session is not ready.");
      return generation;
    };

    const requireIceConfiguration = (): RTCConfiguration => {
      if (!iceConfiguration)
        throw new Error("Live relay credentials are unavailable. Please retry.");
      return iceConfiguration;
    };

    const scheduleRelayRefresh = () => {
      if (relayRefreshTimer) clearTimeout(relayRefreshTimer);
      relayRefreshTimer = undefined;
      if (!active || relay === null) return;
      const refreshInMs = Math.max(
        1_000,
        liveRelayExpiryMs(relay) - Date.now() - LIVE_RELAY_REFRESH_SKEW_MS,
      );
      relayRefreshTimer = setTimeout(() => {
        void refreshRelay().catch(report);
      }, refreshInMs);
    };

    const sendHostOffer = async (
      viewerId: number,
      peer: PeerState,
      iceRestart = false,
    ) => {
      if (
        !active ||
        peersRef.current.get(viewerId) !== peer ||
        peer.connection.signalingState !== "stable"
      ) {
        if (iceRestart && active && peersRef.current.get(viewerId) === peer) {
          peer.restartPending = true;
        }
        return;
      }
      const offer = await peer.connection.createOffer(
        iceRestart ? { iceRestart: true } : undefined,
      );
      if (!active || peersRef.current.get(viewerId) !== peer) return;
      await peer.connection.setLocalDescription(offer);
      if (
        !active ||
        peersRef.current.get(viewerId) !== peer ||
        !peer.connection.localDescription
      ) {
        return;
      }
      try {
        await api.live.signal.mutate({
          streamId,
          toId: viewerId,
          kind: "offer",
          generation: requireGeneration(),
          payload: JSON.stringify(peer.connection.localDescription),
        });
      } catch (error) {
        closePeer(viewerId);
        throw error;
      }
    };

    const restartHostPeerOffers = async () => {
      if (!host || !active) return;
      for (const [viewerId, peer] of [...peersRef.current.entries()]) {
        await sendHostOffer(viewerId, peer, true);
      }
    };

    const applyRelayCredentials = async (
      nextRelay: LiveTurnCredentials | null,
      restartHostPeers: boolean,
    ) => {
      const nextConfiguration = browserIceConfiguration(nextRelay);
      relay = nextRelay;
      iceConfiguration = nextConfiguration;
      relayVersion += 1;
      for (const peer of peersRef.current.values()) {
        peer.connection.setConfiguration(nextConfiguration);
      }
      scheduleRelayRefresh();
      if (restartHostPeers) await restartHostPeerOffers();
    };

    const refreshRelay = async (force = false): Promise<void> => {
      if (relay === null) return;
      if (!force && !liveRelayNeedsRefresh(relay)) {
        scheduleRelayRefresh();
        return;
      }
      if (relayRefreshPromise) return relayRefreshPromise;

      const expectedGeneration = requireGeneration();
      const expectedRelayVersion = relayVersion;
      const refreshPromise = (async () => {
        const refreshed = await api.live.relay.query({
          streamId,
          generation: expectedGeneration,
        });
        if (
          !active ||
          generation !== expectedGeneration ||
          relayVersion !== expectedRelayVersion
        ) {
          return;
        }
        await applyRelayCredentials(refreshed.ice, host);
      })();
      relayRefreshPromise = refreshPromise;
      try {
        await refreshPromise;
      } finally {
        if (relayRefreshPromise === refreshPromise) relayRefreshPromise = null;
      }
    };

    const signalIce = (participantId: number, candidate: RTCIceCandidate) => {
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

    const hostPeer = async (
      viewerId: number,
    ): Promise<PeerState | null> => {
      const existing = peersRef.current.get(viewerId);
      if (existing) return existing;
      await refreshRelay();
      if (!active) return null;
      const localStream = localStreamRef.current;
      if (!localStream) throw new Error("Camera and microphone are not ready.");

      const connection = new RTCPeerConnection(requireIceConfiguration());
      const peer: PeerState = {
        connection,
        pendingIce: [],
        restartPending: false,
      };
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

      const connection = new RTCPeerConnection(requireIceConfiguration());
      const peer: PeerState = {
        connection,
        pendingIce: [],
        restartPending: false,
      };
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

    /**
     * A host reload is not a terminal access failure. The server first sends a
     * generation-bound restart to each active viewer; closing the old peer
     * before join makes the new viewer generation and its single join atomic
     * from this transport's perspective.
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
      if (remoteVideo) remoteVideo.srcObject = null;
      setStatus("Rejoining live stream…");
      try {
        const session = await api.live.join.mutate({ streamId });
        if (!active) return;
        generation = session.generation;
        hostId = session.hostId;
        hostGeneration = session.hostGeneration;
        cursor = session.signalCursor;
        await applyRelayCredentials(session.ice, false);
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
          const peer = await hostPeer(signal.fromId);
          if (!peer) return;
          await sendHostOffer(signal.fromId, peer);
          return;
        }
        if (signal.kind === "answer") {
          const peer = peersRef.current.get(signal.fromId);
          if (!peer) return;
          await peer.connection.setRemoteDescription(
            parseDescription(signal.payload, "answer"),
          );
          await addQueuedIce(peer);
          if (peer.restartPending) {
            peer.restartPending = false;
            void sendHostOffer(signal.fromId, peer, true).catch(report);
          }
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
        const existingPeer = peersRef.current.get(signal.fromId);
        // A host relay renewal is an ICE-restart offer. Refresh before the
        // answer so a throttled viewer never responds with expired TURN data.
        await refreshRelay(existingPeer?.connection.remoteDescription !== null);
        if (!active) return;
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
          generation: requireGeneration(),
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
          // Advance even for a bad historic signal so polling cannot deadlock.
          cursor = Math.max(cursor, signal.id);
        }
      } catch (error) {
        report(error);
      } finally {
        polling = false;
      }
    };

    let hostedStreamEndPromise: Promise<void> | null = null;
    const endHostedStream = (ownedGeneration: number): Promise<void> => {
      if (hostedStreamEndPromise) return hostedStreamEndPromise;
      const ending = api.live.end
        .mutate({ streamId, generation: ownedGeneration })
        .then(
          () => undefined,
          () => undefined,
        );
      hostedStreamEndPromise = ending;
      return ending;
    };

    const initialise = async (): Promise<number | null> => {
      let ownedHostGeneration: number | null = null;
      try {
        const session = await api.live.join.mutate({ streamId });
        generation = session.generation;
        hostId = session.hostId;
        hostGeneration = session.hostGeneration;
        cursor = session.signalCursor;
        joined = true;
        ownedHostGeneration = host ? session.generation : null;
        if (!active) return ownedHostGeneration;
        await applyRelayCredentials(session.ice, false);

        if (host) {
          const hostCleanupGeneration = ownedHostGeneration;
          if (hostCleanupGeneration === null) {
            throw new Error("Host live media generation is unavailable.");
          }
          pageHideHandler = () => {
            if (!terminal) void endHostedStream(hostCleanupGeneration);
          };
          if (typeof window !== "undefined") {
            window.addEventListener("pagehide", pageHideHandler);
          }
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: { facingMode: "user" },
          });
          if (!active) {
            stream.getTracks().forEach((track) => track.stop());
            return ownedHostGeneration;
          }
          localStreamRef.current = stream;
          if (localVideo) {
            localVideo.srcObject = stream;
            void localVideo.play().catch(() => undefined);
          }
          // Do not expose this stream to viewers until camera capture has really
          // completed and the server has accepted the host heartbeat.
          await api.live.heartbeat.mutate({
            streamId,
            ready: true,
            generation: hostCleanupGeneration,
          });
          if (!active) return ownedHostGeneration;
          setStatus("Live");
          callbackRef.current.onReady?.(hostCleanupGeneration);
        } else {
          setStatus("Waiting for host video…");
        }

        await poll();
        if (active) pollTimer = setInterval(() => void poll(), 900);
        if (active) {
          heartbeatTimer = setInterval(() => {
            const heartbeatGeneration = host
              ? ownedHostGeneration
              : generation;
            if (heartbeatGeneration === null) return;
            void api.live.heartbeat
              .mutate({ streamId, generation: heartbeatGeneration })
              .catch(report);
          }, 5_000);
        }
        return ownedHostGeneration;
      } catch (error) {
        report(error);
        if (
          host &&
          ownedHostGeneration !== null &&
          !terminal &&
          !teardownController.signal.aborted
        ) {
          void endHostedStream(ownedHostGeneration);
        }
        return ownedHostGeneration;
      }
    };

    const initialisePromise = initialise();
    return () => {
      active = false;
      if (typeof window !== "undefined" && pageHideHandler) {
        window.removeEventListener("pagehide", pageHideHandler);
      }
      stopTransport();

      // Wait for an in-flight join before leaving. A matching Strict Mode replay
      // aborts this effect-owned teardown during its next setup; a true unmount
      // or stream change still releases the membership after join settles.
      if (!terminal && !host) {
        void initialisePromise.then(async () => {
          const leavingGeneration = generation;
          if (
            joined &&
            leavingGeneration !== null &&
            !teardownController.signal.aborted
          ) {
            // The server applies this only if this effect's media generation is
            // still current, so a delayed cleanup cannot revoke a replacement.
            await api.live.leave
              .mutate({ streamId, generation: leavingGeneration })
              .catch(() => undefined);
          }
        });
      } else if (!terminal) {
        void initialisePromise.then((ownedHostGeneration) => {
          if (
            ownedHostGeneration !== null &&
            !teardownController.signal.aborted
          ) {
            void endHostedStream(ownedHostGeneration);
          }
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
