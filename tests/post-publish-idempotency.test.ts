import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPostInput } from "../server/social-router";
import { postPublicationPayloadHash } from "../server/social-service";

const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const MEDIA =
  "/manus-storage/social-encrypted/7/123e4567-e89b-42d3-a456-426614174000.mp4.enc";

describe("durable post publication receipt contract", () => {
  it("keeps legacy create-post input valid and accepts only bounded safe operation IDs", () => {
    const legacy = createPostInput.parse({
      text: "Legacy publication",
      mediaType: "text",
    });
    expect(legacy).toMatchObject({
      text: "Legacy publication",
      mediaType: "text",
    });
    expect(legacy.clientPublishId).toBeUndefined();
    expect(
      createPostInput.parse({
        text: "Retry-safe publication",
        mediaType: "text",
        clientPublishId: OPERATION_ID,
      }).clientPublishId,
    ).toBe(OPERATION_ID);
    expect(
      createPostInput.parse({
        text: "Retry-safe publication",
        mediaType: "text",
        clientPublishId: "publish_op-000001",
      }).clientPublishId,
    ).toBe("publish_op-000001");

    for (const clientPublishId of [
      "too-short",
      " publish-op-000001",
      "publish op 000001",
      `a${"b".repeat(96)}`,
    ]) {
      expect(
        createPostInput.safeParse({
          text: "Invalid operation",
          mediaType: "text",
          clientPublishId,
        }).success,
      ).toBe(false);
    }
  });

  it("hashes the normalized exact payload including media type and audience", () => {
    const input = {
      text: "  Recorded caption  ",
      media: `  ${MEDIA}  `,
      mediaType: "video" as const,
      circleId: 12,
    };
    const hash = postPublicationPayloadHash(input);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      postPublicationPayloadHash({
        ...input,
        text: "Recorded caption",
        media: MEDIA,
      }),
    ).toBe(hash);
    expect(postPublicationPayloadHash({ ...input, circleId: 13 })).not.toBe(
      hash,
    );
    expect(
      postPublicationPayloadHash({ ...input, mediaType: "photo" }),
    ).not.toBe(hash);
    expect(
      postPublicationPayloadHash({ ...input, media: `${MEDIA}.other` }),
    ).not.toBe(hash);
  });

  it("declares receipts in a separate forced-RLS private schema with a deletion tombstone", () => {
    const migration = readFileSync(
      "operations/migrations/0015_circles_publish_post_receipts.sql",
      "utf8",
    );
    expect(migration).toContain("CREATE SCHEMA circles_publish");
    expect(migration).toContain(
      'CREATE TABLE circles_publish."postPublishReceipts"',
    );
    expect(migration).toContain('UNIQUE ("actorId", "operationId")');
    expect(migration).toContain(
      "REFERENCES circles_app.posts(id) ON DELETE SET NULL",
    );
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE");
    expect(migration).not.toContain("ALTER TABLE circles_app.");
  });
});
