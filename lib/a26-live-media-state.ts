export type A26LiveMediaPhase = "joining" | "admitted" | "ready" | "error";

export type A26LiveMediaPhaseChange = Readonly<{
  phase: A26LiveMediaPhase;
  /** The adapter's currently admitted server generation, when one exists. */
  generation: number | null;
  /** Required for error phases; adapter-owned status UI announces this message. */
  message?: string;
}>;

export type A26LiveMediaState = Readonly<{
  phase: A26LiveMediaPhase;
  generation: number | null;
  /** Retained during a reconnect and cleared only by current-generation media. */
  error: string | null;
}>;

function isGeneration(value: number | null): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasMatchingGeneration(
  current: A26LiveMediaState,
  change: A26LiveMediaPhaseChange,
): boolean {
  return current.generation === change.generation;
}

export function createA26LiveMediaState(): A26LiveMediaState {
  return { phase: "joining", generation: null, error: null };
}

/**
 * Applies only the current adapter lifecycle. A viewer recovery deliberately
 * enters joining with its old generation before accepting the replacement
 * admission; delayed ready/error signals from the old generation are ignored.
 */
export function transitionA26LiveMediaState(
  current: A26LiveMediaState,
  change: A26LiveMediaPhaseChange,
): A26LiveMediaState {
  if (change.generation !== null && !isGeneration(change.generation)) {
    return current;
  }

  if (change.phase === "joining") {
    if (
      current.generation !== null &&
      change.generation !== null &&
      !hasMatchingGeneration(current, change)
    ) {
      return current;
    }
    return {
      phase: "joining",
      generation: change.generation ?? current.generation,
      error: current.error,
    };
  }

  if (change.phase === "admitted") {
    if (!isGeneration(change.generation)) return current;
    const mayReplaceJoiningGeneration = current.phase === "joining";
    if (
      !hasMatchingGeneration(current, change) &&
      !mayReplaceJoiningGeneration
    ) {
      return current;
    }
    return {
      phase: "admitted",
      generation: change.generation,
      error: current.error,
    };
  }

  if (!hasMatchingGeneration(current, change)) return current;

  if (change.phase === "ready") {
    return { phase: "ready", generation: change.generation, error: null };
  }

  return {
    phase: "error",
    generation: change.generation,
    error: change.message ?? current.error ?? "Live video is unavailable.",
  };
}

/** Chat and reactions require both an admitted server generation and media readiness. */
export function isA26LiveParticipantReady(state: A26LiveMediaState): boolean {
  return state.phase === "ready" && isGeneration(state.generation);
}
