export const INCOMPLETE_LOGOUT_SENTINEL_KEY = "circles.sec27.incomplete-logout";

const INCOMPLETE_LOGOUT_SENTINEL_VALUE = "v1";

export type CredentialAdmissionStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type CredentialAdmissionPersistence =
  | "not_configured"
  | "not_needed"
  | "pending"
  | "persisted"
  | "failed"
  | "removing";

export type CredentialAdmissionSnapshot = {
  /** A request is admitted only after storage has been checked and no marker remains. */
  admitted: boolean;
  /** The marker read completed. Before this is true, credential transport fails closed. */
  hydrated: boolean;
  /** Increments synchronously whenever a logout barrier begins. */
  generation: number;
  /** Non-secret marker lifecycle; no credential is represented here. */
  persistence: CredentialAdmissionPersistence;
};

export type CredentialAdmissionLogoutAttempt = {
  generation: number;
  /** Waits for this exact attempt's non-secret recovery marker to be persisted. */
  confirmPersisted: () => Promise<boolean>;
};

export type CredentialAdmissionController = {
  configureStorage: (storage: CredentialAdmissionStorage) => Promise<void>;
  beginIncompleteLogout: () => CredentialAdmissionLogoutAttempt;
  clearAfterConfirmedLogout: (
    attempt: CredentialAdmissionLogoutAttempt,
  ) => Promise<boolean>;
  captureCredentialForIncompleteLogoutRecovery: (
    credential: string | null,
  ) => string | null;
  /**
   * Recovery-only: this never reads storage and is available only while the
   * incomplete-logout barrier remains closed. Undefined means no raw value was
   * captured in this process (for example after an application reload).
   */
  getCapturedCredentialForIncompleteLogoutRecovery: () =>
    | string
    | null
    | undefined;
  getSnapshot: () => CredentialAdmissionSnapshot;
  isGenerationAdmitted: (generation: number) => boolean;
  subscribe: (listener: () => void) => () => void;
  /** Applies the current barrier at the final request-dispatch point. */
  prepareRequest: (options?: RequestInit) => RequestInit;
};

function copySnapshot(
  admitted: boolean,
  hydrated: boolean,
  generation: number,
  persistence: CredentialAdmissionPersistence,
): CredentialAdmissionSnapshot {
  return { admitted, hydrated, generation, persistence };
}

/**
 * A process-local, storage-adapted credential-admission controller. It never
 * stores a bearer/cookie value: persistent state is only the fixed incomplete
 * logout marker. Until the marker read succeeds, all credentials are denied.
 */
