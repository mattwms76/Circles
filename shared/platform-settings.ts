/**
 * The mobile-safe subset of platform controls. This intentionally excludes
 * administrative credentials, dashboards, thresholds, and all other settings.
 */
export type MobileFeatureSettings = {
  registrationsOpen: boolean;
  circleCreationEnabled: boolean;
  liveStreamingEnabled: boolean;
  maintenanceMode: boolean;
  maxUploadMb: number;
};

export const PLATFORM_FEATURES = [
  "registrationsOpen",
  "circleCreationEnabled",
  "liveStreamingEnabled",
] as const;

export type PlatformFeature = (typeof PLATFORM_FEATURES)[number];

/**
 * The public status contains only the bounded mobile feature DTO. It never
 * includes an administrator connection, credential, or unrelated setting.
 */
export type PlatformStatus = {
  integration: "inactive" | "active";
  feature_readiness: boolean;
  settings: MobileFeatureSettings | null;
};

/** The existing upload ceiling remains authoritative even if an admin setting is higher. */
export const PLATFORM_UPLOAD_HARD_CAP_MB = 20;
export const PLATFORM_UPLOAD_HARD_CAP_BYTES =
  PLATFORM_UPLOAD_HARD_CAP_MB * 1024 * 1024;
