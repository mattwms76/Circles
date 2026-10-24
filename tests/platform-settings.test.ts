import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import {
  PLATFORM_UPLOAD_HARD_CAP_BYTES,
  MobileFeatureSettings,
  PlatformFeature,
} from "../shared/platform-settings";
import {
  assertPlatformFeature,
  assertPlatformUploadSize,
  getPlatformStatus,
  type PlatformSettingsExecutor,
} from "../server/platform-settings";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("../server/db", () => ({ getDb: mocks.getDb }));

const originalEnabled = process.env.CIRCLES_PLATFORM_SETTINGS_ENABLED;

const enabledSettings: MobileFeatureSettings = {
  registrationsOpen: true,
  circleCreationEnabled: true,
  liveStreamingEnabled: true,
  maintenanceMode: false,
  maxUploadMb: 20,
};

function executorFor(result: unknown): {
  executor: PlatformSettingsExecutor;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async (_query: SQL): Promise<unknown> => result);
  return { executor: { execute }, execute };
}

function settingsResult(settings: unknown): { rows: { settings: unknown }[] } {
  return { rows: [{ settings }] };
}

function enableIntegration(): void {
  process.env.CIRCLES_PLATFORM_SETTINGS_ENABLED = "true";
}

function disableIntegration(): void {
  delete process.env.CIRCLES_PLATFORM_SETTINGS_ENABLED;
}

afterEach(() => {
  vi.clearAllMocks();
  if (originalEnabled === undefined) {
    delete process.env.CIRCLES_PLATFORM_SETTINGS_ENABLED;
  } else {
    process.env.CIRCLES_PLATFORM_SETTINGS_ENABLED = originalEnabled;
  }
});

describe("platform mobile feature settings", () => {
  it("is inactive by default without opening a database connection or fabricating settings", async () => {
    disableIntegration();
    const { executor, execute } = executorFor(settingsResult(enabledSettings));

    await expect(
      assertPlatformFeature(executor, "circleCreationEnabled"),
    ).resolves.toBeUndefined();
    await expect(
      assertPlatformUploadSize(executor, 1024),
    ).resolves.toBeUndefined();
    await expect(getPlatformStatus()).resolves.toEqual({
      integration: "inactive",
      feature_readiness: false,
      settings: null,
    });

    process.env.CIRCLES_PLATFORM_SETTINGS_ENABLED = "TRUE";
    await expect(getPlatformStatus()).resolves.toEqual({
      integration: "inactive",
      feature_readiness: false,
      settings: null,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns the exact bounded settings DTO when the active app reader succeeds", async () => {
    enableIntegration();
    const { executor, execute } = executorFor(settingsResult(enabledSettings));
    mocks.getDb.mockResolvedValue(executor);

    await expect(getPlatformStatus()).resolves.toEqual({
      integration: "active",
      feature_readiness: true,
      settings: enabledSettings,
    });
    expect(execute).toHaveBeenCalledTimes(1);

    for (const feature of [
      "registrationsOpen",
      "circleCreationEnabled",
      "liveStreamingEnabled",
    ] as const satisfies readonly PlatformFeature[]) {
      const reader = executorFor(settingsResult(enabledSettings));
      await expect(
        assertPlatformFeature(reader.executor, feature),
      ).resolves.toBeUndefined();
      expect(reader.execute).toHaveBeenCalledTimes(1);
    }
  });

  it("enforces each false feature flag without a cache and keeps maintenance informational", async () => {
    enableIntegration();

    for (const feature of [
      "registrationsOpen",
      "circleCreationEnabled",
      "liveStreamingEnabled",
    ] as const satisfies readonly PlatformFeature[]) {
      const disabled = { ...enabledSettings, [feature]: false };
      const { executor } = executorFor(settingsResult(disabled));
      await expect(
        assertPlatformFeature(executor, feature),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }

    const maintenance = executorFor(
      settingsResult({ ...enabledSettings, maintenanceMode: true }),
    );
    for (const feature of [
      "registrationsOpen",
      "circleCreationEnabled",
      "liveStreamingEnabled",
    ] as const) {
      await expect(
        assertPlatformFeature(maintenance.executor, feature),
      ).resolves.toBeUndefined();
    }
    await expect(
      assertPlatformUploadSize(maintenance.executor, 1024),
    ).resolves.toBeUndefined();

    const changingReader = executorFor(settingsResult(enabledSettings));
    changingReader.execute
      .mockResolvedValueOnce(settingsResult(enabledSettings))
      .mockResolvedValueOnce(
        settingsResult({ ...enabledSettings, liveStreamingEnabled: false }),
      );
    await expect(
      assertPlatformFeature(changingReader.executor, "liveStreamingEnabled"),
    ).resolves.toBeUndefined();
    await expect(
      assertPlatformFeature(changingReader.executor, "liveStreamingEnabled"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(changingReader.execute).toHaveBeenCalledTimes(2);
  });

  it("fails closed for extra keys, malformed values, and values outside the 1..20 MiB bound", async () => {
    enableIntegration();
    const invalidSettings = [
      { ...enabledSettings, unexpected: true },
      { ...enabledSettings, maxUploadMb: 0 },
      { ...enabledSettings, maxUploadMb: 21 },
      { ...enabledSettings, maxUploadMb: "20" },
    ];

    for (const value of invalidSettings) {
      const reader = executorFor(settingsResult(value));
      await expect(
        assertPlatformFeature(reader.executor, "registrationsOpen"),
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }

    const malformedStatusReader = executorFor(
      settingsResult({ ...enabledSettings, unexpected: true }),
    );
    mocks.getDb.mockResolvedValue(malformedStatusReader.executor);
    await expect(getPlatformStatus()).resolves.toEqual({
      integration: "active",
      feature_readiness: false,
      settings: null,
    });
  });

  it("converts reader runtime failures into safe 503 mutation failures and an unreadied public status", async () => {
    enableIntegration();
    const { executor } = executorFor(settingsResult(enabledSettings));
    executor.execute = vi.fn(async (_query: SQL): Promise<unknown> => {
      throw new Error("synthetic reader connection failure");
    });
    mocks.getDb.mockResolvedValue(executor);

    await expect(
      assertPlatformFeature(executor, "registrationsOpen"),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(getPlatformStatus()).resolves.toEqual({
      integration: "active",
      feature_readiness: false,
      settings: null,
    });
  });

  it("retains the 20 MiB hard cap in inactive mode and applies the active platform upload limit", async () => {
    disableIntegration();
    const inactiveReader = executorFor(settingsResult(enabledSettings));
    await expect(
      assertPlatformUploadSize(
        inactiveReader.executor,
        PLATFORM_UPLOAD_HARD_CAP_BYTES + 1,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(inactiveReader.execute).not.toHaveBeenCalled();

    enableIntegration();
    const activeReader = executorFor(
      settingsResult({ ...enabledSettings, maxUploadMb: 1 }),
    );
    await expect(
      assertPlatformUploadSize(activeReader.executor, 1024 * 1024),
    ).resolves.toBeUndefined();
    await expect(
      assertPlatformUploadSize(activeReader.executor, 1024 * 1024 + 1),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
