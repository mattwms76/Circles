import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import {
  PLATFORM_UPLOAD_HARD_CAP_BYTES,
  PLATFORM_UPLOAD_HARD_CAP_MB,
  type MobileFeatureSettings,
  type PlatformFeature,
  type PlatformStatus,
} from "../shared/platform-settings";
import { getDb } from "./db";

/**
 * The narrow common surface implemented by both a Drizzle database and its
 * transaction. Keeping this structural prevents feature gates from depending
 * on a privileged client or raw connection.
 */
export type PlatformSettingsExecutor = {
  execute(query: SQL): Promise<unknown>;
};

const MOBILE_FEATURE_SETTING_KEYS = [
  "registrationsOpen",
  "circleCreationEnabled",
  "liveStreamingEnabled",
  "maintenanceMode",
  "maxUploadMb",
] as const;

const readMobileFeatureSettingsSql = sql`
  select circles_admin.read_mobile_feature_settings() as settings
`;

/** Only the exact string "true" activates the integration; every other value is off. */
function platformSettingsIntegrationEnabled(): boolean {
  return process.env.CIRCLES_PLATFORM_SETTINGS_ENABLED === "true";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMobileFeatureSettings(
  value: unknown,
): MobileFeatureSettings | null {
  if (!isRecord(value)) return null;

  const keys = Object.keys(value);
  if (
    keys.length !== MOBILE_FEATURE_SETTING_KEYS.length ||
    keys.some(
      (key) =>
        !MOBILE_FEATURE_SETTING_KEYS.includes(
          key as (typeof MOBILE_FEATURE_SETTING_KEYS)[number],
        ),
    )
  ) {
    return null;
  }

  const {
    registrationsOpen,
    circleCreationEnabled,
    liveStreamingEnabled,
    maintenanceMode,
    maxUploadMb,
  } = value;
  if (
    typeof registrationsOpen !== "boolean" ||
    typeof circleCreationEnabled !== "boolean" ||
    typeof liveStreamingEnabled !== "boolean" ||
    typeof maintenanceMode !== "boolean" ||
    typeof maxUploadMb !== "number" ||
    !Number.isInteger(maxUploadMb) ||
    maxUploadMb < 1 ||
    maxUploadMb > PLATFORM_UPLOAD_HARD_CAP_MB
  ) {
    return null;
  }

  return {
    registrationsOpen,
    circleCreationEnabled,
    liveStreamingEnabled,
    maintenanceMode,
    maxUploadMb,
  };
}

function firstSettingsRow(result: unknown): unknown {
  if (isRecord(result) && Array.isArray(result.rows)) return result.rows[0];
  if (Array.isArray(result)) return result[0];
  return undefined;
}

function serviceUnavailable(): never {
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "Platform settings are temporarily unavailable.",
  });
}

function featureUnavailable(): never {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "This feature is not available.",
  });
}

function uploadTooLarge(): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Upload exceeds the allowed size.",
  });
}

/**
 * Read exactly the bounded SECURITY DEFINER function through the supplied app
 * database/transaction. This deliberately has no cache or fallback settings.
 */
async function readMobileFeatureSettings(
  executor: PlatformSettingsExecutor,
): Promise<MobileFeatureSettings> {
  let result: unknown;
  try {
    result = await executor.execute(readMobileFeatureSettingsSql);
  } catch {
    return serviceUnavailable();
  }

  const row = firstSettingsRow(result);
  const settings = isRecord(row)
    ? parseMobileFeatureSettings(row.settings)
    : null;
  if (!settings) return serviceUnavailable();
  return settings;
}

/**
 * Safely reports whether the optional integration can currently read its
 * bounded feature DTO. Status is observational only and never enables a write.
 */
export async function getPlatformStatus(): Promise<PlatformStatus> {
  if (!platformSettingsIntegrationEnabled()) {
    return {
      integration: "inactive",
      feature_readiness: false,
      settings: null,
    };
  }

  try {
    const db = await getDb();
    if (!db) {
      return {
        integration: "active",
        feature_readiness: false,
        settings: null,
      };
    }
    const settings = await readMobileFeatureSettings(db);
    return {
      integration: "active",
      feature_readiness: true,
      settings,
    };
  } catch {
    return {
      integration: "active",
      feature_readiness: false,
      settings: null,
    };
  }
}

/**
 * Authoritatively admits a feature mutation. Enabled mode has no defaults:
 * a missing, malformed, or unavailable reader fails closed with a safe 503.
 */
export async function assertPlatformFeature(
  executor: PlatformSettingsExecutor,
  key: PlatformFeature,
): Promise<void> {
  if (!platformSettingsIntegrationEnabled()) return;

  const settings = await readMobileFeatureSettings(executor);
  if (!settings[key]) featureUnavailable();
}

/**
 * Retains the pre-existing 20 MiB ceiling in every mode, then applies the
 * enabled platform maximum before callers perform an external storage write.
 */
export async function assertPlatformUploadSizeWithLimit(
  executor: PlatformSettingsExecutor,
  bytes: number,
): Promise<number> {
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Upload size is invalid.",
    });
  }
  if (bytes > PLATFORM_UPLOAD_HARD_CAP_BYTES) uploadTooLarge();
  if (!platformSettingsIntegrationEnabled())
    return PLATFORM_UPLOAD_HARD_CAP_BYTES;

  const settings = await readMobileFeatureSettings(executor);
  const maxBytes = Math.min(
    PLATFORM_UPLOAD_HARD_CAP_BYTES,
    settings.maxUploadMb * 1024 * 1024,
  );
  if (bytes > maxBytes) uploadTooLarge();
  return maxBytes;
}

/**
 * Existing callers need only an admission decision. Keep their void contract while recording
 * flows may use assertPlatformUploadSizeWithLimit() to inspect against the exact same cap.
 */
export async function assertPlatformUploadSize(
  executor: PlatformSettingsExecutor,
  bytes: number,
): Promise<void> {
  await assertPlatformUploadSizeWithLimit(executor, bytes);
}
