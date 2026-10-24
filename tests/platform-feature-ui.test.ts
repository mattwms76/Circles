import { describe, expect, it } from "vitest";
import {
  platformCreationIssue,
  platformUploadLimitMb,
} from "../lib/platform-feature-ui";
import type { PlatformStatus } from "@/shared/platform-settings";

const active: PlatformStatus = {
  integration: "active",
  feature_readiness: true,
  settings: {
    registrationsOpen: false,
    circleCreationEnabled: false,
    liveStreamingEnabled: false,
    maintenanceMode: false,
    maxUploadMb: 5,
  },
};

describe("minimal platform advisory UI", () => {
  it("preserves all existing creation paths in explicit inactive mode", () => {
    const status: PlatformStatus = {
      integration: "inactive",
      feature_readiness: false,
      settings: null,
    };
    expect(platformCreationIssue(status, "circle", true)).toBeNull();
    expect(platformCreationIssue(status, "live")).toBeNull();
    expect(platformUploadLimitMb(status)).toBe(20);
  });
  it("reflects active circle/live restrictions without blocking text posts", () => {
    expect(platformCreationIssue(active, "circle")).toMatch(/paused/);
    expect(platformCreationIssue(active, "live")).toMatch(/paused/);
    expect(platformCreationIssue(active, "post")).toBeNull();
    expect(platformUploadLimitMb(active)).toBe(5);
  });
  it("does not invent settings on a missing or failed active reader", () => {
    const failed: PlatformStatus = {
      integration: "active",
      feature_readiness: false,
      settings: null,
    };
    expect(platformCreationIssue(failed, "circle")).toMatch(/unavailable/);
    expect(platformCreationIssue(failed, "post", true)).toMatch(/unavailable/);
    expect(platformCreationIssue(failed, "post", false)).toBeNull();
    expect(platformCreationIssue(undefined, "live")).toMatch(/Checking/);
  });
});
