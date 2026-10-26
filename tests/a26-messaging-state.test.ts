import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { conversationAccessibility } from "../lib/batch2-message-accessibility";
import {
  authorizedConversationMetadata,
  inboxMatchState,
  isDefinitiveMessageApplicationError,
  MAX_MESSAGE_TEXT_LENGTH,
  messageTextIsWithinLimit,
  positiveSafeConversationId,
  visibleUnreadCount,
} from "../lib/a26-messaging-state";

const inbox = readFileSync("app/(tabs)/messages.tsx", "utf8");
const chat = readFileSync("app/chat/[id].tsx", "utf8");

describe("A26 messaging state", () => {
  it("accepts only one positive safe-integer chat route ID", () => {
    expect(positiveSafeConversationId("42")).toBe(42);
    expect(positiveSafeConversationId("00042")).toBeNull();
    expect(positiveSafeConversationId("0")).toBeNull();
    expect(positiveSafeConversationId("-1")).toBeNull();
    expect(positiveSafeConversationId("1.5")).toBeNull();
    expect(positiveSafeConversationId("not-a-number")).toBeNull();
    expect(positiveSafeConversationId("9007199254740992")).toBeNull();
    expect(positiveSafeConversationId(["42", "43"])).toBeNull();
    expect(positiveSafeConversationId(undefined)).toBeNull();
  });

  it("mirrors the trimmed 10,000-character message cap without clearing a draft", () => {
    expect(messageTextIsWithinLimit("x".repeat(MAX_MESSAGE_TEXT_LENGTH))).toBe(
      true,
    );
    expect(
      messageTextIsWithinLimit("x".repeat(MAX_MESSAGE_TEXT_LENGTH + 1)),
    ).toBe(false);
    expect(
      messageTextIsWithinLimit(
        `${" ".repeat(4)}${"x".repeat(MAX_MESSAGE_TEXT_LENGTH)}${" ".repeat(4)}`,
      ),
    ).toBe(true);
  });

  it("treats structured tRPC responses as definitive while retaining ambiguity for transport failures", () => {
    expect(
      isDefinitiveMessageApplicationError({
        data: { code: "FORBIDDEN" },
      }),
    ).toBe(true);
    expect(
      isDefinitiveMessageApplicationError({
        shape: { data: { code: "BAD_REQUEST" } },
      }),
    ).toBe(true);
    expect(
      isDefinitiveMessageApplicationError(new TypeError("fetch failed")),
    ).toBe(false);
    expect(isDefinitiveMessageApplicationError({ code: "ECONNRESET" })).toBe(
      false,
    );
  });

  it("uses only the authorized response item for chat metadata", () => {
    const conversations = [
      { id: 7, name: "Approved conversation" },
      { id: 8, name: "Different conversation" },
    ];
    expect(authorizedConversationMetadata(conversations, 7)?.name).toBe(
      "Approved conversation",
    );
    expect(authorizedConversationMetadata(conversations, 9)).toBeNull();
    expect(authorizedConversationMetadata(conversations, 0)).toBeNull();
  });

  it("distinguishes true inbox emptiness from active criteria with no matches", () => {
    expect(
      inboxMatchState({
        conversationCount: 0,
        filteredCount: 0,
        filter: "All",
        search: "",
      }),
    ).toBe("empty");
    expect(
      inboxMatchState({
        conversationCount: 3,
        filteredCount: 0,
        filter: "Direct",
        search: "",
      }),
    ).toBe("no-match");
    expect(
      inboxMatchState({
        conversationCount: 3,
        filteredCount: 0,
        filter: "All",
        search: "nobody",
      }),
    ).toBe("no-match");
    expect(
      inboxMatchState({
        conversationCount: 3,
        filteredCount: 2,
        filter: "All",
        search: "",
      }),
    ).toBe("content");
  });

  it("caps only the visual unread badge while preserving the exact accessible value", () => {
    expect(visibleUnreadCount(999)).toBe("999");
    expect(visibleUnreadCount(1_000)).toBe("999+");
    expect(conversationAccessibility("Maya", 1_000).value).toBe(
      "1000 unread messages",
    );
  });

  it("wires auth-gated verified chat metadata and preserves the edit recovery seam", () => {
    expect(chat).toContain("positiveSafeConversationId(id)");
    expect(chat).toContain('title="This conversation link is invalid."');
    expect(chat).toContain("viewerScope: user?.id");
    expect(chat).toContain("enabled: canLoadProtectedChat");
    expect(chat).toContain("authorizedConversationMetadata(");
    expect(chat).toContain('authState === "error"');
    expect(chat).toContain("onAction={refresh}");
    expect(chat).toContain("isDefinitiveMessageApplicationError(error)");
    expect(chat).toContain("compositionRetryId.current = null;");
    expect(chat).toContain("maxLength={MAX_MESSAGE_TEXT_LENGTH}");
  });

  it("wires clearable no-match inbox state and capped visual unread text", () => {
    expect(inbox).toContain('matchState === "no-match"');
    expect(inbox).toContain('action="Clear search and filters"');
    expect(inbox).toContain('setSearch("")');
    expect(inbox).toContain('setFilter("All")');
    expect(inbox).toContain("visibleUnreadCount(conversation.unread)");
    expect(inbox).toContain(
      "accessibilityValue={{ text: accessibility.value }}",
    );
    expect(inbox).toContain("router.push(`/chat/${conversation.id}`)");
  });
});
