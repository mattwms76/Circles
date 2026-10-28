import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OAUTH_OPPORTUNISTIC_EXPIRY_CLEANUP_LIMIT,
  PostgresOAuthPendingStateStore,
  type OAuthPendingStateQueryExecutor,
} from "../server/_core/oauth-pending-state";

const state =
  "eyJyZWRpcmVjdFVyaSI6Imh0dHBzOi8vYXBwLnRlc3QvY2FsbGJhY2siLCJub25jZSI6Ik00czFhN0I5Y0QyZUY1Z0g4akt3bU4zcFE2clQ5dlcxeVo0X0FiQ2RFZkcifQ==";
const nonce = "M4s1a7B9cD2eF5gH8jK0mN3pQ6rT9vW1yZ4_AbCdEfG";

class CaptureExecutor implements OAuthPendingStateQueryExecutor {
  calls: { text: string; values: unknown[] }[] = [];

  async query(text: string, values: unknown[]) {
    this.calls.push({ text, values });
    return { rows: [] };
  }
}

describe("DB-16 security-state retention contracts", () => {
  it("bounds each public OAuth-start cleanup before atomically inserting its pending state", async () => {
    const executor = new CaptureExecutor();
    const store = new PostgresOAuthPendingStateStore(executor);

    await store.createWeb({
      state,
      cookieBinding: "web-cookie-binding-abcdefghijklmnopqrstuvwxyz",
      redirectUri: "https://app.test/api/oauth/callback",
      nonce,
      frontendOrigin: "https://app.test",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const call = executor.calls[0]!;
    expect(call.text).toContain("WITH expired_candidates AS MATERIALIZED");
    expect(call.text).toContain(
      "ORDER BY expires_at ASC, state_fingerprint ASC",
    );
    expect(call.text).toContain("LIMIT $9");
    expect(call.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(call.text).toContain(
      "DELETE FROM circles_auth.oauth_pending_states AS pending",
    );
    expect(call.text).toContain(
      "INSERT INTO circles_auth.oauth_pending_states",
    );
    expect(call.values).toHaveLength(9);
    expect(call.values[8]).toBe(OAUTH_OPPORTUNISTIC_EXPIRY_CLEANUP_LIMIT);
    expect(OAUTH_OPPORTUNISTIC_EXPIRY_CLEANUP_LIMIT).toBeGreaterThan(0);
    expect(OAUTH_OPPORTUNISTIC_EXPIRY_CLEANUP_LIMIT).toBeLessThanOrEqual(100);
  });

  it("keeps the candidate retention helper admin-only, aggregate-only, dry-run by default, and bounded", async () => {
    const sql = await readFile(
      resolve(
        process.cwd(),
        "operations/remediation/db16_security_state_retention.sql",
      ),
      "utf8",
    );

    expect(sql).toContain(
      "CREATE FUNCTION circles_ops.run_security_state_retention(",
    );
    expect(sql).toContain("p_dry_run boolean DEFAULT true");
    expect(sql).toContain("p_batch_size integer DEFAULT 25");
    expect(sql).toContain("p_batch_size > 100");
    expect(sql).toContain("SET lock_timeout = '500ms'");
    expect(sql).toContain("SET statement_timeout = '5s'");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog");
    expect(sql).toContain("FOR UPDATE OF pending SKIP LOCKED");
    expect(sql).toContain("FOR UPDATE OF session SKIP LOCKED");
    expect(sql).toContain('session."expiresAt" <= v_now');
    expect(sql).toContain("make_interval(days => 90)");
    expect(sql).toContain("make_interval(days => 180)");
    expect(sql).toContain("candidate_count integer");
    expect(sql).toContain("deleted_count integer");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION circles_ops.run_security_state_retention(boolean, integer)\n  TO postgres;",
    );
    expect(sql).toContain(
      "FROM anon, authenticated, service_role, circles_app_runtime,",
    );
    expect(sql).toMatch(/to_regprocedure\([\s\S]*run_security_state_retention/);
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?POLICY/i);
    expect(sql).not.toMatch(/pg_cron|cron\.schedule|CREATE\s+EXTENSION/i);
  });
});
