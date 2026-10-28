import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { PlatformMaintenanceNotice } from "../components/platform-maintenance-notice";

const status = vi.hoisted(() => ({
  value: undefined as unknown,
  isError: false,
}));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    platform: {
      status: {
        useQuery: () => ({ data: status.value, isError: status.isError }),
      },
    },
  },
}));
vi.mock("@/components/circles-ui", () => ({
  C: { soft: "#FFF0EB", border: "#E8E9E2", secondary: "#596456" },
  T: "T",
  Heading: "T",
}));

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return text(node.props.children);
  return "";
}
const settings = {
  registrationsOpen: true,
  circleCreationEnabled: true,
  liveStreamingEnabled: true,
  maintenanceMode: true,
  maxUploadMb: 20,
};
describe("informational maintenance presentation", () => {
  beforeEach(() => {
    status.value = undefined;
    status.isError = false;
  });
  it("renders nothing while integration is inactive", () => {
    status.value = {
      integration: "inactive",
      feature_readiness: false,
      settings: null,
    };
    expect(PlatformMaintenanceNotice()).toBeNull();
  });
  it("does not invent maintenance on missing, failed or unavailable status", () => {
    expect(PlatformMaintenanceNotice()).toBeNull();
    status.value = {
      integration: "active",
      feature_readiness: false,
      settings: null,
    };
    expect(PlatformMaintenanceNotice()).toBeNull();
    status.value = { integration: "active", feature_readiness: true, settings };
    status.isError = true;
    expect(PlatformMaintenanceNotice()).toBeNull();
  });
  it("renders a polite non-modal notice only for verified active maintenance", () => {
    status.value = { integration: "active", feature_readiness: true, settings };
    const notice = PlatformMaintenanceNotice();
    expect(notice?.props.accessibilityLiveRegion).toBe("polite");
    expect(text(notice)).toContain("Circles is undergoing maintenance.");
    expect(text(notice)).toContain("Your current conversation stays open.");
    expect(notice?.props.children).not.toHaveProperty("navigation");
  });
  it("renders nothing when the maintenance flag is false", () => {
    status.value = {
      integration: "active",
      feature_readiness: true,
      settings: { ...settings, maintenanceMode: false },
    };
    expect(PlatformMaintenanceNotice()).toBeNull();
  });
});
