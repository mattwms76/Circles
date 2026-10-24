import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformStatus } from "../shared/platform-settings";
import { platformRouter } from "../server/platform-router";

const mocks = vi.hoisted(() => ({ getPlatformStatus: vi.fn() }));

vi.mock("../server/platform-settings", () => ({
  getPlatformStatus: mocks.getPlatformStatus,
}));

afterEach(() => vi.clearAllMocks());

describe("platform public status router", () => {
  it("returns only the bounded safe status DTO from a public caller", async () => {
    const status: PlatformStatus = {
      integration: "active",
      feature_readiness: false,
      settings: null,
    };
    mocks.getPlatformStatus.mockResolvedValue(status);

    const result = await platformRouter
      .createCaller({ user: null, req: {}, res: {} } as never)
      .status();

    expect(result).toEqual(status);
    expect(mocks.getPlatformStatus).toHaveBeenCalledOnce();
  });
});
