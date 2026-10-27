import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkBackendReadiness } from "../server/_core/readiness";

const mocks = vi.hoisted(() => ({ query: vi.fn(), status: vi.fn() }));
vi.mock("../server/db", () => ({
  getDb: async () => ({ $client: { query: mocks.query } }),
}));
vi.mock("../server/turn-config", () => ({ loadTurnConfiguration: () => null }));
vi.mock("../server/_core/email-auth", () => ({
  isEmailAuthEnabled: () => false,
  getEmailAuthStatus: () => mocks.status(),
}));

const readyEmail = {
  enabled: true,
  ready: true,
  emailEnabled: true,
  googleEnabled: false as const,
  confirmationRequired: true as const,
};

describe("optional email-auth deployment readiness", () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({
      rows: [
        {
          runtime_role: "circles_app_runtime",
          app_table_count: 27,
          oauth_store_ready: true,
          critical_contract_ready: true,
        },
      ],
    });
    mocks.status.mockReset().mockResolvedValue(readyEmail);
  });

  it("keeps the existing exact health shape and avoids provider work while disabled", async () => {
    expect(await checkBackendReadiness()).toEqual({
      ok: true,
      database: true,
      oauthState: true,
      liveRelay: false,
    });
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("requires the enabled private mapping and verified provider readiness", async () => {
    expect(await checkBackendReadiness({ emailAuthEnabled: true })).toEqual({
      ok: true,
      database: true,
      oauthState: true,
      liveRelay: false,
      emailAuth: true,
    });
    mocks.status.mockResolvedValue({
      ...readyEmail,
      ready: false,
      emailEnabled: false,
    });
    expect(await checkBackendReadiness({ emailAuthEnabled: true })).toEqual({
      ok: false,
      database: true,
      oauthState: true,
      liveRelay: false,
      emailAuth: false,
    });
  });

  it("never upgrades absent baseline database authority from an available email provider", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const status = await checkBackendReadiness({ emailAuthEnabled: true });
    expect(status.ok).toBe(false);
    expect(status.database).toBe(false);
  });

  it("fails closed and does not render provider/driver details", async () => {
    mocks.status.mockRejectedValue(
      new Error("private provider failure must not render"),
    );
    const status = await checkBackendReadiness({ emailAuthEnabled: true });
    expect(status.ok).toBe(false);
    expect("emailAuth" in status && status.emailAuth).toBe(false);
    expect(JSON.stringify(status)).not.toContain("private provider failure");
  });
});
