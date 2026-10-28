import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import {
  postPublishReceiptInsertProjection,
  postPublishReceipts,
} from "../drizzle/post-publish-receipt-schema";

describe("post publication receipt insert projection", () => {
  it("constructs a claim valid for both legacy five-column and current six-column receipt relations", () => {
    const query = drizzle
      .mock()
      .insert(postPublishReceiptInsertProjection())
      .values({
        actorId: 1,
        operationId: "publish-projection-01",
        payloadHash: "a".repeat(64),
      })
      .onConflictDoNothing({
        target: [postPublishReceipts.actorId, postPublishReceipts.operationId],
      })
      .returning({ postId: postPublishReceiptInsertProjection().postId })
      .toSQL();

    expect(query.sql).toContain(
      '("actorId", "operationId", "payloadHash", "postId")',
    );
    expect(query.sql).toContain(
      'on conflict ("actorId","operationId") do nothing',
    );
    expect(query.sql).not.toContain('"id"');
    expect(query.sql).not.toContain('"createdAt"');
    expect(query.params).toEqual([1, "publish-projection-01", "a".repeat(64)]);
  });
});