export function createCredentialAdmissionController(): CredentialAdmissionController {
  let storage: CredentialAdmissionStorage | null = null;
  let admitted = false;
  let hydrated = false;
  let generation = 0;
  let persistence: CredentialAdmissionPersistence = "not_configured";
  let hydration: Promise<void> | null = null;
  let latestPersistence: Promise<boolean> | null = null;
  let capturedRecoveryCredential: string | null | undefined;
  let storageTail: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const snapshot = () =>
    copySnapshot(admitted, hydrated, generation, persistence);

  const enqueueStorage = <T>(operation: () => Promise<T>): Promise<T> => {
    const operationResult = storageTail.then(operation);
    storageTail = operationResult.then(
      () => undefined,
      () => undefined,
    );
    return operationResult;
  };

  const persistBarrier = (attemptGeneration: number): Promise<boolean> => {
    if (!storage || attemptGeneration !== generation || admitted) {
      return Promise.resolve(false);
    }

    persistence = "pending";
    notify();
    const write = enqueueStorage(async () => {
      await storage!.setItem(
        INCOMPLETE_LOGOUT_SENTINEL_KEY,
        INCOMPLETE_LOGOUT_SENTINEL_VALUE,
      );
      return true;
    }).then(
      () => {
        if (attemptGeneration !== generation || admitted) return false;
        persistence = "persisted";
        notify();
        return true;
      },
      () => {
        if (attemptGeneration === generation && !admitted) {
          persistence = "failed";
          notify();
        }
        return false;
      },
    );
    latestPersistence = write;
    return write;
  };

  const confirmPersisted = async (
    attemptGeneration: number,
  ): Promise<boolean> => {
    if (attemptGeneration !== generation || admitted || !storage) return false;
    if (persistence === "persisted") return true;
    if (persistence === "pending" && latestPersistence) {
      return latestPersistence;
    }
    return persistBarrier(attemptGeneration);
  };

  return {
    configureStorage(nextStorage) {
      if (storage && storage !== nextStorage) {
        // The platform storage is fixed for a process. A replacement could make
        // a checked marker appear to disappear, so remain fail-closed instead.
        admitted = false;
        hydrated = true;
        persistence = "failed";
        notify();
        return Promise.resolve();
      }
      if (hydration) return hydration;

      storage = nextStorage;
      hydrated = false;
      admitted = false;
      persistence = "pending";
      notify();
      const hydrationGeneration = generation;
      hydration = enqueueStorage(async () => {
        let marker: string | null;
        try {
          marker = await nextStorage.getItem(INCOMPLETE_LOGOUT_SENTINEL_KEY);
        } catch {
          if (hydrationGeneration === generation) {
            hydrated = true;
            admitted = false;
            persistence = "failed";
            notify();
          }
          return;
        }

        // A synchronous logout-start barrier may have been set while the read
        // was pending. It owns the state and its later serialized write.
        if (hydrationGeneration !== generation) return;
        hydrated = true;
        if (marker === null) {
          admitted = true;
          persistence = "not_needed";
        } else {
          admitted = false;
          persistence =
            marker === INCOMPLETE_LOGOUT_SENTINEL_VALUE
              ? "persisted"
              : "failed";
        }
        notify();
      });
      return hydration;
    },

    beginIncompleteLogout() {
      const wasBlocked = !admitted && hydrated;
      generation += 1;
      admitted = false;
      // Preserve a previously captured raw value through explicit retries, but
      // never across a completed barrier.
      if (!wasBlocked) capturedRecoveryCredential = undefined;
      if (!storage) {
        hydrated = true;
        persistence = "not_configured";
        notify();
      } else {
        persistence = "pending";
        notify();
        void persistBarrier(generation);
      }
      const attemptGeneration = generation;
      return {
        generation: attemptGeneration,
        confirmPersisted: () => confirmPersisted(attemptGeneration),
      };
    },

    async clearAfterConfirmedLogout(attempt) {
      if (
        attempt.generation !== generation ||
        admitted ||
        !(await confirmPersisted(attempt.generation)) ||
        !storage
      ) {
        return false;
      }

      persistence = "removing";
      notify();
      const attemptGeneration = attempt.generation;
      try {
        await enqueueStorage(() =>
          storage!.removeItem(INCOMPLETE_LOGOUT_SENTINEL_KEY),
        );
      } catch {
        if (attemptGeneration === generation && !admitted) {
          persistence = "failed";
          notify();
        }
        return false;
      }

      // A newer synchronous logout barrier queues its write after this removal.
      // It must remain closed even though this stale removal completed.
      if (attemptGeneration !== generation || admitted) return false;
      capturedRecoveryCredential = undefined;
      hydrated = true;
      admitted = true;
      persistence = "not_needed";
      notify();
      return true;
    },

    captureCredentialForIncompleteLogoutRecovery(credential) {
      if (admitted) return null;
      if (capturedRecoveryCredential === undefined) {
        capturedRecoveryCredential = credential;
      }
      return capturedRecoveryCredential;
    },

    getCapturedCredentialForIncompleteLogoutRecovery() {
      return admitted ? undefined : capturedRecoveryCredential;
    },

    getSnapshot: snapshot,

    isGenerationAdmitted(candidateGeneration) {
      return hydrated && admitted && candidateGeneration === generation;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    prepareRequest(options = {}) {
      const headers = new Headers(options.headers);
      if (!hydrated || !admitted) {
        // This final dispatch fence covers a logout that begins after async
        // headers resolved but before a queued request reaches fetch.
        headers.delete("Authorization");
        return { ...options, headers, credentials: "omit" };
      }
      return {
        ...options,
        headers,
        credentials: options.credentials ?? "include",
      };
    },
  };
}

/** Shared app controller. Its storage adapter is supplied by lib/_core/auth. */
export const credentialAdmission = createCredentialAdmissionController();
