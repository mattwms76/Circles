import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LIVE_CHAT_RATE_WINDOW_MS,
  LIVE_REACTION_RATE_WINDOW_MS,
  MAX_LIVE_CHAT_PER_PARTICIPANT_PER_WINDOW,
  MAX_LIVE_CHAT_ROWS_PER_PARTICIPANT,
  MAX_LIVE_CHAT_ROWS_PER_STREAM,
  MAX_LIVE_REACTIONS_PER_PARTICIPANT_PER_WINDOW,
  liveChatRateWindowMs,
  wouldExceedLiveChatAdmission,
} from "../shared/live-chat-limits";

const liveRouterSource = readFileSync(
  new URL("../server/live-router.ts", import.meta.url),
  "utf8",
);
const liveSchemaSource = readFileSync(
  new URL("../drizzle/live-schema.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../operations/migrations/0024_circles_live_chat_bounds.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("CBA-04 live chat admission contract", () => {
  it("permits a bounded chat burst but rejects every durable chat boundary", () => {
    expect(liveChatRateWindowMs("chat")).toBe(LIVE_CHAT_RATE_WINDOW_MS);
    expect(
      wouldExceedLiveChatAdmission("chat", {
        streamRows: MAX_LIVE_CHAT_ROWS_PER_STREAM - 1,
        participantRows: MAX_LIVE_CHAT_ROWS_PER_PARTICIPANT - 1,
        recentParticipantRows: MAX_LIVE_CHAT_PER_PARTICIPANT_PER_WINDOW - 1,
      }),
    ).toBe(false);
    expect(
      wouldExceedLiveChatAdmission("chat", {
        streamRows: MAX_LIVE_CHAT_ROWS_PER_STREAM,
        participantRows: 0,
        recentParticipantRows: 0,
      }),
    ).toBe(true);
    expect(
      wouldExceedLiveChatAdmission("chat", {
        streamRows: 0,
        participantRows: MAX_LIVE_CHAT_ROWS_PER_PARTICIPANT,
        recentParticipantRows: 0,
      }),
    ).toBe(true);
    expect(
      wouldExceedLiveChatAdmission("chat", {
        streamRows: 0,
        participantRows: 0,
        recentParticipantRows: MAX_LIVE_CHAT_PER_PARTICIPANT_PER_WINDOW,
      }),
    ).toBe(true);
  });

  it("applies a materially tighter independent reaction policy", () => {
    expect(liveChatRateWindowMs("reaction")).toBe(LIVE_REACTION_RATE_WINDOW_MS);
    expect(LIVE_REACTION_RATE_WINDOW_MS).toBeLessThan(LIVE_CHAT_RATE_WINDOW_MS);
    expect(MAX_LIVE_REACTIONS_PER_PARTICIPANT_PER_WINDOW).toBeLessThan(
      MAX_LIVE_CHAT_PER_PARTICIPANT_PER_WINDOW,
    );
    expect(
      wouldExceedLiveChatAdmission("reaction", {
        streamRows: 0,
        participantRows: 0,
        recentParticipantRows: 0,
      }),
    ).toBe(false);
    expect(
      wouldExceedLiveChatAdmission("reaction", {
        streamRows: 0,
        participantRows: 0,
        recentParticipantRows: MAX_LIVE_REACTIONS_PER_PARTICIPANT_PER_WINDOW,
      }),
    ).toBe(true);
  });

  it("takes the established stream lock and rechecks participation before each bounded insert", () => {
    const chatStart = liveRouterSource.indexOf("sendChat: protectedProcedure");
    const reactStart = liveRouterSource.indexOf(
      "react: protectedProcedure",
      chatStart,
    );
    const chat = liveRouterSource.slice(chatStart, reactStart);
    const reaction = liveRouterSource.slice(reactStart);

    for (const operation of [chat, reaction]) {
      const lock = operation.indexOf("const stream = await lockLiveStream");
      const participant = operation.indexOf(
        "await assertActiveParticipantInTransaction",
      );
      const admission = operation.indexOf(
        "await assertLiveChatAdmissionInTransaction",
      );
      const insert = operation.indexOf("await tx.insert(liveChat)");
      expect(lock).toBeGreaterThan(-1);
      expect(lock).toBeLessThan(participant);
      expect(participant).toBeLessThan(admission);
      expect(admission).toBeLessThan(insert);
    }
  });

  it("declares poll and participant admission indexes without rewriting the baseline", () => {
    expect(liveSchemaSource).toContain("live_chat_stream_created_id_idx");
    expect(liveSchemaSource).toContain("live_chat_stream_user_created_idx");
    expect(migrationSource).toContain(
      "CREATE INDEX IF NOT EXISTS live_chat_stream_created_id_idx",
    );
    expect(migrationSource).toContain(
      "CREATE INDEX IF NOT EXISTS live_chat_stream_user_created_idx",
    );
    expect(migrationSource).toContain('"streamId", "createdAt" DESC, id DESC');
    expect(migrationSource).not.toMatch(
      /DELETE\s+FROM\s+circles_app\."liveChat"/i,
    );
  });
});
