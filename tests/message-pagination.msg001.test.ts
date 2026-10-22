import { describe, expect, it } from "vitest";
import {
  mergeMessageHistoryPages,
  MESSAGE_PAGE_DEFAULT_LIMIT,
  olderMessagePageCursor,
} from "../shared/message-pagination";
import type { Message } from "../shared/social";
import { messagesInput } from "../server/social-router";

const tiedTimestamp = "2026-10-22T12:00:00.000Z";

function syntheticMessage(id: number, createdAt = tiedTimestamp): Message {
  return {
    id,
    conversationId: 99,
    author: {
      id: 7,
      name: "Synthetic sender",
      handle: "synthetic-sender",
      bio: "",
      avatar: "",
      followers: 0,
      following: 0,
    },
    text: "",
    media: null,
    createdAt,
    read: false,
  };
}

/** Models the MSG-001 database request shape using only an in-memory synthetic fixture. */
function syntheticOlderMessagePage(
  messages: readonly Message[],
  cursor?: number,
): Message[] {
  return messages
    .filter((message) => cursor === undefined || message.id < cursor)
    .sort((left, right) => right.id - left.id)
    .slice(0, MESSAGE_PAGE_DEFAULT_LIMIT)
    .reverse();
}

describe("MSG-001 message cursor contract", () => {
  it("returns the newest page first and reaches all 501 tied-timestamp messages exactly once", () => {
    const fixture = Array.from({ length: 501 }, (_, index) =>
      syntheticMessage(index + 1),
    );
    const pages: Message[][] = [];
    let cursor: number | undefined;

    do {
      const page = syntheticOlderMessagePage(fixture, cursor);
      pages.push(page);
      cursor = olderMessagePageCursor(page);
    } while (cursor !== undefined);

    expect(pages.map((page) => page.length)).toEqual([
      100, 100, 100, 100, 100, 1,
    ]);
    expect(pages[0]?.map((message) => message.id)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 402),
    );
    expect(olderMessagePageCursor(pages[0] ?? [])).toBe(402);

    const transcript = mergeMessageHistoryPages(pages);
    expect(transcript.map((message) => message.id)).toEqual(
      Array.from({ length: 501 }, (_, index) => index + 1),
    );
    expect(new Set(transcript.map((message) => message.id)).size).toBe(501);
  });

  it("uses the ID tie-breaker at page boundaries and stops after a short or empty page", () => {
    const tiedBoundary = [
      syntheticMessage(201),
      syntheticMessage(202),
      syntheticMessage(203),
    ];
    const overlappingNewerPage = [syntheticMessage(202), syntheticMessage(203)];

    expect(
      mergeMessageHistoryPages([overlappingNewerPage, tiedBoundary]).map(
        (message) => message.id,
      ),
    ).toEqual([201, 202, 203]);
    expect(
      olderMessagePageCursor([syntheticMessage(1)], MESSAGE_PAGE_DEFAULT_LIMIT),
    ).toBeUndefined();
    expect(
      olderMessagePageCursor([], MESSAGE_PAGE_DEFAULT_LIMIT),
    ).toBeUndefined();
  });

  it("validates positive cursors and the bounded message page size at the router boundary", () => {
    expect(messagesInput.parse({ conversationId: 4 })).toEqual({
      conversationId: 4,
      limit: MESSAGE_PAGE_DEFAULT_LIMIT,
    });
    expect(
      messagesInput.parse({ conversationId: 4, cursor: 201, limit: 200 }),
    ).toEqual({
      conversationId: 4,
      cursor: 201,
      limit: 200,
    });
    expect(
      messagesInput.safeParse({ conversationId: 4, cursor: 0 }).success,
    ).toBe(false);
    expect(
      messagesInput.safeParse({ conversationId: 4, limit: 201 }).success,
    ).toBe(false);
  });
});
