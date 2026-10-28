import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conversationParticipants,
  conversations,
  follows,
  profiles,
  users,
} from "../drizzle/schema";
import { openDirect } from "../server/social-service";

const dbMocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: dbMocks.getDb }));

afterEach(() => dbMocks.getDb.mockReset());

const FIRST_USER_ID = 101;
const SECOND_USER_ID = 202;

type SyntheticConversation = { id: number; directKey: string };
type TransactionState = {
  id: number;
  createdConversation: SyntheticConversation | null;
  firstConversationRead: boolean;
  participantWrites: { conversationId: number; userId: number }[];
};

type SyntheticDirectFixtureOptions = {
  failBeforeSecondParticipant?: boolean;
  synchronizeInitialDirectReads?: boolean;
};

/**
 * This is a credential-free, transaction-aware Drizzle-shaped fixture. It buffers every direct
 * conversation and participant write until the callback completes, then makes the unique-key
 * winner visible. A competing insert waits for that winner before its fallback read, matching the
 * service's ON CONFLICT DO NOTHING then SELECT retry shape. It is not a PostgreSQL integration
 * test; DB-15.md records that boundary explicitly.
 */
function createSyntheticDirectFixture(
  options: SyntheticDirectFixtureOptions = {},
) {
  let nextConversationId = 700;
  let nextTransactionId = 0;
  let committedConversation: SyntheticConversation | null = null;
  const committedParticipants = new Map<number, Set<number>>();
  let pendingConversation:
    | (SyntheticConversation & {
        ownerTransactionId: number;
        completion: Promise<void>;
        resolve: () => void;
      })
    | null = null;
  let transactionCalls = 0;
  let initialReadArrivals = 0;
  let releaseInitialReads: (() => void) | undefined;
  const initialReadsReleased = new Promise<void>((resolve) => {
    releaseInitialReads = resolve;
  });
  let failBeforeSecondParticipant =
    options.failBeforeSecondParticipant ?? false;

  const profileFor = (userId: number) => ({
    id: userId,
    userId,
    name: `Member ${userId}`,
    handle: `member-${userId}`,
    bio: "",
    avatar: "",
    cover: null,
  });

  const rows = <T>(read: () => T[] | Promise<T[]>) => {
    const readRows = () => Promise.resolve(read());
    return {
      limit: () => readRows(),
      then: <Result>(
        resolve: (value: T[]) => Result | PromiseLike<Result>,
        reject?: (reason: unknown) => Result | PromiseLike<Result>,
      ) => readRows().then(resolve, reject),
    };
  };

  const initialConversationRead = async (transaction: TransactionState) => {
    const snapshot = committedConversation
      ? [{ ...committedConversation }]
      : [];
    if (!transaction.firstConversationRead) {
      transaction.firstConversationRead = true;
      if (options.synchronizeInitialDirectReads) {
        initialReadArrivals += 1;
        if (initialReadArrivals === 2) releaseInitialReads?.();
        await initialReadsReleased;
      }
    }
    return snapshot;
  };

  const conversationRows = (transaction: TransactionState) =>
    rows(() =>
      transaction.firstConversationRead
        ? committedConversation
          ? [{ ...committedConversation }]
          : []
        : initialConversationRead(transaction),
    );

  const selectFor = (transaction: TransactionState | null) => () => ({
    from: (table: unknown) => ({
      where: () => {
        if (table === users) return rows(() => [{ id: SECOND_USER_ID }]);
        if (table === profiles) {
          return rows(() => [profileFor(FIRST_USER_ID)]);
        }
        if (table === follows) return rows(() => []);
        if (table === conversations && transaction) {
          return conversationRows(transaction);
        }
        throw new Error("Unexpected synthetic DB-15 select");
      },
    }),
  });

  const stageConversation = async (transaction: TransactionState) => {
    if (committedConversation) return [];
    if (pendingConversation?.ownerTransactionId === transaction.id) {
      return [{ id: pendingConversation.id }];
    }
    if (pendingConversation) {
      await pendingConversation.completion;
      return [];
    }

    let resolveCompletion: (() => void) | undefined;
    const created: SyntheticConversation = {
      id: nextConversationId++,
      directKey: `${FIRST_USER_ID}:${SECOND_USER_ID}`,
    };
    pendingConversation = {
      ...created,
      ownerTransactionId: transaction.id,
      completion: new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      }),
      resolve: () => resolveCompletion?.(),
    };
    transaction.createdConversation = created;
    return [{ id: created.id }];
  };

  const insertFor = (transaction: TransactionState) => (table: unknown) => ({
    values: (value: {
      kind?: string;
      directKey?: string;
      conversationId?: number;
      userId?: number;
    }) => {
      if (table === conversations) {
        if (
          value.kind !== "direct" ||
          value.directKey !== `${FIRST_USER_ID}:${SECOND_USER_ID}`
        ) {
          throw new Error("Direct key was not canonically ordered");
        }
        return {
          onConflictDoNothing: (config: { target?: unknown }) => {
            if (config.target !== conversations.directKey) {
              throw new Error("Expected the direct-key conflict target");
            }
            return { returning: () => stageConversation(transaction) };
          },
        };
      }

      if (table === conversationParticipants) {
        const conversationId = value.conversationId;
        const userId = value.userId;
        if (
          conversationId === undefined ||
          userId === undefined ||
          ![FIRST_USER_ID, SECOND_USER_ID].includes(userId)
        ) {
          throw new Error("Unexpected synthetic participant identity");
        }
        return {
          onConflictDoNothing: async (config: { target?: unknown[] }) => {
            if (
              !Array.isArray(config.target) ||
              !config.target.includes(
                conversationParticipants.conversationId,
              ) ||
              !config.target.includes(conversationParticipants.userId)
            ) {
              throw new Error("Expected the participant-pair conflict target");
            }
            if (
              failBeforeSecondParticipant &&
              transaction.participantWrites.length === 1
            ) {
              throw new Error(
                "synthetic failure between direct participant writes",
              );
            }
            transaction.participantWrites.push({
              conversationId,
              userId,
            });
          },
        };
      }

      throw new Error("Unexpected synthetic DB-15 insert");
    },
  });

  const transaction = async <T>(callback: (tx: object) => Promise<T>) => {
    transactionCalls += 1;
    const state: TransactionState = {
      id: ++nextTransactionId,
      createdConversation: null,
      firstConversationRead: false,
      participantWrites: [],
    };
    const tx = {
      select: selectFor(state),
      insert: insertFor(state),
    };

    try {
      const result = await callback(tx);
      if (state.createdConversation) {
        committedConversation = state.createdConversation;
      }
      for (const { conversationId, userId } of state.participantWrites) {
        const participants =
          committedParticipants.get(conversationId) ?? new Set();
        participants.add(userId);
        committedParticipants.set(conversationId, participants);
      }
      if (pendingConversation?.ownerTransactionId === state.id) {
        pendingConversation.resolve();
        pendingConversation = null;
      }
      return result;
    } catch (error) {
      if (pendingConversation?.ownerTransactionId === state.id) {
        pendingConversation.resolve();
        pendingConversation = null;
      }
      throw error;
    }
  };

  const database = {
    select: selectFor(null),
    transaction,
  };

  return {
    database,
    conversation: () => committedConversation,
    participants: () =>
      committedConversation
        ? [
            ...(committedParticipants.get(committedConversation.id) ??
              new Set()),
          ].sort((first, second) => first - second)
        : [],
    setFailBeforeSecondParticipant: (value: boolean) => {
      failBeforeSecondParticipant = value;
    },
    transactionCalls: () => transactionCalls,
  };
}

