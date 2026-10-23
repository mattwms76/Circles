export type MediaReferences = {
  profile_refs: number;
  circle_refs: number;
  post_refs: number;
  message_refs: number;
  stream_refs: number;
};

export type MediaInventoryEntry = {
  storage_key: string;
  url: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp" | "video/mp4";
  bytes: number;
  references: MediaReferences;
};

export type MediaInventory = {
  format: "circles-media-inventory-v1";
  media: MediaInventoryEntry[];
  summary: {
    objects: number;
    bytes: number;
    referenced_objects: number;
    unreferenced_objects: number;
  };
};

export class ContinuitySafetyError extends Error {
  readonly code: string;
}

export const PROJECT_ROOT: string;
export const PRIVATE_SCHEMA: "circles_app";
export const INVENTORY_FORMAT: "circles-media-inventory-v1";
export const PACKAGE_FORMAT: "circles-media-continuity-v1";
export const EXPECTED_BACKUP_RECIPIENT: string;
export const MAX_SINGLE_MEDIA_BYTES: number;
export const DEFAULT_MAX_OBJECTS: number;
export const MAX_MAX_OBJECTS: number;
export const DEFAULT_MAX_TOTAL_BYTES: number;
export const MAX_MAX_TOTAL_BYTES: number;
export const MEDIA_FETCH_TIMEOUT_MS: number;
export const ARCHIVE_TIMEOUT_MS: number;
export const AGE_TIMEOUT_MS: number;

export function isAllowedMediaOrigin(value: unknown): URL | null;
export function validateInventoryDocument(
  document: unknown,
  limits?: { maxObjects?: number; maxTotalBytes?: number },
): MediaInventory;
export function summarizeInventory(inventory: MediaInventory): MediaInventory["summary"] & { format: string };
export function collectMediaInventory(options?: {
  projectDir?: string;
  environment?: NodeJS.ProcessEnv;
  maxObjects?: number;
  maxTotalBytes?: number;
  client?: {
    connect(): Promise<unknown>;
    end(): Promise<unknown>;
    query(request: string | { text: string; values: unknown[] }): Promise<{ rows: unknown[] }>;
  };
}): Promise<MediaInventory>;
export function writePrivateInventory(filename: string, inventory: MediaInventory): Promise<string>;
export function loadPrivateInventory(
  filename: string,
  limits?: { maxObjects?: number; maxTotalBytes?: number },
): MediaInventory;
export function readApprovedRecipient(filename: string): string;
export function fetchAppMedia(options: {
  origin: string | URL;
  storageKey: string;
  bytes: number;
  bearerToken: string;
  fetchImpl?: typeof fetch;
}): Promise<Buffer>;
export function exportContinuityPackage(options: {
  projectDir?: string;
  inventoryFile: string;
  mediaOrigin: string;
  mediaAuthFile: string;
  recipientFile: string;
  outputFile: string;
  includeSigningMaterial?: boolean;
  signingMaterialFile?: string;
  maxObjects?: number;
  maxTotalBytes?: number;
  fetchImpl?: typeof fetch;
}): Promise<{
  output_file: string;
  sha256: string;
  bytes: number;
  objects: number;
  referenced_objects: number;
  unreferenced_objects: number;
  signing_material_included: boolean;
}>;
export function parseCliArguments(argv?: string[]):
  | {
      help: true;
      includeSigningMaterial?: boolean;
    }
  | {
      help?: false;
      mode: "inventory" | "verify" | "export";
      projectDir: string;
      inventoryOutput?: string;
      inventoryFile?: string;
      mediaOrigin?: string;
      mediaAuthFile?: string;
      recipientFile?: string;
      outputFile?: string;
      signingMaterialFile?: string;
      includeSigningMaterial: boolean;
      maxObjects: number;
      maxTotalBytes: number;
    };
export function runCli(argv?: string[], dependencies?: Record<string, unknown>): Promise<number>;
