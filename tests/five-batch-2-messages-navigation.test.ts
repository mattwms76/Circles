import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canSendMessage,
  conversationAccessibility,
  isCurrentMessageCompositionOperation,
} from "../lib/batch2-message-accessibility";
import { contrastRatio } from "../lib/ui-accessibility";

const inbox = readFileSync("app/(tabs)/messages.tsx", "utf8");
const chat = readFileSync("app/chat/[id].tsx", "utf8");
const person = readFileSync("app/person/[id].tsx", "utf8");

describe("Batch 2 messages and navigation accessibility", () => {
  it("names conversations with a truthful unread value", () => {
    expect(conversationAccessibility("  Maya  ", 1)).toEqual({
      label: "Open conversation with Maya",
      value: "1 unread message",
    });
    expect(conversationAccessibility("", 3)).toEqual({
      label: "Open conversation with conversation",
      value: "3 unread messages",
    });
    expect(conversationAccessibility("Circle friends", -2).value).toBe(
      "No unread messages",
    );
  });

  it("accepts only nonblank message text or an intentionally selected attachment", () => {
    expect(canSendMessage("", false)).toBe(false);
    expect(canSendMessage(" \n\t ", false)).toBe(false);
    expect(canSendMessage("Hello", false)).toBe(true);
    expect(canSendMessage("   ", true)).toBe(true);
  });

  it("rejects stale account or conversation completions, including an account that switches back", () => {
    const initial = { scope: "7:50", generation: 4 };
    expect(isCurrentMessageCompositionOperation(initial, initial)).toBe(true);
    expect(
      isCurrentMessageCompositionOperation(
        { scope: "8:50", generation: 5 },
        initial,
      ),
    ).toBe(false);
    expect(
      isCurrentMessageCompositionOperation(
        { scope: "7:50", generation: 6 },
        initial,
      ),
    ).toBe(false);
  });

  it("keeps inbox rows programmatically actionable, flexible, and at compliant unread-badge contrast", () => {
    expect(inbox).toContain('accessibilityRole="button"');
    expect(inbox).toContain("accessibilityLabel={accessibility.label}");
    expect(inbox).toContain(
      "accessibilityValue={{ text: accessibility.value }}",
    );
    expect(inbox).toContain('accessibilityLabel="Search conversations"');
    expect(inbox).toContain('flexWrap: "wrap"');
    expect(inbox).toContain("minHeight: 44");
    expect(inbox).toContain("backgroundColor: C.action");
    expect(inbox).toContain("color: C.actionText");
    expect(contrastRatio("#FFFFFF", "#A53728")).toBeGreaterThanOrEqual(4.5);
  });

  it("makes history and compose controls 44-point named buttons with pending state", () => {
    expect(chat).toContain('accessibilityLabel="Load earlier messages"');
    expect(chat).toContain(
      'accessibilityLabel="Retry loading earlier messages"',
    );
    expect(chat).toContain("busy: isFetchingEarlierMessages");
    expect(chat).toContain('accessibilityLabel="Message text"');
    expect(chat).toContain("const sendDisabled = !hasSendableMessage");
    expect(chat).toContain("disabled={sendDisabled}");
    expect(chat).toContain("busy: send.isPending || sendingMedia");
    expect(chat).toContain('label="Remove selected attachment"');
  });

  it("uses truthful generic attachment labels while retaining idempotent retry and inbox fallback navigation", () => {
    expect(chat).toContain('accessibilityLabel="Photo attachment"');
    expect(chat).toContain('accessibilityLabel="Video attachment"');
    expect(chat).toContain('"Selected video attachment"');
    expect(chat).toContain("createMessageCompositionRetryId()");
    expect(chat).toContain("uploadedMediaUrl.current ?? undefined");
    expect(chat).toContain("clientMessageId,");
    expect(chat).toContain(
      "router.canGoBack() ? router.back() : router.replace",
    );
    expect(person).toContain("positiveSafeInteger");
    expect(person).toContain("invalidPersonRoute");
  });
});