describe("DB-15 direct conversation atomicity", () => {
  it("preserves self and missing-target validation before opening a transaction", async () => {
    await expect(
      openDirect(FIRST_USER_ID, FIRST_USER_ID),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(dbMocks.getDb).not.toHaveBeenCalled();

    const missingTarget = createSyntheticDirectFixture();
    const unavailableTargetDatabase = {
      ...missingTarget.database,
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      }),
    };
    dbMocks.getDb.mockResolvedValue(unavailableTargetDatabase as never);

    await expect(
      openDirect(FIRST_USER_ID, SECOND_USER_ID),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(missingTarget.transactionCalls()).toBe(0);
  });

  it("rolls back the conversation and first participant when the second participant write faults", async () => {
    const fixture = createSyntheticDirectFixture({
      failBeforeSecondParticipant: true,
    });
    dbMocks.getDb.mockResolvedValue(fixture.database as never);

    await expect(openDirect(FIRST_USER_ID, SECOND_USER_ID)).rejects.toThrow(
      "synthetic failure between direct participant writes",
    );
    expect(fixture.conversation()).toBeNull();
    expect(fixture.participants()).toEqual([]);
    expect(fixture.transactionCalls()).toBe(1);

    fixture.setFailBeforeSecondParticipant(false);
    await expect(openDirect(FIRST_USER_ID, SECOND_USER_ID)).resolves.toEqual({
      id: 701,
    });
    expect(fixture.conversation()).toEqual({
      id: 701,
      directKey: `${FIRST_USER_ID}:${SECOND_USER_ID}`,
    });
    expect(fixture.participants()).toEqual([FIRST_USER_ID, SECOND_USER_ID]);
  });

  it("resolves overlapping canonical-order retries to one complete direct conversation", async () => {
    const fixture = createSyntheticDirectFixture({
      synchronizeInitialDirectReads: true,
    });
    dbMocks.getDb.mockResolvedValue(fixture.database as never);

    const [first, second] = await Promise.all([
      openDirect(FIRST_USER_ID, SECOND_USER_ID),
      openDirect(SECOND_USER_ID, FIRST_USER_ID),
    ]);

    expect(first).toEqual({ id: 700 });
    expect(second).toEqual({ id: 700 });
    expect(fixture.conversation()).toEqual({
      id: 700,
      directKey: `${FIRST_USER_ID}:${SECOND_USER_ID}`,
    });
    expect(fixture.participants()).toEqual([FIRST_USER_ID, SECOND_USER_ID]);
    expect(fixture.transactionCalls()).toBe(2);
  });
});
