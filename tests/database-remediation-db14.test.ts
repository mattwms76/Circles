import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DATABASE_READINESS_SQL,
  EMAIL_IDENTITY_READINESS_SQL,
  MESSAGE_AUTHORIZATION_FUNCTION_PROSRC_MD5,
  POST_PUBLICATION_STATUS_SQL,
  getPostPublicationStatus,
  postPublicationStatusFromEvidence,
} from "../server/_core/database-contracts";

vi.mock("../server/db", () => ({ getDb: vi.fn() }));

describe("DB-14 critical database contract", () => {
  it("uses bounded catalog-only checks for the app message integrity contract", () => {
    expect(DATABASE_READINESS_SQL).toContain("pg_catalog.pg_attribute");
    expect(DATABASE_READINESS_SQL).toContain(
      `pg_catalog.to_regclass('circles_app."socialUploads"')`,
    );
    expect(DATABASE_READINESS_SQL).not.toContain(
      "pg_catalog.to_regclass('circles_app.socialUploads')",
    );
    expect(DATABASE_READINESS_SQL).toContain("pg_catalog.int2[]");
    expect(DATABASE_READINESS_SQL).not.toContain("pg_catalog.smallint[]");
    expect(DATABASE_READINESS_SQL).toContain(
      "messages_client_message_id_check",
    );
    expect(DATABASE_READINESS_SQL).toContain("messages_content_check");
    expect(DATABASE_READINESS_SQL).toContain(
      "messages_conversation_author_client_message_id_unique",
    );
    expect(DATABASE_READINESS_SQL).toContain(
      "conversationParticipants_conversationId_fkey",
    );
    expect(DATABASE_READINESS_SQL).toContain(
      "conversation_participants_conversation_user_unique",
    );
    expect(DATABASE_READINESS_SQL).toContain("conversations_direct_key_unique");
    expect(DATABASE_READINESS_SQL).toContain(
      "messages_author_authorized_trigger",
    );
    expect(DATABASE_READINESS_SQL).toContain(
      "enforce_message_author_authorized",
    );
    expect(DATABASE_READINESS_SQL).toContain(
      `pg_catalog.md5(function_catalog.prosrc) = '${MESSAGE_AUTHORIZATION_FUNCTION_PROSRC_MD5}'`,
    );
    expect(DATABASE_READINESS_SQL).toContain("runtime_messages_policy");
    expect(DATABASE_READINESS_SQL).toContain(
      "circles_app_deny_anon_authenticated",
    );
    expect(DATABASE_READINESS_SQL).toContain("LIMIT 1");
    expect(DATABASE_READINESS_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\s+(?!OR\s+REPLACE)/i,
    );
    expect(DATABASE_READINESS_SQL).not.toMatch(/FROM\s+circles_app\./i);
  });

  it("requires the exact optional identity mapping shape once email auth opts in", () => {
    expect(EMAIL_IDENTITY_READINESS_SQL).toContain("circles_identity");
    expect(EMAIL_IDENTITY_READINESS_SQL).toContain("provider_links");
    expect(EMAIL_IDENTITY_READINESS_SQL).toContain(
      "circles_identity_provider_links_runtime_select",
    );
    expect(EMAIL_IDENTITY_READINESS_SQL).toContain(
      "circles_identity_provider_links_runtime_insert",
    );
    expect(EMAIL_IDENTITY_READINESS_SQL).toContain("relforcerowsecurity");
    expect(EMAIL_IDENTITY_READINESS_SQL).toContain("confdeltype = 'c'");
    expect(EMAIL_IDENTITY_READINESS_SQL).toContain("pg_catalog.int2[]");
    expect(EMAIL_IDENTITY_READINESS_SQL).not.toContain("pg_catalog.smallint[]");
    expect(EMAIL_IDENTITY_READINESS_SQL).toContain("LIMIT 1");
  });

  it("requires named business uniqueness and the exact legacy or surrogate receipt-key contract", () => {
    expect(POST_PUBLICATION_STATUS_SQL).toContain(
      "post_publish_receipts_actor_operation_unique",
    );
    expect(POST_PUBLICATION_STATUS_SQL).toContain(
      "c.contype = 'u'::pg_catalog.\"char\" AND c.convalidated",
    );
    expect(POST_PUBLICATION_STATUS_SQL).toContain(
      "c.contype = 'p'::pg_catalog.\"char\" AND c.convalidated",
    );
    expect(POST_PUBLICATION_STATUS_SQL).toContain(
      "'id'::pg_catalog.name, 6::pg_catalog.int2, 'bigint'::pg_catalog.text, true, 'a'::pg_catalog.\"char\"",
    );
    expect(POST_PUBLICATION_STATUS_SQL).toContain(
      "identity_attribute.attidentity = 'a'::pg_catalog.\"char\"",
    );
    expect(POST_PUBLICATION_STATUS_SQL).toContain(
      "postPublishReceipts_actorId_fkey",
    );
    expect(POST_PUBLICATION_STATUS_SQL).toContain(
      "postPublishReceipts_postId_fkey",
    );
    expect(POST_PUBLICATION_STATUS_SQL).toContain(
      "post_publish_receipts_runtime_update",
    );
    expect(POST_PUBLICATION_STATUS_SQL).toContain("pg_catalog.int2[]");
    expect(POST_PUBLICATION_STATUS_SQL).not.toContain("pg_catalog.smallint[]");
    expect(POST_PUBLICATION_STATUS_SQL).toContain("LIMIT 1");
  });

  it("keeps the protected publication response shape and fails closed", async () => {
    expect(postPublicationStatusFromEvidence({ ready: true })).toEqual({
      ready: true,
    });
    expect(postPublicationStatusFromEvidence(null)).toEqual({ ready: false });

    const query = vi.fn().mockResolvedValue({ rows: [{ ready: true }] });
    const getDatabase = vi.fn(async () => ({ $client: { query } }));
    await expect(
      getPostPublicationStatus({
        getDatabase: getDatabase as never,
        databaseDeadlineMs: 100,
      }),
    ).resolves.toEqual({ ready: true });
    expect(query).toHaveBeenCalledWith(POST_PUBLICATION_STATUS_SQL);

    query.mockRejectedValueOnce(new Error("private catalog failure"));
    await expect(
      getPostPublicationStatus({
        getDatabase: getDatabase as never,
        databaseDeadlineMs: 100,
      }),
    ).resolves.toEqual({ ready: false });
  });

  it("delegates the existing social publication seam to the exact DB-14 helper", () => {
    const service = readFileSync("server/social-service.ts", "utf8");
    expect(service).toContain(
      "getPostPublicationStatus as getDatabasePostPublicationStatus",
    );
    expect(service).toContain("return getDatabasePostPublicationStatus();");
    expect(service).toContain(
      "export type PostPublicationStatus = { ready: boolean };",
    );
  });

  it("creates a new admin-only fixed-path health function with bounded settings and ACL postflight", () => {
    const migration = readFileSync(
      "operations/remediation/db14_integrity_health.sql",
      "utf8",
    );
    expect(migration).toContain("SET LOCAL lock_timeout = '2s';");
    expect(migration).toContain("SET LOCAL statement_timeout = '15s';");
    expect(migration).toContain(
      "CREATE FUNCTION circles_ops.run_daily_critical_feature_health()",
    );
    expect(migration).not.toContain(
      "CREATE OR REPLACE FUNCTION circles_ops.run_daily_critical_feature_health()",
    );
    expect(migration).toContain(
      "run_daily_critical_feature_health'::pg_catalog.name",
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog");
    expect(migration).toContain(
      "function_config IS DISTINCT FROM ARRAY['search_path=pg_catalog'::pg_catalog.text]",
    );
    expect(migration).toContain("pg_catalog.aclexplode");
    expect(migration).toContain("acl_entry.grantee = 0");
    expect(migration).toContain("acl_entry.is_grantable");
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION circles_ops.run_daily_critical_feature_health() TO postgres;",
    );
    expect(migration).toContain("messages_author_authorized_trigger");
    expect(migration).toContain("conversationParticipants_conversationId_fkey");
    expect(migration).toContain("conversations_direct_key_unique");
    expect(migration).toContain("post_publish_receipts_actor_operation_unique");
    expect(migration).toContain("pg_catalog.int2[]");
    expect(migration).not.toContain("pg_catalog.smallint[]");
    expect(migration).not.toMatch(
      /cron\.schedule|CREATE EXTENSION|dblink|http_/i,
    );
    expect(migration).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE)\s+circles_(?:app|identity|publish)\b/i,
    );
  });

  it("keeps an opt-in loopback-only PG17 drill for source migrations and drift failures", () => {
    const fixture = readFileSync(
      "operations/tests/db14-critical-contracts.pg17.py",
      "utf8",
    );
    expect(fixture).toContain("CIRCLES_DB14_LOCAL_PG17");
    expect(fixture).toContain('"127.0.0.1"');
    expect(fixture).toContain("0014_circles_email_identity.sql");
    expect(fixture).toContain("0015_circles_publish_post_receipts.sql");
    expect(fixture).toContain("circles_app_deny_anon_authenticated");
    expect(fixture).toContain("negative-column");
    expect(fixture).toContain("negative-index");
    expect(fixture).toContain("negative-policy");
    expect(fixture).toContain("negative-helper-acl");
    expect(fixture).toContain("malicious-prior-signature-refusal");
    expect(fixture).not.toContain("DATABASE_URL");
  });
});
