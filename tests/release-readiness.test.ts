import { describe, expect, it } from "vitest";
import {
  EXIT_CODES,
  evaluateReleaseReadiness,
  isProductionApiOrigin,
} from "../scripts/check-release-readiness.mjs";

function readyStoreInput() {
  return {
    target: "store",
    requiredPlatforms: ["android", "ios"],
    manifest: {
      appConfig: true,
      scheme: true,
      nativeIds: true,
      easProfile: "store",
      nativeWebRtc: { required: true, configPlugin: true },
    },
    api: {
      dockerfile: true,
      frozenLockfile: true,
      buildWithoutRuntimeCredentials: true,
      runsAsNonRoot: true,
      port: 3000,
      healthPath: "/api/ready",
      productionOrigin: "https://api.circles.example",
    },
    requiredProviders: [
      { name: "oauth", secrets: [] },
      { name: "database", secrets: ["DATABASE_CONNECTION"] },
      { name: "signing", secrets: ["SESSION_SIGNING_SECRET"] },
      {
        name: "turn-relay",
        secrets: ["TURN_SERVER_URLS", "TURN_SHARED_SECRET"],
      },
    ],
    providers: {
      oauth: { configured: true, secrets: {} },
      "turn-relay": {
        configured: true,
        secrets: { TURN_SERVER_URLS: true, TURN_SHARED_SECRET: true },
      },
      database: { configured: true, secrets: { DATABASE_CONNECTION: true } },
      signing: { configured: true, secrets: { SESSION_SIGNING_SECRET: true } },
    },
    evidence: {
      claims: { signedBuild: true },
      apiContainer: { status: "passed", source: "real" },
      apiHealth: { status: "passed", source: "real" },
      liveRelay: { status: "passed", source: "real" },
      nativeBuilds: {
        android: { status: "passed", source: "real", signing: "signed" },
        ios: { status: "passed", source: "real", signing: "signed" },
      },
      devices: {
        android: { status: "passed", source: "real" },
        ios: { status: "passed", source: "real" },
      },
    },
  };
}

describe("release readiness", () => {
  it("separates manifest, API, provider, and real-evidence confirmations", () => {
    const result = evaluateReleaseReadiness(readyStoreInput());

    expect(result.status).toBe("ready");
    expect(result.exitCode).toBe(EXIT_CODES.ready);
    expect(
      result.checks.filter((item) => item.area === "manifest"),
    ).not.toHaveLength(0);
    expect(
      result.checks.filter((item) => item.area === "api"),
    ).not.toHaveLength(0);
    expect(
      result.checks.filter((item) => item.area === "providers"),
    ).not.toHaveLength(0);
    expect(
      result.checks.filter((item) => item.area === "evidence"),
    ).not.toHaveLength(0);
  });

  it("blocks a store release that omits its mandatory relay provider", () => {
    const input = readyStoreInput();
    input.requiredProviders = input.requiredProviders.filter(
      (entry) => entry.name !== "turn-relay",
    );
    const result = evaluateReleaseReadiness(input);
    expect(result.status).toBe("blocked");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "providers.turn-relay.contract",
        status: "blocked",
      }),
    );
  });

  it("keeps a release unproven when real relay verification is only synthetic", () => {
    const input = readyStoreInput();
    input.evidence.liveRelay = { status: "passed", source: "synthetic" };
    const result = evaluateReleaseReadiness(input);
    expect(result.status).toBe("prerequisites");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "evidence.live-relay",
        status: "prerequisite",
      }),
    );
  });

  it("rejects Preview-only public API origins for store releases", () => {
    const input = readyStoreInput();
    input.api.productionOrigin = "https://3000-session.manus.computer";

    const result = evaluateReleaseReadiness(input);
    expect(result.status).toBe("blocked");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "api.production-origin",
        status: "blocked",
      }),
    );
  });

  it("blocks release configuration when a required provider secret is not attested", () => {
    const input = readyStoreInput();
    input.providers.signing.secrets.SESSION_SIGNING_SECRET = false;

    const result = evaluateReleaseReadiness(input);
    expect(result.status).toBe("blocked");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "providers.signing.secret.SESSION_SIGNING_SECRET",
        status: "blocked",
      }),
    );
  });

  it("keeps static configuration short of readiness until real build and device proof exists", () => {
    const input = readyStoreInput();
    input.evidence.nativeBuilds.android = {
      status: "passed",
      source: "synthetic",
      signing: "signed",
    };

    const result = evaluateReleaseReadiness(input);
    expect(result.status).toBe("prerequisites");
    expect(result.exitCode).toBe(EXIT_CODES.prerequisites);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "evidence.native-build.android",
        status: "prerequisite",
      }),
    );
  });

  it("never accepts an unsigned bundle as a signed store build", () => {
    const input = readyStoreInput();
    input.evidence.nativeBuilds.ios.signing = "unsigned";

    const result = evaluateReleaseReadiness(input);
    expect(result.status).toBe("blocked");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "evidence.native-build-signing.ios",
        status: "blocked",
      }),
    );
  });

  it("requires a standalone native preview when native WebRTC is in scope", () => {
    const input = readyStoreInput();
    const previewInput = {
      ...input,
      target: "internal-preview",
      manifest: {
        ...input.manifest,
        easProfile: "preview",
        previewSurface: "expo-go",
      },
    };

    const result = evaluateReleaseReadiness(previewInput);
    expect(result.status).toBe("blocked");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "manifest.preview-surface",
        status: "blocked",
      }),
    );
  });

  it("recognizes stable HTTPS origins without contacting them", () => {
    expect(isProductionApiOrigin("https://api.circles.example")).toBe(true);
    expect(isProductionApiOrigin("http://api.circles.example")).toBe(false);
    expect(isProductionApiOrigin("https://localhost:3000")).toBe(false);
    expect(isProductionApiOrigin("https://preview.exp.direct")).toBe(false);
  });
});
