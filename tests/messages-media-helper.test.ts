import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createMessageCompositionRetryId,
  readReceiptRetryDelayMs,
} from "../lib/message-composition";
import {
  nativeMediaRequestKey,
  nativeMediaTokenForRequest,
} from "../lib/media-cache";

vi.mock("expo-image", () => ({
  Image: {
    clearMemoryCache: vi.fn(),
    clearDiskCache: vi.fn(),
  },
}));

const chatScreen = readFileSync(
  new URL("../app/chat/[id].tsx", import.meta.url),
  "utf8",
);
const personRoute = readFileSync(
  new URL("../app/person/[id].tsx", import.meta.url),
  "utf8",
);
const profileScreen = readFileSync(
  new URL("../components/profile-screen.tsx", import.meta.url),
  "utf8",
);
const inboxScreen = readFileSync(
  new URL("../app/(tabs)/messages.tsx", import.meta.url),
  "utf8",
);
const mediaImage = readFileSync(
  new URL("../components/media-image.tsx", import.meta.url),
  "utf8",
);

describe("messages/profile/media UI retry controls", () => {
  it("creates a cryptographic UUID operation ID and bounds receipt retries", () => {
    expect(createMessageCompositionRetryId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(readReceiptRetryDelayMs(1)).toBe(250);
    expect(readReceiptRetryDelayMs(2)).toBe(1_000);
    expect(readReceiptRetryDelayMs(3)).toBeNull();
    expect(readReceiptRetryDelayMs(0)).toBeNull();
  });

  it("never accepts a stale account or URI bearer while a native request is pending", () => {
    const firstRequest = nativeMediaRequestKey(
      17,
      "https://api.example/api/media/synthetic-a",
    );
    const secondRequest = nativeMediaRequestKey(
      18,
      "https://api.example/api/media/synthetic-a",
    );
    const oldUriRequest = nativeMediaRequestKey(
      17,
      "https://api.example/api/media/synthetic-b",
    );
    const settled = {
      requestKey: firstRequest,
      settled: true,
      token: "synthetic-token",
    };

    expect(nativeMediaTokenForRequest(settled, firstRequest)).toBe(
      "synthetic-token",
    );
    expect(nativeMediaTokenForRequest(settled, secondRequest)).toBeNull();
    expect(nativeMediaTokenForRequest(settled, oldUriRequest)).toBeNull();
    expect(
      nativeMediaTokenForRequest(
        { requestKey: secondRequest, settled: false, token: null },
        secondRequest,
      ),
    ).toBeNull();
  });

  it("keeps one message operation and upload across an explicit uncertain retry", () => {
    expect(chatScreen).toContain(
      "compositionRetryId.current ?? createMessageCompositionRetryId()",
    );
    expect(chatScreen).toContain("uploadedMediaUrl.current ?? undefined");
    expect(chatScreen).toContain("clientMessageId,");
    expect(chatScreen).toContain("setUncertainDeliveryOperation(operation)");
    expect(chatScreen).toContain("isCurrentMessageCompositionOperation(");
    expect(chatScreen).toContain("if (sendWasAttempted)");
    expect(chatScreen).toContain("Retry message delivery");
    expect(chatScreen).toContain(
      "readReceiptRetryDelayMs(state.failedAttempts)",
    );
    expect(chatScreen).toContain("acknowledgedThrough");
  });

  it("rejects malformed person routes and invalidates all visible embedded identities", () => {
    expect(personRoute).toContain("/^[1-9]\\d*$/");
    expect(personRoute).toContain("invalidPersonRoute");
    expect(profileScreen).toContain("invalidateProfileViews(utils)");
    const policy = readFileSync(
      new URL("../lib/source-query-invalidation.ts", import.meta.url),
      "utf8",
    );
    const profilePolicy = policy.slice(
      policy.indexOf("export async function invalidateProfileViews"),
      policy.indexOf("export async function invalidateModerationViews"),
    );
    for (const reader of [
      "feed",
      "feedPage",
      "conversations",
      "profile",
      "profiles",
      "profilesPage",
    ]) {
      expect(profilePolicy).toContain(`utils.social.${reader},`);
    }
  });

  it("uses a real empty-conversation fallback and defers protected native media", () => {
    expect(inboxScreen).toContain(
      'conversation.lastMessage || "No messages yet."',
    );
    expect(inboxScreen).not.toContain(
      'conversation.lastMessage || "Say something kind."',
    );
    expect(mediaImage).toContain("if (!token) return null");
    expect(mediaImage).toContain(
      "nativeMediaRequestKey(user?.id, resolvedUri)",
    );
  });
});
