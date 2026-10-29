import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkBackendReadiness,
  publicReadinessFromStatus,
} from "../server/_core/readiness";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  loadTurnConfiguration: vi.fn(),
}));

vi.mock("../server/db", () => ({
  getDb: async () => ({ $client: { query: mocks.query } }),
}));
vi.mock("../server/turn-config", () => ({
  loadTurnConfiguration: mocks.loadTurnConfiguration,
}));

describe("CBA-11 sanitized relay deployment readiness", () => {
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
    mocks.loadTurnConfiguration.mockReset().mockReturnValue(null);
  });

  it("keeps core readiness healthy while explicitly failing live-ready when TURN is unavailable", async () => {
    const status = await checkBackendReadiness({ emailAuthEnabled: false });

    expect(status).toEqual({
      ok: true,
      database: true,
      oauthState: true,
      liveRelay: false,
      mediaUploadBudget: false,
    });
    expect(publicReadinessFromStatus(status)).toEqual({
      ok: true,
      liveRelay: false,
      liveReady: false,
      mediaUploadBudget: false,
      mediaUploadReady: false,
    });
  });

  it("requires both core and ledger readiness for uploads without coupling relay readiness", () => {
    expect(
      publicReadinessFromStatus({
        ok: true,
        liveRelay: false,
        mediaUploadBudget: true,
      }),
    ).toEqual({
      ok: true,
      liveRelay: false,
      liveReady: false,
      mediaUploadBudget: true,
      mediaUploadReady: true,
    });
    expect(
      publicReadinessFromStatus({
        ok: false,
        liveRelay: true,
        mediaUploadBudget: true,
      }),
    ).toEqual({
      ok: false,
      liveRelay: true,
      liveReady: false,
      mediaUploadBudget: true,
      mediaUploadReady: false,
    });
  });
});
