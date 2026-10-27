import { useEffect, useRef, useState } from "react";
import {
  createLiveIceConfiguration,
  isLiveOfferEpoch,
  LIVE_RELAY_REFRESH_SKEW_MS,
  liveRelayExpiryMs,
  liveRelayNeedsRefresh,
  planLiveViewerRecovery,
  queuePendingLiveIce,
  splitPendingLiveIceForOfferEpoch,
  type LiveTurnCredentials,
  type LiveIceCandidateEnvelope,
  type LiveOfferEpoch,
  withLiveOfferEpoch,
} from "@/lib/live-ice";
import { shouldPreserveLiveParticipantReadiness } from "@/lib/parity27-live-media-recovery";
import { createTRPCClient } from "@/lib/trpc";
import type {
  A26LiveMediaPhase,
  A26LiveMediaPhaseChange,
} from "@/lib/a26-live-media-state";
import { hostGenerationFromRestartSignal } from "@/shared/live-generation-restart";
import { StatusMessage } from "./status-message";
import {
  liveHostLeaseFromJoin,
  liveMediaStatusPresentation,
  type LiveHostLease,
} from "./design31-live-ui";
import { terminateLiveTransportForError } from "./live-media-terminal";

export type LiveMediaProps = {
  streamId: number;
  host: boolean;
  currentUserId: number | null;
  onError?: (message: string) => void;
  /** Hosts receive their owned join generation; viewers receive no argument. */
  onReady?: (generation?: number) => void;
  /** Hosts receive only their current authenticated join lease before readiness. */
  onHostLease?: (lease: LiveHostLease) => void;
  /** Current adapter lifecycle transition; route state must reject stale generations. */
  onMediaPhaseChange?: (change: A26LiveMediaPhaseChange) => void;
};

type SignalKind = "join" | "offer" | "answer" | "ice" | "leave";
type Signal = {
  id: number;
  fromId: number;
  toId: number | null;
  kind: SignalKind;
  payload: string;
};

type WebCandidate = RTCIceCandidateInit & LiveIceCandidateEnvelope;
type WebDescription = RTCSessionDescriptionInit & LiveOfferEpoch;

type PeerState = {
  connection: RTCPeerConnection;
  pendingIce: WebCandidate[];
  restartPending: boolean;
  /** Monotonically tags offers created by the host peer. */
  localOfferEpoch: number;
  /** The exact offer epoch whose remote description has been applied. */
  remoteOfferEpoch: number | null;
};

type DeferredTeardown = {
  streamId: number;
  host: boolean;
  controller: AbortController;
};

const MAX_VIEWER_REJOIN_ATTEMPTS = 2;
const VIEWER_REJOIN_BASE_DELAY_MS = 700;
// Must expire before the server's setup deadline; this is not a broadcast-ready lease.
const HOST_SETUP_CLIENT_DEADLINE_MS = 85_000;

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

function messageFor(_error: unknown): string {
  return "We couldn’t connect to the live stream. Check your connection and try again.";
}

function parseDescription(
  payload: string,
  type: "offer" | "answer",
): WebDescription {
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid session description.");
  const description = value as WebDescription;
  if (description.type !== type || typeof description.sdp !== "string") {
    throw new Error("Invalid session description.");
  }
  if (
    description.liveOfferEpoch !== undefined &&
    !isLiveOfferEpoch(description.liveOfferEpoch)
  ) {
    throw new Error("Invalid live offer epoch.");
  }
  return description;
}

function parseCandidate(payload: string): WebCandidate {
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid ICE candidate.");
  const candidate = value as WebCandidate;
  if (typeof candidate.candidate !== "string" || !candidate.candidate) {
    throw new Error("Invalid ICE candidate.");
  }
  if (
    candidate.liveOfferEpoch !== undefined &&
    !isLiveOfferEpoch(candidate.liveOfferEpoch)
  ) {
    throw new Error("Invalid live offer epoch.");
  }
  return candidate;
}

