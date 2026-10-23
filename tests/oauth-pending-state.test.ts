import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OAuthPendingStateStoreUnavailableError,
  PostgresOAuthPendingStateStore,
  fingerprintOAuthPendingStateSecret,
  type OAuthPendingStateQueryExecutor,
} from "../server/_core/oauth-pending-state";
import { decodeOAuthState, encodeOAuthState } from "../server/_core/oauth";

type StoredPendingState = {
  stateFingerprint: string;
  flowKind: "web" | "native";
  cookieBindingFingerprint: string | null;
  flowTokenFingerprint: string | null;
  redirectUri: string;
  nonce: string;
  frontendOrigin: string | null;
  expiresAt: Date;
};

class SyntheticPendingStateExecutor implements OAuthPendingStateQueryExecutor {
  readonly calls: { text: string; values: unknown[] }[] = [];
  private readonly rows = new Map<string, StoredPendingState>();

  async query(
    text: string,
    values: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    this.calls.push({ text, values });

    if (text.includes("INSERT INTO circles_auth.oauth_pending_states")) {
      const [
        stateFingerprint,
        flowKind,
        cookieBindingFingerprint,
        flowTokenFingerprint,
        redirectUri,
        nonce,
        frontendOrigin,
        expiresAt,
      ] = values as [
        string,
        "web" | "native",
        string | null,
        string | null,
        string,
        string,
        string | null,
        Date,
      ];
      this.rows.set(stateFingerprint, {
        stateFingerprint,
        flowKind,
        cookieBindingFingerprint,
        flowTokenFingerprint,
        redirectUri,
        nonce,
        frontendOrigin,
        expiresAt,
      });
      return { rows: [] };
    }

    const [stateFingerprint, bindingFingerprint] = values as [string, string];
    const row = this.rows.get(stateFingerprint);
    if (!row || row.expiresAt <= new Date()) return { rows: [] };

    const isWeb = text.includes("flow_kind = 'web'");
    const isMatchingBinding = isWeb
      ? row.flowKind === "web" &&
        row.cookieBindingFingerprint === bindingFingerprint
      : row.flowKind === "native" &&
        row.flowTokenFingerprint === bindingFingerprint;
    if (!isMatchingBinding) return { rows: [] };

    this.rows.delete(stateFingerprint);
    return {
      rows: [
        {
          redirectUri: row.redirectUri,
          nonce: row.nonce,
          frontendOrigin: row.frontendOrigin,
          expiresAt: row.expiresAt,
        },
      ],
    };
  }
}

const state =
  "eyJyZWRpcmVjdFVyaSI6Imh0dHBzOi8vYXBwLnRlc3QvY2FsbGJhY2siLCJub25jZSI6Ik00czFhN0I5Y0QyZUY1Z0g4akt3bU4zcFE2clQ5dlcxeVo0X0FiQ2RFZkcifQ==";
const nonce = "M4s1a7B9cD2eF5gH8jK0mN3pQ6rT9vW1yZ4_AbCdEfG";
const redirectUri = "https://app.test/api/oauth/callback";
const frontendOrigin = "https://app.test";
const expiry = () => new Date(Date.now() + 10 * 60 * 1000);

