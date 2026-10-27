export type Sec27CaptureTerminalReason =
  | "native-inactive"
  | "native-background"
  | "web-hidden"
  | "web-pagehide";

type Sec27CaptureLifecycleOptions = {
  stopLocalCapture: () => void;
  notifyTerminal: (reason: Sec27CaptureTerminalReason) => void;
  sendGenerationTerminal: (generation: number) => Promise<unknown>;
};

export type Sec27CaptureLifecycle = {
  /**
   * Stops local capture immediately. A terminal call is sent only after the
   * local teardown and only when this effect owns a generation.
   */
  terminate: (
    reason: Sec27CaptureTerminalReason,
    generation: number | null,
  ) => boolean;
  /**
   * Settles a join that completed after a background transition without
   * reacquiring capture or duplicating a previously sent terminal request.
   */
  bindGenerationAfterTerminal: (generation: number) => boolean;
  /** Background is terminal for this mounted adapter; only a new user action may rejoin. */
  resumeRequiresExplicitRejoin: () => true;
  isTerminal: () => boolean;
};

/**
 * Keeps platform lifecycle callbacks independent from WebRTC/provider APIs.
 * A late join can still release its exact server generation after local capture
 * was stopped, but a foreground event never recreates tracks or peers.
 */
export function createSec27CaptureLifecycle({
  stopLocalCapture,
  notifyTerminal,
  sendGenerationTerminal,
}: Sec27CaptureLifecycleOptions): Sec27CaptureLifecycle {
  let terminal = false;
  let terminalRequestSent = false;

  const sendTerminalOnce = (generation: number): boolean => {
    if (terminalRequestSent) return false;
    terminalRequestSent = true;
    try {
      void sendGenerationTerminal(generation).catch(() => undefined);
    } catch {
      // Lifecycle release is best effort; local capture remains stopped.
    }
    return true;
  };

  return {
    terminate(reason, generation) {
      if (!terminal) {
        terminal = true;
        // This synchronous order prevents a background transition from waiting
        // on an API response before camera, microphone, peers, or renderers stop.
        stopLocalCapture();
        notifyTerminal(reason);
      }
      return generation === null ? false : sendTerminalOnce(generation);
    },
    bindGenerationAfterTerminal(generation) {
      return terminal ? sendTerminalOnce(generation) : false;
    },
    resumeRequiresExplicitRejoin() {
      return true;
    },
    isTerminal() {
      return terminal;
    },
  };
}
