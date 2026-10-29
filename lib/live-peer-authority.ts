import {
  hasLivePeerAuthority,
  type LivePeerAuthorityViewer,
} from "../shared/live-peer-authority";

export type EstablishedLiveHostPeer = Readonly<{
  viewerId: number;
  viewerGeneration: number | null;
}>;

/**
 * A server snapshot is authoritative over the host's locally negotiated peers.
 * A changed viewer generation is evicted before a replacement transport starts.
 */
export function liveHostPeerIdsToEvict(input: {
  peers: readonly EstablishedLiveHostPeer[];
  authority: readonly LivePeerAuthorityViewer[];
}): number[] {
  return input.peers
    .filter(
      (peer) =>
        peer.viewerGeneration === null ||
        !hasLivePeerAuthority(
          input.authority,
          peer.viewerId,
          peer.viewerGeneration,
        ),
    )
    .map((peer) => peer.viewerId);
}