describe("PostgresOAuthPendingStateStore", () => {
  it("keeps the Manus wire state limited to redirect URI and nonce", () => {
    const pendingWithMetadata = {
      redirectUri,
      nonce,
      expiresAt: expiry(),
      frontendOrigin,
    };
    const wireState = encodeOAuthState(pendingWithMetadata);

    expect(decodeOAuthState(wireState)).toEqual({ redirectUri, nonce });
  });

  it("stores only fingerprints for browser state and atomically consumes its cookie-bound row once", async () => {
    const executor = new SyntheticPendingStateExecutor();
    const store = new PostgresOAuthPendingStateStore(executor);
    const cookieBinding = "web-cookie-binding-abcdefghijklmnopqrstuvwxyz";

    await store.createWeb({
      state,
      cookieBinding,
      redirectUri,
      nonce,
      frontendOrigin,
      expiresAt: expiry(),
    });

    const insert = executor.calls[0]!;
    expect(insert.text).toContain("WITH expired AS");
    expect(insert.text).toContain(
      "DELETE FROM circles_auth.oauth_pending_states",
    );
    expect(insert.values).toContain(fingerprintOAuthPendingStateSecret(state));
    expect(insert.values).toContain(
      fingerprintOAuthPendingStateSecret(cookieBinding),
    );
    expect(insert.values).not.toContain(state);
    expect(insert.values).not.toContain(cookieBinding);

    await expect(
      store.consumeWeb({ state, cookieBinding: "wrong-cookie-binding" }),
    ).resolves.toBeNull();
    await expect(store.consumeWeb({ state, cookieBinding })).resolves.toEqual({
      redirectUri,
      nonce,
      frontendOrigin,
      expiresAt: expect.any(Date),
    });
    await expect(
      store.consumeWeb({ state, cookieBinding }),
    ).resolves.toBeNull();

    const consume = executor.calls.at(-1)!;
    expect(consume.text).toContain(
      "DELETE FROM circles_auth.oauth_pending_states",
    );
    expect(consume.text).toContain("expires_at > pg_catalog.clock_timestamp()");
    expect(consume.text).toContain("RETURNING");
  });

  it("binds native handoff and OAuth state together before the one-time delete", async () => {
    const executor = new SyntheticPendingStateExecutor();
    const store = new PostgresOAuthPendingStateStore(executor);
    const flowToken = "native-flow-token-abcdefghijklmnopqrstuvwxyz";

    await store.createNative({
      state,
      flowToken,
      redirectUri: "manus252278368451773://oauth/callback",
      nonce,
      expiresAt: expiry(),
    });

    await expect(
      store.consumeNative({ state: `${state}x`, flowToken }),
    ).resolves.toBeNull();
    await expect(
      store.consumeNative({ state, flowToken: "wrong-native-flow-token" }),
    ).resolves.toBeNull();
    await expect(store.consumeNative({ state, flowToken })).resolves.toEqual({
      redirectUri: "manus252278368451773://oauth/callback",
      nonce,
      expiresAt: expect.any(Date),
    });
    await expect(store.consumeNative({ state, flowToken })).resolves.toBeNull();

    const nativeConsume = executor.calls.at(-1)!;
    expect(nativeConsume.text).toContain("flow_kind = 'native'");
    expect(nativeConsume.values).toEqual([
      fingerprintOAuthPendingStateSecret(state),
      fingerprintOAuthPendingStateSecret(flowToken),
    ]);
  });

  it("wraps unavailable restricted-database operations without exposing driver details", async () => {
    const unavailable: OAuthPendingStateQueryExecutor = {
      async query() {
        throw new Error("synthetic database outage");
      },
    };
    const store = new PostgresOAuthPendingStateStore(unavailable);

    await expect(
      store.createNative({
        state,
        flowToken: "native-flow-token-abcdefghijklmnopqrstuvwxyz",
        redirectUri: "manus252278368451773://oauth/callback",
        nonce,
        expiresAt: expiry(),
      }),
    ).rejects.toBeInstanceOf(OAuthPendingStateStoreUnavailableError);
  });

  it("keeps the migration private, RLS-enforced, and limited to the existing runtime role", async () => {
    const migration = await readFile(
      resolve(
        process.cwd(),
        "operations/migrations/0002_circles_auth_oauth_pending.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      "CREATE SCHEMA circles_auth AUTHORIZATION postgres",
    );
    expect(migration).toContain(
      "REVOKE ALL ON SCHEMA circles_auth FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime",
    );
    expect(migration).toContain(
      "GRANT USAGE ON SCHEMA circles_auth TO circles_app_runtime",
    );
    expect(migration).toContain(
      "GRANT SELECT, INSERT, DELETE ON TABLE circles_auth.oauth_pending_states",
    );
    expect(migration).toContain("TO circles_app_runtime");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("TO circles_app_runtime\n  USING (true)");
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER)\s+ROLE\b/i);
    expect(migration).not.toContain("SECURITY DEFINER");
    expect(migration).not.toContain("circles_app.");
    expect(migration).not.toContain("circles_ops.");
  });
});
