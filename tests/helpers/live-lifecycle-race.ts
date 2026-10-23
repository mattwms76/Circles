import {
  activeHostLeases,
  liveSignals,
  liveViewers,
  streams,
} from "../../drizzle/live-schema";

export type FixtureStream = {
  id: number;
  hostId: number;
  title: string;
  circleId: number | null;
  thumbnail: string;
  status: "live" | "ended";
  readyAt: Date | null;
  lastHeartbeatAt: Date;
  hostGeneration: number;
  createdAt: Date;
  endedAt: Date | null;
};

export type FixtureViewer = {
  streamId: number;
  userId: number;
  joinedAt: Date;
  lastSeenAt: Date;
  generation: number;
  leftAt: Date | null;
};

export type FixtureHostLease = {
  hostId: number;
  streamId: number | null;
  lastHeartbeatAt: Date | null;
};

export type FixtureSignal = {
  id: number;
  streamId: number;
  fromId: number;
  toId: number;
  kind: "join" | "leave" | "offer" | "answer" | "ice";
  fromGeneration: number;
  toGeneration: number;
  payload: string;
};

type TransactionState = {
  releaseStreamLock: (() => void) | null;
};

type FixtureOptions = {
  stream: FixtureStream;
  viewer?: FixtureViewer | null;
  /** Makes pre-transaction reads remain stale while row-locked reads stay live. */
  freezeOutsideStreamReads?: boolean;
  /** Pauses exactly the first pre-transaction stream read after it takes a snapshot. */
  holdFirstOutsideStreamRead?: boolean;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Minimal async fixture for the exact select/lock/write shapes used by the
 * live router. Its stream FOR UPDATE gate is deliberately separate from the
 * outer transaction so a test would fail if the router stopped taking the row
 * lock before allocating a generation or inserting a lifecycle signal.
 */
export class LiveLifecycleRaceFixture {
  stream: FixtureStream;
  viewer: FixtureViewer | null;
  hostLease: FixtureHostLease;
  readonly signals: FixtureSignal[] = [];
  streamLockCount = 0;
  viewerUpsertCount = 0;
  viewerLeaveUpdateCount = 0;
  signalPurgeCount = 0;

  private readonly initialStream: FixtureStream;
  private readonly freezeOutsideStreamReads: boolean;
  private readonly holdFirstOutsideStreamRead: boolean;
  private outsideStreamReads = 0;
  private firstOutsideReadResolve!: () => void;
  private releaseFirstOutsideReadResolve!: () => void;
  private readonly firstOutsideRead = new Promise<void>((resolve) => {
    this.firstOutsideReadResolve = resolve;
  });
  private readonly releaseFirstOutsideRead = new Promise<void>((resolve) => {
    this.releaseFirstOutsideReadResolve = resolve;
  });
  private streamLockTail: Promise<void> = Promise.resolve();
  private nextSignalId = 1;

  constructor(options: FixtureOptions) {
    this.stream = clone(options.stream);
    this.initialStream = clone(options.stream);
    this.viewer = options.viewer ? clone(options.viewer) : null;
    this.hostLease = {
      hostId: options.stream.hostId,
      streamId: options.stream.id,
      lastHeartbeatAt: clone(options.stream.lastHeartbeatAt),
    };
    this.freezeOutsideStreamReads = options.freezeOutsideStreamReads ?? false;
    this.holdFirstOutsideStreamRead =
      options.holdFirstOutsideStreamRead ?? false;
  }

  readonly db = {
    select: (_fields?: unknown) => this.select(null),
    transaction: async <T>(
      callback: (tx: unknown) => Promise<T>,
    ): Promise<T> => {
      const transaction: TransactionState = { releaseStreamLock: null };
      try {
        return await callback(this.transactionApi(transaction));
      } finally {
        transaction.releaseStreamLock?.();
      }
    },
  };

  async waitForFirstOutsideStreamRead(): Promise<void> {
    await this.firstOutsideRead;
  }

  releaseFirstOutsideStreamRead(): void {
    this.releaseFirstOutsideReadResolve();
  }

  private transactionApi(transaction: TransactionState) {
    return {
      select: (_fields?: unknown) => this.select(transaction),
      insert: (table: unknown) => this.insert(table),
      update: (table: unknown) => this.update(table),
      delete: (table: unknown) => this.delete(table),
    };
  }

  private select(transaction: TransactionState | null) {
    return {
      from: (table: unknown) => {
        if (table === streams) return this.streamSelect(transaction);
        if (table === liveViewers) return this.viewerSelect();
        if (table === liveSignals) return this.signalSelect();
        if (table === activeHostLeases) return this.hostLeaseSelect();
        throw new Error("Unexpected live lifecycle fixture select table");
      },
    };
  }

  private streamSelect(transaction: TransactionState | null) {
    return {
      where: () => {
        const query = this.thenable(() =>
          transaction ? [clone(this.stream)] : this.outsideStreamRows(),
        );
        const lockedRows = () => {
          if (!transaction) {
            throw new Error("A stream FOR UPDATE requires a transaction");
          }
          return this.lockedStreamRows(transaction);
        };
        return {
          ...query,
          for: (_mode: "update") => lockedRows(),
          orderBy: () => ({ for: (_mode: "update") => lockedRows() }),
        };
      },
    };
  }

  private lockedStreamRows(transaction: TransactionState) {
    const read = async () => {
      await this.lockStream(transaction);
      return [clone(this.stream)];
    };
    return {
      then: <TResult1 = FixtureStream[], TResult2 = never>(
        onfulfilled?:
          | ((value: FixtureStream[]) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ) => read().then(onfulfilled, onrejected),
      limit: async (_limit: number) => read(),
    };
  }

  private hostLeaseSelect() {
    return {
      where: () => ({
        for: (_mode: "update") => ({
          limit: async (_limit: number) => [clone(this.hostLease)],
        }),
      }),
    };
  }

  private viewerSelect() {
    return {
      where: () => {
        const rows = () => (this.viewer ? [clone(this.viewer)] : []);
        const query = this.thenable(rows);
        return {
          ...query,
          for: (_mode: "update") => ({
            limit: async (_limit: number) => rows(),
          }),
        };
      },
    };
  }

  private signalSelect() {
    return {
      where: () => {
        const rows = () => this.signals.map((signal) => clone(signal));
        const query = this.thenable(rows);
        return {
          ...query,
          orderBy: () => ({
            limit: async (_limit: number) => rows().slice(-1),
          }),
        };
      },
    };
  }

  private insert(table: unknown) {
    return {
      values: (values: unknown) => {
        if (table === activeHostLeases) {
          return {
            onConflictDoUpdate: async () => undefined,
          };
        }
        if (table === liveViewers) {
          const viewer = values as FixtureViewer;
          return {
            onConflictDoUpdate: async () => {
              this.viewer = clone(viewer);
              this.viewerUpsertCount += 1;
            },
          };
        }
        if (table === liveSignals) {
          const entries = Array.isArray(values) ? values : [values];
          for (const entry of entries) {
            const signal = entry as Omit<FixtureSignal, "id">;
            this.signals.push({ id: this.nextSignalId++, ...clone(signal) });
          }
          return Promise.resolve();
        }
        throw new Error("Unexpected live lifecycle fixture insert table");
      },
    };
  }

  private update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => {
        const apply = () => {
          if (table === activeHostLeases) {
            Object.assign(this.hostLease, values);
            return [];
          }
          if (table === streams) {
            Object.assign(this.stream, values);
            return [{ hostGeneration: this.stream.hostGeneration }];
          }
          if (
            table === liveViewers &&
            this.viewer &&
            this.viewer.leftAt === null
          ) {
            Object.assign(this.viewer, values);
            this.viewerLeaveUpdateCount += "leftAt" in values ? 1 : 0;
            return [{ generation: this.viewer.generation }];
          }
          return [];
        };
        const query = this.thenable(apply);
        return {
          where: () => ({
            ...query,
            returning: async (_fields?: unknown) => apply(),
          }),
        };
      },
    };
  }

  private delete(table: unknown) {
    if (table !== liveSignals) {
      throw new Error("Unexpected live lifecycle fixture delete table");
    }
    return {
      where: async () => {
        this.signalPurgeCount += 1;
      },
    };
  }

  private thenable<T>(read: () => T) {
    return {
      then: <TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ) => Promise.resolve(read()).then(onfulfilled, onrejected),
      limit: async (_limit: number) => read(),
    };
  }

  private async outsideStreamRows(): Promise<FixtureStream[]> {
    const snapshot = clone(
      this.freezeOutsideStreamReads ? this.initialStream : this.stream,
    );
    const isFirstRead = this.outsideStreamReads++ === 0;
    if (isFirstRead && this.holdFirstOutsideStreamRead) {
      this.firstOutsideReadResolve();
      await this.releaseFirstOutsideRead;
    }
    return [snapshot];
  }

  private async lockStream(transaction: TransactionState): Promise<void> {
    if (transaction.releaseStreamLock) return;
    const previous = this.streamLockTail;
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    this.streamLockTail = previous.then(() => current);
    await previous;
    transaction.releaseStreamLock = releaseCurrent;
    this.streamLockCount += 1;
  }
}