/** Actual browser WebRTC transport. Signaling is authenticated tRPC polling. */
export default function LiveMedia({
  streamId,
  host,
  currentUserId,
  onError,
  onReady,
  onHostLease,
  onMediaPhaseChange,
}: LiveMediaProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<number, PeerState>>(new Map());
  const callbackRef = useRef({
    onError,
    onReady,
    onHostLease,
    onMediaPhaseChange,
  });
  const deferredTeardownRef = useRef<DeferredTeardown | null>(null);
  const [api] = useState(createTRPCClient);
  const [status, setStatus] = useState(
    host ? "Preparing camera…" : "Joining live stream…",
  );
  const statusPresentation = liveMediaStatusPresentation(status);

  useEffect(() => {
    callbackRef.current = {
      onError,
      onReady,
      onHostLease,
      onMediaPhaseChange,
    };
  }, [onError, onHostLease, onMediaPhaseChange, onReady]);

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
    let viewerRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let setupDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let relayRefreshPromise: Promise<void> | null = null;
    let relay: LiveTurnCredentials | null = null;
    let iceConfiguration: RTCConfiguration | null = null;
    let relayVersion = 0;
    let cursor = 0;
    let generation: number | null = null;
    let hostId: number | null = null;
    let hostGeneration: number | null = null;
    let viewerRestarting = false;
    let viewerRecoveryAttempts = 0;
    let viewerMediaReady = false;
    let hostMediaReady = false;
    let terminal = false;
    let pageHideHandler: (() => void) | null = null;

    const emitMediaPhase = (phase: A26LiveMediaPhase, message?: string) => {
      if (!active) return;
      callbackRef.current.onMediaPhaseChange?.({
        phase,
        generation,
        ...(message === undefined ? {} : { message }),
      });
    };

    const report = (error: unknown) => {
      if (!active) return;
      if (terminateLiveTransportForError(error, terminate)) return;
      const message = messageFor(error);
      setStatus(message);
      if (
        shouldPreserveLiveParticipantReadiness({
          host,
          hostMediaReady,
          viewerMediaReady,
        })
      ) {
        return;
      }
      emitMediaPhase("error", message);
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
      if (viewerRecoveryTimer) clearTimeout(viewerRecoveryTimer);
      if (setupDeadlineTimer) clearTimeout(setupDeadlineTimer);
      stopAllPeers();
      const localStream = localStreamRef.current;
      localStreamRef.current = null;
      localStream?.getTracks().forEach((track) => track.stop());
      if (localVideo) localVideo.srcObject = null;
      if (remoteVideo) remoteVideo.srcObject = null;
    };

    const terminate = (state: { message: string }) => {
      if (terminal || !active) return;
      emitMediaPhase("error", state.message);
      terminal = true;
      active = false;
      stopTransport();
      setStatus(state.message);
      callbackRef.current.onError?.(state.message);
    };

    const addQueuedIce = async (peer: PeerState) => {
      if (!peer.connection.remoteDescription) return;
      const { apply, retain } = splitPendingLiveIceForOfferEpoch(
        peer.pendingIce,
        peer.remoteOfferEpoch,
      );
      peer.pendingIce = retain;
      for (const candidate of apply) {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };

    const receiveIce = async (peer: PeerState, payload: string) => {
      const candidate = parseCandidate(payload);
      const candidateEpoch = candidate.liveOfferEpoch;
      if (!peer.connection.remoteDescription) {
        peer.pendingIce = queuePendingLiveIce(peer.pendingIce, candidate);
        return;
      }
      if (candidateEpoch === undefined) {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
        return;
      }
      if (
        peer.remoteOfferEpoch === null ||
        candidateEpoch > peer.remoteOfferEpoch
      ) {
        peer.pendingIce = queuePendingLiveIce(peer.pendingIce, candidate);
        return;
      }
      if (candidateEpoch < peer.remoteOfferEpoch) return;
      await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
    };

    const requireGeneration = (): number => {
      if (generation === null)
        throw new Error("Live media session is not ready.");
      return generation;
    };

    const requireIceConfiguration = (): RTCConfiguration => {
      if (!iceConfiguration)
        throw new Error(
          "Live relay credentials are unavailable. Please retry.",
        );
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
      const offerEpoch = peer.localOfferEpoch + 1;
      peer.localOfferEpoch = offerEpoch;
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
          payload: JSON.stringify(
            withLiveOfferEpoch(peer.connection.localDescription, offerEpoch),
          ),
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

    const signalIce = (
      participantId: number,
      candidate: RTCIceCandidate,
      liveOfferEpoch: number | null,
    ) => {
      if (!active || generation === null) return;
      const serialized = candidate.toJSON ? candidate.toJSON() : candidate;
      void api.live.signal
        .mutate({
          streamId,
          toId: participantId,
          kind: "ice",
          generation,
          payload: JSON.stringify(
            liveOfferEpoch === null
              ? serialized
              : withLiveOfferEpoch(serialized, liveOfferEpoch),
          ),
        })
        .catch(report);
    };

    const hostPeer = async (viewerId: number): Promise<PeerState | null> => {
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
        localOfferEpoch: 0,
        remoteOfferEpoch: null,
      };
      peersRef.current.set(viewerId, peer);
      localStream
        .getTracks()
        .forEach((track) => connection.addTrack(track, localStream));
      connection.onicecandidate = (event) => {
        if (active && event.candidate)
          signalIce(viewerId, event.candidate, peer.localOfferEpoch || null);
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
        localOfferEpoch: 0,
        remoteOfferEpoch: null,
      };
      peersRef.current.set(hostId, peer);
      connection.onicecandidate = (event) => {
        if (active && event.candidate)
          signalIce(hostId, event.candidate, peer.remoteOfferEpoch);
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
          viewerRecoveryAttempts = 0;
          setStatus("Live");
          emitMediaPhase("ready");
          callbackRef.current.onReady?.();
        }
      };
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === "failed" && active) {
          void restartViewer(hostId, null);
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
      restartedHostGeneration: number | null,
    ) => {
      if (
        host ||
        !active ||
        viewerRestarting ||
        (restartedHostGeneration !== null &&
          hostGeneration !== null &&
          restartedHostGeneration <= hostGeneration)
      ) {
        return;
      }
      const recoveringFailedPeer = restartedHostGeneration === null;
      const recoveryPlan = recoveringFailedPeer
        ? planLiveViewerRecovery(
            viewerRecoveryAttempts,
            MAX_VIEWER_REJOIN_ATTEMPTS,
            VIEWER_REJOIN_BASE_DELAY_MS,
          )
        : null;
      if (recoveryPlan?.terminal) {
        const ownedGeneration = generation;
        closePeer(restartedHostId);
        if (ownedGeneration !== null) {
          void api.live.leave
            .mutate({ streamId, generation: ownedGeneration })
            .catch(() => undefined);
        }
        terminate({
          message:
            "The live video connection could not be restored. Reopen this live moment to try again.",
        });
        return;
      }
      if (viewerRecoveryTimer) {
        clearTimeout(viewerRecoveryTimer);
        viewerRecoveryTimer = undefined;
      }
      viewerRestarting = true;
      if (recoveryPlan && !recoveryPlan.terminal) {
        viewerRecoveryAttempts = recoveryPlan.attempt;
      }
      const ownedGeneration = generation;
      closePeer(restartedHostId);
      viewerMediaReady = false;
      if (remoteVideo) remoteVideo.srcObject = null;
      setStatus("Rejoining live stream…");
      emitMediaPhase("joining");
      try {
        if (ownedGeneration !== null) {
          await api.live.leave
            .mutate({ streamId, generation: ownedGeneration })
            .catch(() => undefined);
        }
        const session = await api.live.join.mutate({ streamId });
        if (!active) return;
        generation = session.generation;
        hostId = session.hostId;
        hostGeneration = session.hostGeneration;
        cursor = session.signalCursor;
        emitMediaPhase("admitted");
        await applyRelayCredentials(session.ice, false);
      } catch {
        const nextRecoveryPlan = recoveringFailedPeer
          ? planLiveViewerRecovery(
              viewerRecoveryAttempts,
              MAX_VIEWER_REJOIN_ATTEMPTS,
              VIEWER_REJOIN_BASE_DELAY_MS,
            )
          : null;
        if (!recoveringFailedPeer || nextRecoveryPlan?.terminal) {
          const currentGeneration = generation;
          if (
            currentGeneration !== null &&
            currentGeneration !== ownedGeneration
          ) {
            void api.live.leave
              .mutate({ streamId, generation: currentGeneration })
              .catch(() => undefined);
          }
          terminate({
            message:
              "The live video connection could not be restored. Reopen this live moment to try again.",
          });
          return;
        }
        setStatus("Reconnecting live video…");
        viewerRecoveryTimer = setTimeout(() => {
          viewerRecoveryTimer = undefined;
          void restartViewer(restartedHostId, null);
        }, recoveryPlan?.retryDelayMs ?? VIEWER_REJOIN_BASE_DELAY_MS);
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
          const answer = parseDescription(signal.payload, "answer");
          if (
            answer.liveOfferEpoch !== undefined &&
            answer.liveOfferEpoch !== peer.localOfferEpoch
          ) {
            throw new Error("Live answer does not match the active offer.");
          }
          await peer.connection.setRemoteDescription(answer);
          // The host created this offer, so its local epoch is authoritative
          // even when supporting a deliberately untagged legacy answer.
          peer.remoteOfferEpoch = peer.localOfferEpoch;
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
        const offer = parseDescription(signal.payload, "offer");
        await peer.connection.setRemoteDescription(offer);
        // An untagged legacy offer stays explicitly unknown. That path can
        // apply untagged ICE, but never guesses that tagged ICE belongs here.
        peer.remoteOfferEpoch = offer.liveOfferEpoch ?? null;
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
          payload: JSON.stringify(
            peer.remoteOfferEpoch === null
              ? peer.connection.localDescription
              : withLiveOfferEpoch(
                  peer.connection.localDescription,
                  peer.remoteOfferEpoch,
                ),
          ),
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
        if (
          shouldPreserveLiveParticipantReadiness({
            host,
            hostMediaReady,
            viewerMediaReady,
          })
        ) {
          setStatus("Live");
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
        emitMediaPhase("admitted");
        const hostLease = liveHostLeaseFromJoin({
          host,
          streamId,
          generation: session.generation,
          joinedHostId: session.hostId,
          currentUserId,
        });
        if (hostLease) callbackRef.current.onHostLease?.(hostLease);
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
          const renewHostHeartbeat = () => {
            if (!active) return;
            void api.live.heartbeat
              .mutate({
                streamId,
                generation: hostCleanupGeneration,
                ...(hostMediaReady ? {} : { setup: true }),
              })
              .catch(report);
          };
          // Permissions can legitimately take longer than the initial lease.
          // This remains provisional (readyAt stays null) and is bounded on both
          // client and server rather than becoming an invisible indefinite live.
          renewHostHeartbeat();
          heartbeatTimer = setInterval(renewHostHeartbeat, 5_000);
          setupDeadlineTimer = setTimeout(() => {
            if (!active || hostMediaReady) return;
            void endHostedStream(hostCleanupGeneration);
            terminate({
              message:
                "Camera setup timed out. Start a new live moment to try again.",
            });
          }, HOST_SETUP_CLIENT_DEADLINE_MS);
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
          hostMediaReady = true;
          if (setupDeadlineTimer) clearTimeout(setupDeadlineTimer);
          setupDeadlineTimer = undefined;
          setStatus("Live");
          emitMediaPhase("ready");
          callbackRef.current.onReady?.(hostCleanupGeneration);
        } else {
          setStatus("Waiting for host video…");
        }

        await poll();
        if (active) pollTimer = setInterval(() => void poll(), 900);
        if (active && !heartbeatTimer) {
          heartbeatTimer = setInterval(() => {
            if (viewerRestarting) return;
            const heartbeatGeneration = host ? ownedHostGeneration : generation;
            if (heartbeatGeneration === null) return;
            void api.live.heartbeat
              .mutate({
                streamId,
                generation: heartbeatGeneration,
                ...(host && !hostMediaReady ? { setup: true } : {}),
              })
              .catch(report);
          }, 5_000);
        }
        return ownedHostGeneration;
      } catch (error) {
        report(error);
        if (host) stopTransport();
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

    emitMediaPhase("joining");
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
  }, [api, currentUserId, host, streamId]);

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
        {statusPresentation.message ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 16,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                maxWidth: "100%",
                borderRadius: 12,
                padding: "10px 14px",
                backgroundColor: statusPresentation.backplateColor,
              }}
            >
              <StatusMessage
                message={statusPresentation.message}
                tone={statusPresentation.tone}
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  lineHeight: 20,
                  textAlign: "center",
                }}
              />
            </div>
          </div>
        ) : null}
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
