import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conversationParticipants,
  conversations,
  follows,
  messages,
  profiles,
  socialUploads,
} from "../drizzle/schema";

import { sendMessage } from "../server/social-service";

const messageDbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: messageDbMock.getDb }));

afterEach(() => messageDbMock.getDb.mockReset());

const USER_ID = 7;
const CONVERSATION_ID = 50;
const CLIENT_MESSAGE_ID = "client-message-id-0001";
const MEDIA =
  "/manus-storage/social-encrypted/7/123e4567-e89b-42d3-a456-426614174000.jpg.enc";

type ExistingMessage = {
  id: number;
  conversationId: number;
  authorId: number;
  text: string;
  media: string | null;
  createdAt: Date;
};

function createMessageTransactionFixture(
  existing: ExistingMessage | undefined,
) {
  const writes: string[] = [];
  const query = <T>(rows: T[]) => {
    const value = {
      for: async () => rows,
      then: <Output>(
        resolve: (result: T[]) => Output | PromiseLike<Output>,
        reject?: (reason: unknown) => Output | PromiseLike<Output>,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    return {
      limit: () => value,
      orderBy: () => value,
      then: value.then,
    };
  };
  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === conversations) {
            return query([
              {
                id: CONVERSATION_ID,
                kind: "direct",
                circleId: null,
                directKey: "7:8",
              },
            ]);
          }
          if (table === conversationParticipants) return query([{ id: 1 }]);
          if (table === messages) return query(existing ? [existing] : []);
          if (table === socialUploads) {
            return query([
              {
                id: 3,
                storageKey:
                  "social-encrypted/7/123e4567-e89b-42d3-a456-426614174000.jpg.enc",
                url: MEDIA,
              },
            ]);
          }
          if (table === profiles) {
            return query([
              {
                userId: USER_ID,
                name: "Sender",
                handle: "sender",
                bio: "",
                avatar: "",
                cover: null,
              },
            ]);
          }
          if (table === follows && fields && "total" in fields)
            return query([{ total: 0 }]);
          if (table === follows) return query([]);
          throw new Error("Unexpected synthetic message query");
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: () => {
        if (table !== messages)
          throw new Error("Unexpected synthetic message insert");
        writes.push("insert-message");
        return {
          returning: async () => [
            {
              id: 101,
              conversationId: CONVERSATION_ID,
              authorId: USER_ID,
              text: "first",
              media: MEDIA,
              createdAt: new Date("2026-10-23T12:00:00.000Z"),
            },
          ],
        };
      },
    }),
    update: (table: unknown) => ({
      set: () => ({
        where: async () => {
          if (table === socialUploads) writes.push("claim-upload");
          else if (table === conversations) writes.push("update-conversation");
          else throw new Error("Unexpected synthetic message update");
        },
      }),
    }),
    transaction: async <T>(callback: (tx: object) => Promise<T>) =>
      callback(db),
  };
  return { db, writes };
}

describe("durable client message nonce transaction", () => {
  it("rejects a changed-payload retry before any new attachment insert or claim", async () => {
    const fixture = createMessageTransactionFixture({
      id: 100,
      conversationId: CONVERSATION_ID,
      authorId: USER_ID,
      text: "first",
      media: null,
      createdAt: new Date("2026-10-23T12:00:00.000Z"),
    });
    messageDbMock.getDb.mockResolvedValue(fixture.db);

    await expect(
      sendMessage(USER_ID, CONVERSATION_ID, {
        text: "changed",
        clientMessageId: CLIENT_MESSAGE_ID,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.writes).toEqual([]);
  });

  it("claims an owned upload only after the message insert and before the transaction recency update", async () => {
    const fixture = createMessageTransactionFixture(undefined);
    messageDbMock.getDb.mockResolvedValue(fixture.db);

    await expect(
      sendMessage(USER_ID, CONVERSATION_ID, {
        text: "first",
        media: MEDIA,
        clientMessageId: CLIENT_MESSAGE_ID,
      }),
    ).resolves.toMatchObject({ id: 101, media: MEDIA });
    expect(fixture.writes).toEqual([
      "insert-message",
      "claim-upload",
      "update-conversation",
    ]);
  });
});
