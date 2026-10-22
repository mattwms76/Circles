export type ActiveLiveViewer = {
  userId: number;
  generation: number;
};

export type HostGenerationRestartSignal = {
  streamId: number;
  fromId: number;
  toId: number;
  kind: "join";
  fromGeneration: number;
  toGeneration: number;
  payload: string;
};

const HOST_GENERATION_RESTART = "host-generation-restart";

type HostGenerationRestartPayload = {
  type: typeof HOST_GENERATION_RESTART;
  hostGeneration: number;
};

/**
 * A restart deliberately reuses the persisted system `join` kind. Keeping the
 * signal enum unchanged means the additive 0004 migration remains exactly the
 * reviewed generated artifact; the exact payload distinguishes a host reset
 * from a viewer's ordinary join request.
 */
export function createHostGenerationRestartSignals(input: {
  streamId: number;
  hostId: number;
  hostGeneration: number;
  viewers: ActiveLiveViewer[];
}): HostGenerationRestartSignal[] {
  const payload: HostGenerationRestartPayload = {
    type: HOST_GENERATION_RESTART,
    hostGeneration: input.hostGeneration,
  };
  return input.viewers.map((viewer) => ({
    streamId: input.streamId,
    fromId: input.hostId,
    toId: viewer.userId,
    kind: "join",
    fromGeneration: input.hostGeneration,
    toGeneration: viewer.generation,
    payload: JSON.stringify(payload),
  }));
}

/** Returns the new host generation only for a well-formed host reset signal. */
export function hostGenerationFromRestartSignal(input: {
  kind: string;
  fromId: number;
  expectedHostId: number;
  payload: string;
}): number | null {
  if (input.kind !== "join" || input.fromId !== input.expectedHostId) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(input.payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const payload = value as Partial<HostGenerationRestartPayload>;
    if (
      payload.type !== HOST_GENERATION_RESTART ||
      typeof payload.hostGeneration !== "number" ||
      !Number.isInteger(payload.hostGeneration) ||
      payload.hostGeneration < 1
    ) {
      return null;
    }
    return payload.hostGeneration;
  } catch {
    return null;
  }
}
