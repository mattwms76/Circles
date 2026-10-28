import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createBatch1OperationInstance } from "../lib/batch1-mutation-feedback";
import {
  canReleaseChatEditorAuthorityLatch,
  createChatEditorAuthorityLatch,
  isExplicitChatEditorAuthorityError,
  ownProfileEditorScope,
} from "../lib/parity27-chat-editor-state";

const chatScreen = readFileSync(
  new URL("../app/chat/[id].tsx", import.meta.url),
  "utf8",
);
const profileScreen = readFileSync(
  new URL("../components/profile-screen.tsx", import.meta.url),
  "utf8",
);

describe("parity27 chat-editor authority boundaries", () => {
  it("fails closed only for structured explicit authority denials", () => {
    expect(isExplicitChatEditorAuthorityError({ code: "FORBIDDEN" })).toBe(
      true,
    );
    expect(
      isExplicitChatEditorAuthorityError({ data: { code: "UNAUTHORIZED" } }),
    ).toBe(true);
    expect(
      isExplicitChatEditorAuthorityError({
        shape: { data: { code: "FORBIDDEN" } },
      }),
    ).toBe(true);
    expect(isExplicitChatEditorAuthorityError(new Error("offline"))).toBe(
      false,
    );
    expect(
      isExplicitChatEditorAuthorityError({ data: { code: "BAD_REQUEST" } }),
    ).toBe(false);
  });

  it("cannot reopen a denied cached transcript until newer authorized metadata and transcript generations arrive", () => {
    const latch = createChatEditorAuthorityLatch({
      scope: "17:91",
      messagesDataUpdatedAt: 100,
      metadataDataUpdatedAt: 101,
    });
    const current = {
      latch,
      scope: "17:91",
      transcriptAuthorityAvailable: true,
      metadataAuthorityAvailable: true,
    };

    expect(
      canReleaseChatEditorAuthorityLatch({
        ...current,
        messagesDataUpdatedAt: 100,
        metadataDataUpdatedAt: 101,
      }),
    ).toBe(false);
    expect(
      canReleaseChatEditorAuthorityLatch({
        ...current,
        messagesDataUpdatedAt: 102,
        metadataDataUpdatedAt: 101,
      }),
    ).toBe(false);
    expect(
      canReleaseChatEditorAuthorityLatch({
        ...current,
        scope: "18:91",
        messagesDataUpdatedAt: 102,
        metadataDataUpdatedAt: 103,
      }),
    ).toBe(false);
    expect(
      canReleaseChatEditorAuthorityLatch({
        ...current,
        messagesDataUpdatedAt: 102,
        metadataDataUpdatedAt: 103,
      }),
    ).toBe(true);
  });

  it("keys an own-profile editor only to the current actor and rejects an older save activation", () => {
    expect(
      ownProfileEditorScope({
        accountId: 17,
        profileId: 17,
        ownsProfile: true,
      }),
    ).toBe("17:profile:17");
    expect(
      ownProfileEditorScope({
        accountId: 18,
        profileId: 17,
        ownsProfile: true,
      }),
    ).toBeNull();
    expect(
      ownProfileEditorScope({
        accountId: 17,
        profileId: 17,
        ownsProfile: false,
      }),
    ).toBeNull();

    const operations = createBatch1OperationInstance();
    const actorA = operations.createIdentity(17, "profile:17");
    const actorASave = operations.activate(actorA);
    const actorB = operations.createIdentity(18, "profile:18");
    const actorBView = operations.activate(actorB);

    expect(actorASave).not.toBeNull();
    expect(actorBView).not.toBeNull();
    expect(operations.isCurrent(actorASave!)).toBe(false);
    expect(operations.isCurrent(actorBView!)).toBe(true);

    const actorAReturn = operations.activate(actorA);
    expect(operations.isCurrent(actorASave!)).toBe(false);
    expect(operations.isCurrent(actorAReturn!)).toBe(true);
  });

  it("wires denial cleanup across transcript, receipt, composer, retries, and scoped profile completion", () => {
    expect(chatScreen).toContain(
      "isExplicitChatEditorAuthorityError(messages.error)",
    );
    expect(chatScreen).toContain("createChatEditorAuthorityLatch({");
    expect(chatScreen).toContain("const pendingChatAuthorityLatch =");
    expect(chatScreen).toContain(
      "if (explicitChatAuthorityLoss && activeChatAuthorityLatch === null)",
    );
    expect(chatScreen).toContain("useLayoutEffect(() => {");
    expect(chatScreen).toContain("clearLockedChatOperations();");
    expect(chatScreen).toContain("readReceipt.current = {");
    expect(chatScreen).toContain("activeCompositionOperation.current = null;");
    expect(chatScreen).toContain(
      "}, [chatAuthorityLocked, compositionScope]);",
    );
    expect(chatScreen).toContain(
      "if (isExplicitChatEditorAuthorityError(error))",
    );
    expect(chatScreen).toContain("!chatAuthorityLocked && deliveryUncertain");
    expect(chatScreen).toContain("!chatAuthorityLocked && (");
    expect(chatScreen).toContain(") : chatAuthorityLocked ? (");

    expect(profileScreen).toContain("ownProfileEditorScope({");
    expect(profileScreen).toContain("function OwnProfileActions({");
    expect(profileScreen).toContain("key={profileEditorScope}");
    expect(profileScreen).toContain("profileUpdateInstance.isCurrent(scope)");
    expect(profileScreen).toContain("batch1OperationIdentityMatches(");
    expect(profileScreen).toContain(
      "onSave={(draft) => requireAuth(() => saveOwnProfile(draft))}",
    );
    expect(profileScreen).not.toContain("profileEditorScopeRef");
  });
});
