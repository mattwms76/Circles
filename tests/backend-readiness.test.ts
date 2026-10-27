import { describe, expect, it, vi } from "vitest";
import { readinessFromEvidence } from "../server/_core/readiness";
vi.mock("../server/db", () => ({ getDb: vi.fn() }));

describe("private backend readiness", () => {
  it("fails closed without database evidence", () => {
    expect(readinessFromEvidence(null)).toEqual({
      ok: false,
      database: false,
      oauthState: false,
    });
  });
  it("rejects an unrestricted administrator even with tables present", () => {
    expect(
      readinessFromEvidence({
        runtime_role: "postgres",
        app_table_count: 27,
        oauth_store_ready: true,
        critical_contract_ready: true,
      }).ok,
    ).toBe(false);
  });
  it("does not confuse database liveness with a missing OAuth helper", () => {
    expect(
      readinessFromEvidence({
        runtime_role: "circles_app_runtime",
        app_table_count: 27,
        oauth_store_ready: false,
        critical_contract_ready: true,
      }),
    ).toEqual({ ok: false, database: true, oauthState: false });
  });
  it("requires all application tables under the restricted role", () => {
    expect(
      readinessFromEvidence({
        runtime_role: "circles_app_runtime",
        app_table_count: 21,
        oauth_store_ready: true,
        critical_contract_ready: true,
      }).ok,
    ).toBe(false);
  });
  it("accepts complete restricted-role private database evidence", () => {
    expect(
      readinessFromEvidence({
        runtime_role: "circles_app_runtime",
        app_table_count: 27,
        oauth_store_ready: true,
        critical_contract_ready: true,
      }).ok,
    ).toBe(true);
  });
  it("fails closed when a required critical catalog object drifts", () => {
    expect(
      readinessFromEvidence({
        runtime_role: "circles_app_runtime",
        app_table_count: 27,
        oauth_store_ready: true,
        critical_contract_ready: false,
      }),
    ).toEqual({ ok: false, database: false, oauthState: false });
  });
});
