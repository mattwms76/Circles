export type SingleFlightTask = () => Promise<void>;

/**
 * Accepts one asynchronous submission at a time. The busy flag changes before
 * the task's first await, so repeated press and submit events cannot start a
 * second mutation while React is still scheduling the disabled UI state.
 */
export function createSingleFlightSubmitter() {
  let busy = false;

  return {
    get isBusy() {
      return busy;
    },
    async run(task: SingleFlightTask): Promise<boolean> {
      if (busy) {
        return false;
      }

      busy = true;
      try {
        await task();
        return true;
      } finally {
        busy = false;
      }
    },
  };
}
