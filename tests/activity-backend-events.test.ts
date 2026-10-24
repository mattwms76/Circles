import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  recordCommentActivity,
  recordMembershipApprovalActivity,
} from "../server/activity-events";

describe("activity source-event safety", () => {
  it("suppresses self events without touching the transaction", async () => {
    const untouched = {} as never;
    await expect(
      recordCommentActivity(untouched, {
        recipientId: 7,
        actorId: 7,
        sourceId: 31,
        postId: 19,
        circleId: null,
      }),
    ).resolves.toBeUndefined();
    await expect(
      recordMembershipApprovalActivity(untouched, {
        recipientId: 7,
        actorId: 7,
        sourceId: 32,
        circleId: 9,
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps event creation after actual social writes and preserves stable source IDs", () => {
    const social = readFileSync("server/social-service.ts", "utf8");
    const comment = social.slice(
      social.indexOf("export async function createComment"),
      social.indexOf("export async function deletePost"),
    );
    const approval = social.slice(
      social.indexOf("export async function approveMember"),
      social.indexOf("export async function createPost"),
    );
    expect(comment.indexOf(".insert(comments)")).toBeLessThan(
      comment.indexOf("recordCommentActivity"),
    );
    expect(comment).toContain("sourceId: row.id");
    expect(approval.indexOf(".returning({ id: memberships.id })")).toBeLessThan(
      approval.indexOf("recordMembershipApprovalActivity"),
    );
    expect(approval).toContain("sourceId: membershipId");
  });

  it("declares exact private table ordering, runtime-only RLS policy names, and no global grant", () => {
    const migration = readFileSync(
      "operations/migrations/0010_circles_activity_inbox.sql",
      "utf8",
    );
    const table = migration.slice(
      migration.indexOf('CREATE TABLE circles_app."activityItems"'),
      migration.indexOf('CREATE TABLE circles_app."activityPreferences"'),
    );
    expect(table).toMatch(
      /id integer[\s\S]*"recipientId"[\s\S]*"actorId"[\s\S]*kind[\s\S]*"sourceId"[\s\S]*"circleId"[\s\S]*"postId"[\s\S]*"createdAt"[\s\S]*"readAt"/,
    );
    for (const policy of [
      "runtime_activity_items_policy",
      "runtime_activity_preferences_policy",
      "runtime_activity_circle_preferences_policy",
    ]) {
      expect(migration).toContain(`CREATE POLICY ${policy}`);
    }
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain(
      'GRANT USAGE, SELECT ON SEQUENCE circles_app."activityItems_id_seq"',
    );
    expect(migration).toContain(
      "FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).not.toContain("ALTER DEFAULT PRIVILEGES");
  });
});
