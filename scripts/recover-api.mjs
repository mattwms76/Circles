#!/usr/bin/env node
/**
 * Guarded, one-shot API recovery utility.
 *
 * This file intentionally does not know how to call Manus Host MCP/job tools. In
 * Manus, an orchestrator must refresh the real service environment, restart the
 * known API service, then run this verifier. This utility only supports a named
 * local service manager or a finite, explicit restart adapter.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(moduleDirectory, "..");
export const API_PORT = 3000;
export const METRO_PORT = 8081;
export const RESPONSE_BODY_LIMIT_BYTES = 64 * 1024;
export const REQUEST_TIMEOUT_MS = 8_000;
export const RESTART_TIMEOUT_MS = 30_000;
export const DATABASE_CONNECT_TIMEOUT_MS = 8_000;
export const DATABASE_QUERY_TIMEOUT_MS = 8_000;
export const READINESS_ATTEMPTS = 3;
export const READINESS_RETRY_DELAY_MS = 500;
export const APPLICATION_SCHEMA = "circles_app";
export const APPLICATION_RUNTIME_ROLE = "circles_app_runtime";
export const SESSION_TABLE = "applicationSessions";
export const SESSION_INDEXES = Object.freeze([
  "application_sessions_user_app_idx",
  "application_sessions_expiry_idx",
]);
export const REQUIRED_IDENTITY_SEQUENCES = Object.freeze({
  moderationCases: "moderationCases_id_seq",
  moderationActions: "moderationActions_id_seq",

  activityItems: "activityItems_id_seq",
  users: "users_id_seq",
  profiles: "profiles_id_seq",
  circles: "circles_id_seq",
  memberships: "memberships_id_seq",
  posts: "posts_id_seq",
  reactions: "reactions_id_seq",
  bookmarks: "bookmarks_id_seq",
  comments: "comments_id_seq",
  conversations: "conversations_id_seq",
  conversationParticipants: "conversationParticipants_id_seq",
  messages: "messages_id_seq",
  follows: "follows_id_seq",
  reports: "reports_id_seq",
  socialUploads: "socialUploads_id_seq",
  streams: "streams_id_seq",
  liveSignals: "liveSignals_id_seq",
  liveChat: "liveChat_id_seq",
});
export const REQUIRED_IDENTITY_TABLES = Object.freeze(
  Object.keys(REQUIRED_IDENTITY_SEQUENCES),
);

/** Exact private app table/column contract; catalog reads never select user rows. */
export const REQUIRED_APPLICATION_COLUMNS = Object.freeze({
  moderationCases: Object.freeze([
    "id",
    "circleId",
    "postId",
    "sourcePostId",
    "subjectUserId",
    "status",
    "reportCount",
    "reasons",
    "createdAt",
    "lastReportedAt",
    "resolvedAt",
  ]),
  moderationActions: Object.freeze([
    "id",
    "caseId",
    "reviewerId",
    "decision",
    "note",
    "createdAt",
  ]),
  activityItems: Object.freeze([
    "id",
    "recipientId",
    "actorId",
    "kind",
    "sourceId",
    "circleId",
    "postId",
    "createdAt",
    "readAt",
  ]),
  activityPreferences: Object.freeze([
    "recipientId",
    "commentsEnabled",
    "membershipApprovalsEnabled",
    "updatedAt",
  ]),
  activityCirclePreferences: Object.freeze([
    "recipientId",
    "circleId",
    "muted",
    "updatedAt",
  ]),
  users: Object.freeze([
    "id",
    "openId",
    "name",
    "email",
    "loginMethod",
    "role",
    "createdAt",
    "updatedAt",
    "lastSignedIn",
  ]),
  profiles: Object.freeze([
    "id",
    "userId",
    "name",
    "handle",
    "bio",
    "avatar",
    "cover",
    "createdAt",
    "updatedAt",
    "interests",
    "onboardingStep",
    "onboardingCompletedAt",
  ]),
  circles: Object.freeze([
    "id",
    "ownerId",
    "name",
    "description",
    "category",
    "privacy",
    "image",
    "color",
    "createdAt",
    "updatedAt",
    "welcomeMessage",
    "rules",
    "pinnedPostId",
  ]),
  memberships: Object.freeze([
    "id",
    "circleId",
    "userId",
    "role",
    "createdAt",
    "updatedAt",
  ]),
  posts: Object.freeze([
    "id",
    "authorId",
    "circleId",
    "text",
    "media",
    "mediaType",
    "createdAt",
    "updatedAt",
  ]),
  reactions: Object.freeze(["id", "postId", "userId", "type", "createdAt"]),
  bookmarks: Object.freeze(["id", "postId", "userId", "createdAt"]),
  comments: Object.freeze([
    "id",
    "postId",
    "authorId",
    "text",
    "createdAt",
    "updatedAt",
  ]),
  conversations: Object.freeze([
    "id",
    "kind",
    "directKey",
    "circleId",
    "createdAt",
    "updatedAt",
  ]),
  conversationParticipants: Object.freeze([
    "id",
    "conversationId",
    "userId",
    "lastReadMessageId",
    "lastReadAt",
    "createdAt",
    "updatedAt",
  ]),
  messages: Object.freeze([
    "id",
    "conversationId",
    "authorId",
    "text",
    "media",
    "createdAt",
    "clientMessageId",
  ]),
  follows: Object.freeze(["id", "followerId", "followingId", "createdAt"]),
  reports: Object.freeze([
    "id",
    "postId",
    "reporterId",
    "reason",
    "createdAt",
    "updatedAt",
  ]),
  socialUploads: Object.freeze([
    "id",
    "userId",
    "storageKey",
    "url",
    "mimeType",
    "bytes",
    "createdAt",
    "claimedAt",
  ]),
  socialSeedMarkers: Object.freeze(["key", "completedAt"]),
  _dataMigrations: Object.freeze([
    "key",
    "sourceTree",
    "completedAt",
    "summary",
  ]),
  applicationSessions: Object.freeze([
    "sessionFingerprint",
    "userOpenId",
    "appId",
    "expiresAt",
    "revokedAt",
    "createdAt",
  ]),
  streams: Object.freeze([
    "id",
    "hostId",
    "title",
    "circleId",
    "thumbnail",
    "status",
    "readyAt",
    "lastHeartbeatAt",
    "hostGeneration",
    "createdAt",
    "endedAt",
  ]),
  activeHostLeases: Object.freeze(["hostId", "streamId", "lastHeartbeatAt"]),
  liveViewers: Object.freeze([
    "streamId",
    "userId",
    "joinedAt",
    "lastSeenAt",
    "generation",
    "leftAt",
  ]),
  liveSignals: Object.freeze([
    "id",
    "streamId",
    "fromId",
    "toId",
    "kind",
    "fromGeneration",
    "toGeneration",
    "payload",
    "createdAt",
  ]),
  liveChat: Object.freeze([
    "id",
    "streamId",
    "userId",
    "userName",
    "avatar",
    "text",
    "createdAt",
  ]),
});
export const REQUIRED_APPLICATION_TABLES = Object.freeze(
  Object.keys(REQUIRED_APPLICATION_COLUMNS),
);
export const REQUIRED_RUNTIME_POLICIES = Object.freeze({
  moderationCases: Object.freeze({
    name: "runtime_moderation_cases_policy",
    command: "*",
  }),
  moderationActions: Object.freeze({
    name: "runtime_moderation_actions_policy",
    command: "*",
  }),
  activityItems: Object.freeze({
    name: "runtime_activity_items_policy",
    command: "*",
  }),
  activityPreferences: Object.freeze({
    name: "runtime_activity_preferences_policy",
    command: "*",
  }),
  activityCirclePreferences: Object.freeze({
    name: "runtime_activity_circle_preferences_policy",
    command: "*",
  }),
  users: Object.freeze({ name: "runtime_users_policy", command: "*" }),
  profiles: Object.freeze({ name: "runtime_profiles_policy", command: "*" }),
  circles: Object.freeze({ name: "runtime_circles_policy", command: "*" }),
  memberships: Object.freeze({
    name: "runtime_memberships_policy",
    command: "*",
  }),
  posts: Object.freeze({ name: "runtime_posts_policy", command: "*" }),
  reactions: Object.freeze({ name: "runtime_reactions_policy", command: "*" }),
  bookmarks: Object.freeze({ name: "runtime_bookmarks_policy", command: "*" }),
  comments: Object.freeze({ name: "runtime_comments_policy", command: "*" }),
  conversations: Object.freeze({
    name: "runtime_conversations_policy",
    command: "*",
  }),
  conversationParticipants: Object.freeze({
    name: "runtime_conversation_participants_policy",
    command: "*",
  }),
  messages: Object.freeze({ name: "runtime_messages_policy", command: "*" }),
  follows: Object.freeze({ name: "runtime_follows_policy", command: "*" }),
  reports: Object.freeze({ name: "runtime_reports_policy", command: "*" }),
  socialUploads: Object.freeze({
    name: "runtime_social_uploads_policy",
    command: "*",
  }),
  socialSeedMarkers: Object.freeze({
    name: "runtime_social_seed_markers_policy",
    command: "*",
  }),
  _dataMigrations: Object.freeze({
    name: "runtime_data_migrations_read_policy",
    command: "r",
  }),
  applicationSessions: Object.freeze({
    name: "runtime_application_sessions_policy",
    command: "*",
  }),
  streams: Object.freeze({ name: "runtime_streams_policy", command: "*" }),
  activeHostLeases: Object.freeze({
    name: "runtime_active_host_leases_policy",
    command: "*",
  }),
  liveViewers: Object.freeze({
    name: "runtime_live_viewers_policy",
    command: "*",
  }),
  liveSignals: Object.freeze({
    name: "runtime_live_signals_policy",
    command: "*",
  }),
  liveChat: Object.freeze({ name: "runtime_live_chat_policy", command: "*" }),
});

const REQUIRED_RUNTIME_KEYS = Object.freeze([
  "MANUS_PROJECT_ID",
  "MANUS_OAUTH_PORTAL_URL",
  "MANUS_OAUTH_API_URL",
  "MANUS_JWT_SECRET",
  "SUPABASE_DATABASE_URL",
  "BUILT_IN_FORGE_API_URL",
  "BUILT_IN_FORGE_API_KEY",
  "EXPO_PUBLIC_API_BASE_URL",
]);

const SAFE_RUNTIME_KEYS = new Set([
  ...REQUIRED_RUNTIME_KEYS,
  "API_BASE_URL",
  "API_ORIGIN",
  "BUILT_IN_FORGE_API_KEY",
  "BUILT_IN_FORGE_API_URL",
  "SUPABASE_DATABASE_URL",
  "EXPO_PACKAGER_PROXY_URL",
  "EXPO_PUBLIC_API_BASE_URL",
  "EXPO_PUBLIC_APP_ID",
  "EXPO_PUBLIC_OAUTH_PORTAL_URL",
  "EXPO_PUBLIC_OAUTH_SERVER_URL",
  "EXPO_PUBLIC_OWNER_NAME",
  "EXPO_PUBLIC_OWNER_OPEN_ID",
  "EXPO_PUBLIC_WEB_URL",
  "EXPO_WEB_PREVIEW_URL",
  "FRONTEND_ORIGIN",
  "JWT_SECRET",
  "MANUS_JWT_SECRET",
  "MANUS_OAUTH_API_URL",
  "MANUS_OAUTH_PORTAL_URL",
  "MANUS_PROJECT_ID",
  "NODE_ENV",
  "OAUTH_CALLBACK_ORIGIN",
  "OAUTH_PORTAL_URL",
  "OAUTH_SERVER_URL",
  "OWNER_NAME",
  "OWNER_OPEN_ID",
  "PORT",
  "PUBLIC_URL",
  "TURN_SERVER_URLS",
  "TURN_SHARED_SECRET",
  "VITE_APP_ID",
  "VITE_OAUTH_PORTAL_URL",
  "WEB_ORIGIN",
]);

const ALLOWED_SERVICE_NAME = "circles-api";
const SOURCE_ROUTERS = Object.freeze([
  { file: "server/platform-router.ts", namespace: "platform", indent: 2 },
  { file: "server/moderation-router.ts", namespace: "moderation", indent: 2 },
  { file: "server/activity-router.ts", namespace: "activity", indent: 2 },
  { file: "server/social-router.ts", namespace: "social", indent: 2 },
  { file: "server/onboarding-router.ts", namespace: "onboarding", indent: 2 },
  { file: "server/circle-home-router.ts", namespace: "circleHome", indent: 2 },
  { file: "server/live-router.ts", namespace: "live", indent: 2 },
  { file: "server/_core/systemRouter.ts", namespace: "system", indent: 2 },
]);

/**
 * Known verifier input/shape definitions. The actual route names and their
 * public/protected classification are always read from current router source.
 * A source route with no definition remains visible as inventory drift and is
 * never guessed or invoked.
 */
const ENDPOINT_DEFINITIONS = Object.freeze({
  "platform.status": { expected: "platform-status" },
  "moderation.list": {
    expected: "moderation-page",
    requiresAuth: true,
    input: { filter: "open", limit: 20 },
    identifiers: [
      { source: "circleId", field: "circleId" },
      { source: "viewerId", field: "viewerScope" },
    ],
  },
  "moderation.detail": {
    expected: "moderation-detail",
    requiresAuth: true,
    identifiers: [
      { source: "circleId", field: "circleId" },
      { source: "viewerId", field: "viewerScope" },
      { source: "moderationCaseId", field: "caseId" },
    ],
  },
  "activity.list": {
    expected: "activity-page",
    requiresAuth: true,
    input: { limit: 20 },
  },
  "activity.unreadCount": { expected: "activity-unread", requiresAuth: true },
  "activity.preferences": {
    expected: "activity-preferences",
    requiresAuth: true,
  },
  "activity.resolveTarget": {
    expected: "activity-target",
    requiresAuth: true,
    identifier: { source: "activityId", field: "id" },
  },
  "auth.me": { expected: "authenticated-object", requiresAuth: true },
  "onboarding.introductionTarget": {
    expected: "object",
    requiresAuth: true,
    identifier: { source: "circleId", field: "circleId" },
  },
  "circleHome.get": {
    expected: "circle-home-object",
    identifier: { source: "circleId", field: "circleId" },
  },
  "onboarding.status": { expected: "object", requiresAuth: true },
  "onboarding.recommendations": {
    expected: "object",
    requiresAuth: true,
    input: { limit: 6 },
  },
  "social.feed": { expected: "array", input: { filter: "for-you" } },
  "social.feedPage": {
    expected: "paged-object",
    input: { filter: "for-you", limit: 20 },
  },
  "social.circlesPage": { expected: "paged-object", input: { limit: 20 } },
  "social.profilesPage": { expected: "paged-object", input: { limit: 20 } },
  "social.membersPage": {
    expected: "paged-object",
    input: { limit: 20 },
    identifier: { source: "circleId", field: "circleId" },
  },
  "social.circles": { expected: "array", input: {} },
  "social.circle": {
    expected: "object",
    identifier: { source: "circleId", field: "id" },
  },
  "social.profiles": { expected: "array", input: {} },
  "social.profile": {
    expected: "object-or-null",
    identifier: { source: "profileId", field: "id" },
  },
  "social.members": {
    expected: "array",
    identifier: { source: "circleId", field: "circleId" },
  },
  "social.comments": {
    expected: "array",
    identifier: { source: "postId", field: "postId" },
  },
  "social.conversations": { expected: "array", requiresAuth: true },
  "social.messages": {
    expected: "array",
    requiresAuth: true,
    identifier: { source: "conversationId", field: "conversationId" },
  },
  "social.publicationStatus": {
    expected: "publication-status",
    requiresAuth: true,
  },
  "live.list": { expected: "array" },
  "live.signals": {
    expected: "array",
    requiresAuth: true,
    identifiers: [
      {
        source: "streamId",
        field: "streamId",
        missingReason: "missing_existing_stream_id",
        invalidReason: "invalid_existing_stream_id",
      },
      {
        source: "liveGeneration",
        field: "generation",
        manifestOverride: true,
        missingReason: "missing_current_live_generation",
        invalidReason: "invalid_current_live_generation",
      },
    ],
    exactIdentifierInput: true,
  },
  "live.relay": {
    expected: "object",
    requiresAuth: true,
    identifiers: [
      {
        source: "streamId",
        field: "streamId",
        missingReason: "missing_existing_stream_id",
        invalidReason: "invalid_existing_stream_id",
      },
      {
        source: "liveGeneration",
        field: "generation",
        manifestOverride: true,
        missingReason: "missing_current_live_generation",
        invalidReason: "invalid_current_live_generation",
      },
    ],
    exactIdentifierInput: true,
  },
  "live.chat": {
    expected: "array",
    requiresAuth: true,
    identifier: { source: "streamId", field: "streamId" },
  },
  "system.health": { expected: "health", input: { timestamp: 0 } },
});

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(name, reason) {
  return { name, reason };
}

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Parses a conservative dotenv export without writing process.env. */
export function parseEnvironmentText(text) {
  if (typeof text !== "string" || text.length > 128 * 1024) {
    throw new Error("environment_source_invalid");
  }
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error("environment_source_invalid");
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.includes("\0")) throw new Error("environment_source_invalid");
    result[key] = value;
  }
  return result;
}

function assertTrustedFile(
  filePath,
  fsModule = fs,
  { privateFile = false } = {},
) {
  const absolute = path.resolve(filePath);
  const stat = fsModule.lstatSync(absolute);
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  const notOwnedByCurrentUser = currentUid !== null && stat.uid !== currentUid;
  const unsafePermissions = privateFile
    ? (stat.mode & 0o077) !== 0
    : (stat.mode & 0o022) !== 0;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    notOwnedByCurrentUser ||
    unsafePermissions
  ) {
    throw new Error("environment_file_not_trusted");
  }
  return absolute;
}

function assertTrustedExecutable(filePath, fsModule = fs) {
  const absolute = assertTrustedFile(filePath, fsModule);
  if ((fsModule.lstatSync(absolute).mode & 0o111) === 0) {
    throw new Error("environment_command_not_executable");
  }
  return absolute;
}

function assertExporterArguments(commandArgs) {
  if (!Array.isArray(commandArgs) || commandArgs.length > 16) {
    throw new Error("environment_command_arguments_invalid");
  }
  for (const argument of commandArgs) {
    if (
      typeof argument !== "string" ||
      argument.length > 1_024 ||
      argument.includes("\0") ||
      /(?:token|secret|password|api[-_]?key|bearer|jwt)/i.test(argument)
    ) {
      throw new Error("environment_command_arguments_invalid");
    }
  }
  return commandArgs;
}

/**
 * Loads exactly one operator-selected environment source. Exporter stdout is
 * captured and parsed but never relayed to the terminal or included in reports.
 */
export function loadTrustedEnvironment({
  envFile,
  envCommand,
  envCommandArgs = [],
  environment = process.env,
  fsModule = fs,
  spawn = spawnSync,
}) {
  if (Boolean(envFile) === Boolean(envCommand)) {
    throw new Error("select_exactly_one_environment_source");
  }

  if (envFile) {
    const trustedPath = assertTrustedFile(envFile, fsModule, {
      privateFile: true,
    });
    return {
      source: "file",
      values: parseEnvironmentText(fsModule.readFileSync(trustedPath, "utf8")),
    };
  }

  if (!path.isAbsolute(envCommand)) {
    throw new Error("environment_command_must_be_absolute");
  }
  const trustedCommand = assertTrustedExecutable(envCommand, fsModule);
  const args = assertExporterArguments(envCommandArgs);
  const child = spawn(trustedCommand, args, {
    cwd: PROJECT_ROOT,
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: REQUEST_TIMEOUT_MS,
    maxBuffer: 128 * 1024,
  });
  if (child.error || child.status !== 0 || child.signal || !child.stdout) {
    throw new Error("environment_export_failed");
  }
  return { source: "command", values: parseEnvironmentText(child.stdout) };
}

function safeHttpOrigin(value) {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const CONFIGURED_API_ORIGIN_KEYS = Object.freeze([
  "EXPO_PUBLIC_API_BASE_URL",
  "API_BASE_URL",
  "API_ORIGIN",
]);

/**
 * Accept an already-canonical bare origin only. This keeps URL parser
 * normalization (case, default ports, credentials, paths, and whitespace) from
 * turning a different operator input into a bearer-bearing request target.
 */
function strictHttpOrigin(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  const parsed = safeHttpOrigin(value);
  return parsed?.origin === value ? parsed : null;
}

function hasFixedPort(url, port) {
  const effectivePort = url.port || (url.protocol === "https:" ? "443" : "80");
  return effectivePort === String(port);
}

function isTemporarySandboxHost(url) {
  return url.hostname.endsWith(".manus.computer");
}

function isLoopbackHost(url) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return ["127.0.0.1", "::1", "localhost"].includes(hostname);
}

function isInternalApiOrigin(origin) {
  return isLoopbackHost(origin) && hasFixedPort(origin, API_PORT);
}

function configuredApiOrigin(configuration = {}) {
  const supplied = CONFIGURED_API_ORIGIN_KEYS.filter((key) =>
    Object.hasOwn(configuration, key),
  );
  if (!supplied.length) return { origin: null, error: null };
  const origins = supplied.map((key) => strictHttpOrigin(configuration[key]));
  if (origins.some((origin) => !origin)) {
    return { origin: null, error: "configured_api_origin_invalid" };
  }
  if (!origins.every((origin) => origin.origin === origins[0].origin)) {
    return { origin: null, error: "configured_api_origin_ambiguous" };
  }
  return { origin: origins[0], error: null };
}

function explicitApiOrigin(operatorBaseUrl) {
  if (operatorBaseUrl === undefined) return { origin: null, error: null };
  const origin = strictHttpOrigin(operatorBaseUrl);
  return origin
    ? { origin, error: null }
    : { origin: null, error: "operator_api_origin_invalid" };
}

function verificationOrigin(value) {
  const origin = strictHttpOrigin(value);
  if (!origin) return null;
  if (origin.protocol === "http:" && !isLoopbackHost(origin)) return null;
  if (!isLoopbackHost(origin) && !hasFixedPort(origin, 443)) return null;
  return origin;
}

/**
 * Verify-only is a post-refresh/public-origin boundary. It deliberately accepts
 * a proxied HTTPS origin (including a current *.manus.computer port-443
 * Preview) without treating it as the internal API:3000 restart target.
 *
 * @param {Record<string, string | undefined>} configuration
 * @param {{ operatorBaseUrl?: string, credentialed?: boolean }} options
 */
export function validateVerificationConfiguration(
  configuration = {},
  { operatorBaseUrl, credentialed = false } = {},
) {
  const configured = configuredApiOrigin(configuration);
  const explicit = explicitApiOrigin(operatorBaseUrl);
  const selected = explicit.origin ?? configured.origin;
  const apiOrigin = selected ? verificationOrigin(selected.origin) : null;
  const credentialedTargetIsBound =
    !credentialed ||
    (apiOrigin &&
      (isInternalApiOrigin(apiOrigin) ||
        (configured.origin && apiOrigin.origin === configured.origin.origin)));
  return {
    ok:
      Boolean(apiOrigin) &&
      !configured.error &&
      !explicit.error &&
      credentialedTargetIsBound,
    errors:
      apiOrigin &&
      !configured.error &&
      !explicit.error &&
      credentialedTargetIsBound
        ? []
        : [
            issue(
              "API_BASE_URL",
              configured.error ??
                explicit.error ??
                (!apiOrigin
                  ? "must be an explicit canonical HTTPS origin or loopback API origin"
                  : "credentialed verification must use loopback or the exact trusted configured API origin"),
            ),
          ],
    apiBaseUrl:
      apiOrigin &&
      !configured.error &&
      !explicit.error &&
      credentialedTargetIsBound
        ? apiOrigin.origin
        : null,
  };
}

/**
 * Validates only configuration shape/presence and identity continuity. It never
 * opens a database or prints a value, DSN, token, or signing material.
 *
 * @param {Record<string, string | undefined>} configuration
 * @param {{ referenceEnvironment?: NodeJS.ProcessEnv, operatorBaseUrl?: string }} options
 */
export function validateRefreshConfiguration(
  configuration,
  { referenceEnvironment = process.env, operatorBaseUrl } = {},
) {
  const errors = [];
  for (const key of REQUIRED_RUNTIME_KEYS) {
    if (!hasValue(configuration[key])) errors.push(issue(key, "is required"));
  }
  if (
    hasValue(configuration.MANUS_JWT_SECRET) &&
    Array.from(configuration.MANUS_JWT_SECRET).length < 32
  ) {
    errors.push(
      issue("MANUS_JWT_SECRET", "must contain at least 32 characters"),
    );
  }
  for (const key of [
    "MANUS_OAUTH_PORTAL_URL",
    "MANUS_OAUTH_API_URL",
    "BUILT_IN_FORGE_API_URL",
  ]) {
    if (
      hasValue(configuration[key]) &&
      !safeHttpOrigin(configuration[key].trim())
    ) {
      errors.push(issue(key, "must be a credential-free HTTP(S) origin"));
    }
  }

  const configuredPort = configuration.PORT;
  if (hasValue(configuredPort) && configuredPort.trim() !== String(API_PORT)) {
    errors.push(issue("PORT", `must remain ${API_PORT}`));
  }
  for (const key of ["EXPO_PACKAGER_PROXY_URL", "EXPO_WEB_PREVIEW_URL"]) {
    if (!hasValue(configuration[key])) continue;
    const origin = safeHttpOrigin(configuration[key].trim());
    if (!origin || !hasFixedPort(origin, METRO_PORT)) {
      errors.push(issue(key, `must remain an HTTP(S) origin on ${METRO_PORT}`));
    }
  }

  const configured = configuredApiOrigin(configuration);
  const explicit = explicitApiOrigin(operatorBaseUrl);
  const apiOrigin = explicit.origin ?? configured.origin;
  if (configured.error || explicit.error) {
    errors.push(issue("API_BASE_URL", configured.error ?? explicit.error));
  }
  if (!apiOrigin || !hasFixedPort(apiOrigin, API_PORT)) {
    errors.push(
      issue(
        "API_BASE_URL",
        `must be a credential-free HTTP(S) origin on ${API_PORT}`,
      ),
    );
  } else if (isTemporarySandboxHost(apiOrigin)) {
    errors.push(
      issue("API_BASE_URL", "must not use a temporary Manus session hostname"),
    );
  } else if (
    !isInternalApiOrigin(apiOrigin) &&
    (!configured.origin || apiOrigin.origin !== configured.origin.origin)
  ) {
    errors.push(
      issue(
        "API_BASE_URL",
        "must use loopback API:3000 or exactly match the trusted configured API origin",
      ),
    );
  }

  if (hasValue(configuration.DATABASE_URL)) {
    try {
      const legacySource = new URL(configuration.DATABASE_URL);
      if (!["mysql:", "mysql2:"].includes(legacySource.protocol)) {
        errors.push(
          issue(
            "DATABASE_URL",
            "is reserved for a read-only MySQL migration or rollback source",
          ),
        );
      }
    } catch {
      errors.push(
        issue("DATABASE_URL", "must be a MySQL connection URL when supplied"),
      );
    }
  }

  for (const key of ["MANUS_PROJECT_ID", "MANUS_JWT_SECRET"]) {
    if (
      hasValue(referenceEnvironment[key]) &&
      hasValue(configuration[key]) &&
      referenceEnvironment[key] !== configuration[key]
    ) {
      errors.push(issue(key, "does not match the already configured identity"));
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    apiBaseUrl: errors.length === 0 ? (apiOrigin?.origin ?? null) : null,
  };
}

function extractProcedureBlocks(sourceText, namespace, indent) {
  const spaces = " ".repeat(indent);
  const startPattern = new RegExp(
    `^${spaces}([A-Za-z][A-Za-z0-9_]*)\\s*:\\s*(publicProcedure|protectedProcedure|adminProcedure)(?=\\.|\\s)`,
    "gm",
  );
  const starts = [...sourceText.matchAll(startPattern)];
  return starts
    .map((match, index) => {
      const chunk = sourceText.slice(
        match.index,
        starts[index + 1]?.index ?? sourceText.length,
      );
      if (!/\.query\s*\(/.test(chunk)) return null;
      return {
        name: `${namespace}.${match[1]}`,
        sourceAccess: match[2] === "publicProcedure" ? "public" : "protected",
      };
    })
    .filter(Boolean);
}

function extractAuthQueries(sourceText) {
  const authStart = sourceText.indexOf("auth: router({");
  if (authStart < 0) return [];
  const afterAuth = sourceText.slice(authStart);
  const authEnd = afterAuth.indexOf("\n  }),");
  const authBody = afterAuth.slice(0, authEnd < 0 ? afterAuth.length : authEnd);
  return extractProcedureBlocks(authBody, "auth", 4);
}

/**
 * Derives every .query procedure from the checked-out router files. Definitions
 * configure only safe read inputs/response shapes; missing/new source routes are
 * reported as drift rather than being assumed safe.
 */
export function deriveEndpointInventory(
  projectRoot = PROJECT_ROOT,
  fsModule = fs,
) {
  const discovered = [];
  for (const source of SOURCE_ROUTERS) {
    const sourceText = fsModule.readFileSync(
      path.join(projectRoot, source.file),
      "utf8",
    );
    discovered.push(
      ...extractProcedureBlocks(sourceText, source.namespace, source.indent),
    );
  }
  const rootText = fsModule.readFileSync(
    path.join(projectRoot, "server/routers.ts"),
    "utf8",
  );
  discovered.push(...extractAuthQueries(rootText));

  const names = new Set();
  const endpoints = discovered
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((discoveredEndpoint) => {
      if (names.has(discoveredEndpoint.name)) {
        return {
          ...discoveredEndpoint,
          supported: false,
          drift: "duplicate_route",
        };
      }
      names.add(discoveredEndpoint.name);
      const definition = ENDPOINT_DEFINITIONS[discoveredEndpoint.name];
      if (!definition) {
        return {
          ...discoveredEndpoint,
          supported: false,
          drift: "missing_definition",
        };
      }
      const requiresAuth =
        Boolean(definition.requiresAuth) ||
        discoveredEndpoint.sourceAccess === "protected";
      return {
        ...discoveredEndpoint,
        ...cloneJson(definition),
        requiresAuth,
        supported: true,
      };
    });

  const discoveredNames = new Set(discovered.map((endpoint) => endpoint.name));
  const missingConfigured = Object.keys(ENDPOINT_DEFINITIONS)
    .filter((name) => !discoveredNames.has(name))
    .sort();
  const classificationMismatch = endpoints
    .filter(
      (endpoint) =>
        endpoint.supported &&
        endpoint.name !== "auth.me" &&
        Boolean(ENDPOINT_DEFINITIONS[endpoint.name].requiresAuth) !==
          (endpoint.sourceAccess === "protected"),
    )
    .map((endpoint) => endpoint.name);

  return {
    endpoints,
    drift: {
      missingConfigured,
      unsupported: endpoints
        .filter((endpoint) => !endpoint.supported)
        .map((endpoint) => endpoint.name),
      classificationMismatch,
    },
  };
}

function boundedJson(value) {
  return (
    plainObject(value) &&
    Buffer.byteLength(JSON.stringify(value), "utf8") <= 4 * 1024
  );
}

function manifestInputIsSecretFree(value) {
  if (Array.isArray(value)) return value.every(manifestInputIsSecretFree);
  if (!plainObject(value)) return true;
  return Object.entries(value).every(
    ([key, nested]) =>
      !/(?:authorization|bearer|token|secret|password|api[-_]?key|cookie)/i.test(
        key,
      ) && manifestInputIsSecretFree(nested),
  );
}

/** Loads optional input overrides for source-derived query routes only. */
export function loadEndpointManifest(manifestPath, inventory, fsModule = fs) {
  if (!manifestPath) return {};
  let parsed;
  try {
    parsed = JSON.parse(
      fsModule.readFileSync(path.resolve(manifestPath), "utf8"),
    );
  } catch {
    throw new Error("endpoint_manifest_invalid");
  }
  if (
    !plainObject(parsed) ||
    parsed.version !== 1 ||
    !plainObject(parsed.endpoints)
  ) {
    throw new Error("endpoint_manifest_invalid");
  }
  const discovered = new Set(
    inventory.endpoints.map((endpoint) => endpoint.name),
  );
  const overrides = {};
  for (const [name, override] of Object.entries(parsed.endpoints)) {
    if (
      !discovered.has(name) ||
      !plainObject(override) ||
      !boundedJson(override.input) ||
      !manifestInputIsSecretFree(override.input)
    ) {
      throw new Error("endpoint_manifest_invalid");
    }
    if (Object.keys(override).some((key) => key !== "input")) {
      throw new Error("endpoint_manifest_invalid");
    }
    overrides[name] = { input: cloneJson(override.input) };
  }
  return overrides;
}

/** Reads an explicit, local bearer + existing-ID file without ever reporting it. */
export function loadVerificationAuth(authFile, fsModule = fs) {
  if (!authFile) return { bearerToken: null, ids: {} };
  const trustedPath = assertTrustedFile(authFile, fsModule, {
    privateFile: true,
  });
  let parsed;
  try {
    parsed = JSON.parse(fsModule.readFileSync(trustedPath, "utf8"));
  } catch {
    throw new Error("verification_auth_invalid");
  }
  if (
    !plainObject(parsed) ||
    !hasValue(parsed.bearerToken) ||
    parsed.bearerToken.length > 16_384
  ) {
    throw new Error("verification_auth_invalid");
  }
  const ids = plainObject(parsed.ids) ? parsed.ids : {};
  for (const [name, value] of Object.entries(ids)) {
    // Keep the live-signals generation value for its route-specific verifier
    // result. It is validated below, where an invalid current generation is
    // reported as incomplete instead of being turned into an opaque file error.
    if (name !== "liveGeneration" && !positiveInteger(value)) {
      throw new Error("verification_auth_invalid");
    }
  }
  const activeLiveContext = parsed.activeLiveContext;
  if (
    activeLiveContext !== undefined &&
    (!plainObject(activeLiveContext) ||
      !positiveInteger(activeLiveContext.streamId) ||
      !positiveInteger(activeLiveContext.generation) ||
      Object.keys(activeLiveContext).some(
        (key) => key !== "streamId" && key !== "generation",
      ))
  ) {
    throw new Error("verification_auth_invalid");
  }
  return {
    bearerToken: parsed.bearerToken,
    ids: cloneJson(ids),
    activeLiveContext: activeLiveContext ? cloneJson(activeLiveContext) : null,
  };
}

function endpointInput(endpoint, ids, manifest) {
  const knownIds = plainObject(ids) ? ids : {};
  const manifestInput = plainObject(manifest?.[endpoint.name]?.input)
    ? manifest[endpoint.name].input
    : undefined;
  const identifiers =
    endpoint.identifiers ?? (endpoint.identifier ? [endpoint.identifier] : []);
  let input =
    endpoint.input === undefined ? undefined : cloneJson(endpoint.input);
  if (manifestInput) input = cloneJson(manifestInput);
  const identifierInput = {};
  for (const identifier of identifiers) {
    const useManifestOverride =
      identifier.manifestOverride &&
      manifestInput &&
      Object.hasOwn(manifestInput, identifier.field);
    const value = useManifestOverride
      ? manifestInput[identifier.field]
      : knownIds[identifier.source];
    if (!positiveInteger(value)) {
      const reason =
        value === undefined
          ? (identifier.missingReason ?? "missing_existing_identifier")
          : (identifier.invalidReason ?? "missing_existing_identifier");
      return { ok: false, reason };
    }
    identifierInput[identifier.field] = value;
  }
  if (identifiers.length) {
    input = endpoint.exactIdentifierInput
      ? identifierInput
      : { ...(input ?? {}), ...identifierInput };
  }
  return { ok: true, input };
}

/**
 * Live reads need an operator-provided current host/viewer attestation in
 * addition to a bearer and source-reviewed stream/generation inputs. This is
 * deliberately a verification scope gate, not proof of a native/provider
 * session: without it, context-dependent positives remain incomplete.
 */
function hasActiveLiveContextAttestation(endpoint, input, auth) {
  if (!endpoint.name.startsWith("live.") || !endpoint.requiresAuth) return true;
  const context = auth?.activeLiveContext;
  if (!plainObject(context) || !positiveInteger(context.streamId)) return false;
  if (!positiveInteger(context.generation)) return false;
  if (!plainObject(input) || input.streamId !== context.streamId) return false;
  return (
    endpoint.name === "live.chat" || input.generation === context.generation
  );
}

async function readBoundedResponse(
  response,
  limit = RESPONSE_BODY_LIMIT_BYTES,
) {
  if (!response.body) return { ok: true, text: "" };
  let reader;
  try {
    reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "response_too_large" };
      }
      chunks.push(value);
    }
    return { ok: true, text: new TextDecoder().decode(Buffer.concat(chunks)) };
  } catch {
    return { ok: false, reason: "response_body_error" };
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // A malformed stream cannot make a structured recovery report escape.
    }
  }
}

function trpcPayload(text) {
  try {
    const parsed = JSON.parse(text);
    if (
      !plainObject(parsed) ||
      !plainObject(parsed.result) ||
      !plainObject(parsed.result.data)
    ) {
      return { ok: false, reason: "invalid_trpc_response" };
    }
    if (!("json" in parsed.result.data)) {
      return { ok: false, reason: "missing_trpc_data" };
    }
    return { ok: true, value: parsed.result.data.json };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

function expectedShape(value, expected, input) {
  if (expected === "array") return Array.isArray(value);
  if (expected === "platform-status") {
    const exact = (object, fields) =>
      plainObject(object) &&
      fields.every((field) => Object.hasOwn(object, field)) &&
      Object.keys(object).every((field) => fields.includes(field));
    if (!exact(value, ["integration", "feature_readiness", "settings"]))
      return false;
    if (
      !["active", "inactive"].includes(value.integration) ||
      typeof value.feature_readiness !== "boolean"
    )
      return false;
    if (value.integration === "inactive")
      return value.feature_readiness === false && value.settings === null;
    if (!value.feature_readiness) return value.settings === null;
    const fields = [
      "registrationsOpen",
      "circleCreationEnabled",
      "liveStreamingEnabled",
      "maintenanceMode",
      "maxUploadMb",
    ];
    return (
      exact(value.settings, fields) &&
      fields
        .slice(0, 4)
        .every((field) => typeof value.settings[field] === "boolean") &&
      Number.isInteger(value.settings.maxUploadMb) &&
      value.settings.maxUploadMb >= 1 &&
      value.settings.maxUploadMb <= 20
    );
  }
  if (expected.startsWith("moderation-")) {
    const id = (number) => positiveInteger(number) && number <= 2_147_483_647;
    const exact = (object, fields) =>
      plainObject(object) &&
      fields.every((field) => field in object) &&
      Object.keys(object).every((field) => fields.includes(field));
    const timestamp = (text) =>
      typeof text === "string" &&
      text.length <= 64 &&
      Number.isFinite(Date.parse(text));
    const text = (value, maximum) =>
      typeof value === "string" && Array.from(value).length <= maximum;
    if (
      !plainObject(input) ||
      !plainObject(value) ||
      !id(value.circleId) ||
      !id(value.viewerScope) ||
      value.circleId !== input.circleId ||
      value.viewerScope !== input.viewerScope
    )
      return false;
    const itemShape = (item) =>
      exact(item, [
        "id",
        "circleId",
        "postId",
        "status",
        "reportCount",
        "createdAt",
        "lastReportedAt",
        "resolvedAt",
        "canResolve",
        "blockedReason",
      ]) &&
      id(item.id) &&
      item.circleId === value.circleId &&
      (item.postId === null || id(item.postId)) &&
      ["open", "kept", "removed"].includes(item.status) &&
      positiveInteger(item.reportCount) &&
      item.reportCount <= 2_147_483_647 &&
      timestamp(item.createdAt) &&
      timestamp(item.lastReportedAt) &&
      (item.resolvedAt === null || timestamp(item.resolvedAt)) &&
      typeof item.canResolve === "boolean" &&
      (item.status === "open"
        ? item.resolvedAt === null &&
          (item.canResolve
            ? item.blockedReason === null
            : item.blockedReason === "self_review")
        : item.resolvedAt !== null &&
          !item.canResolve &&
          ["resolved", "self_review"].includes(item.blockedReason));
    if (expected === "moderation-page") {
      return (
        exact(value, ["circleId", "viewerScope", "items", "nextCursor"]) &&
        Array.isArray(value.items) &&
        value.items.length <= 50 &&
        value.items.every(
          (item, index) =>
            itemShape(item) &&
            (index === 0 || value.items[index - 1].id > item.id) &&
            (input.filter === "resolved"
              ? item.status !== "open"
              : item.status === "open"),
        ) &&
        (value.nextCursor === null ||
          (exact(value.nextCursor, ["id"]) &&
            id(value.nextCursor.id) &&
            value.items.length > 0 &&
            value.nextCursor.id === value.items[value.items.length - 1].id))
      );
    }
    if (
      expected !== "moderation-detail" ||
      !exact(value, [
        "circleId",
        "viewerScope",
        "item",
        "post",
        "reasons",
        "history",
      ]) ||
      !itemShape(value.item) ||
      value.item.id !== input.caseId
    )
      return false;
    if (
      !(
        value.post === null ||
        (plainObject(value.post) &&
          value.post.id === value.item.postId &&
          value.post.circleId === value.circleId &&
          text(value.post.text, 10_000) &&
          plainObject(value.post.author) &&
          id(value.post.author.id))
      )
    )
      return false;
    if (
      !Array.isArray(value.reasons) ||
      value.reasons.length > 20 ||
      !value.reasons.every(
        (reason) =>
          exact(reason, ["reason", "count"]) &&
          text(reason.reason, 500) &&
          positiveInteger(reason.count) &&
          reason.count <= value.item.reportCount,
      )
    )
      return false;
    return (
      Array.isArray(value.history) &&
      value.history.length <= 20 &&
      value.history.every(
        (action) =>
          exact(action, ["id", "decision", "note", "reviewer", "createdAt"]) &&
          id(action.id) &&
          ["keep", "remove"].includes(action.decision) &&
          text(action.note, 500) &&
          timestamp(action.createdAt) &&
          (action.reviewer === null ||
            (exact(action.reviewer, ["id", "name"]) &&
              id(action.reviewer.id) &&
              text(action.reviewer.name, 140))),
      )
    );
  }
  if (expected.startsWith("activity-")) {
    const id = (number) => positiveInteger(number) && number <= 2_147_483_647;
    const exact = (object, fields) =>
      plainObject(object) &&
      fields.every((field) => field in object) &&
      Object.keys(object).every((field) => fields.includes(field));
    const timestamp = (text) =>
      typeof text === "string" &&
      text.length <= 64 &&
      Number.isFinite(Date.parse(text));
    const label = (text) =>
      text === null ||
      (typeof text === "string" && Array.from(text).length <= 140);
    if (!plainObject(value) || !id(value.viewerId)) return false;
    if (expected === "activity-page") {
      if (
        !exact(value, ["viewerId", "items", "nextCursor"]) ||
        !Array.isArray(value.items) ||
        value.items.length > 40
      )
        return false;
      const items = value.items;
      if (
        !items.every(
          (item, index) =>
            exact(item, [
              "id",
              "kind",
              "createdAt",
              "readAt",
              "available",
              "actorName",
              "circleName",
            ]) &&
            id(item.id) &&
            (index === 0 || items[index - 1].id > item.id) &&
            ["comment_on_your_post", "membership_approved"].includes(
              item.kind,
            ) &&
            timestamp(item.createdAt) &&
            (item.readAt === null || timestamp(item.readAt)) &&
            typeof item.available === "boolean" &&
            label(item.actorName) &&
            label(item.circleName) &&
            (item.available ||
              (item.actorName === null && item.circleName === null)),
        )
      )
        return false;
      return (
        value.nextCursor === null ||
        (exact(value.nextCursor, ["beforeId"]) &&
          id(value.nextCursor.beforeId) &&
          items.length > 0 &&
          value.nextCursor.beforeId === items[items.length - 1].id)
      );
    }
    if (expected === "activity-unread") {
      return (
        exact(value, ["viewerId", "count", "throughId"]) &&
        Number.isInteger(value.count) &&
        value.count >= 0 &&
        value.count <= 2_147_483_647 &&
        Number.isInteger(value.throughId) &&
        value.throughId >= 0 &&
        value.throughId <= 2_147_483_647 &&
        (value.count === 0 || value.throughId > 0)
      );
    }
    if (expected === "activity-preferences") {
      return (
        exact(value, [
          "viewerId",
          "commentsEnabled",
          "membershipApprovalsEnabled",
          "circle",
        ]) &&
        typeof value.commentsEnabled === "boolean" &&
        typeof value.membershipApprovalsEnabled === "boolean" &&
        (value.circle === null ||
          (exact(value.circle, ["id", "name", "muted"]) &&
            id(value.circle.id) &&
            typeof value.circle.name === "string" &&
            Array.from(value.circle.name).length <= 140 &&
            typeof value.circle.muted === "boolean"))
      );
    }
    if (expected === "activity-target") {
      if (
        !exact(value, ["viewerId", "activityId", "target"]) ||
        !id(value.activityId)
      )
        return false;
      const target = value.target;
      if (target === null) return true;
      if (exact(target, ["type", "circleId"]) && target.type === "circle")
        return id(target.circleId);
      if (!exact(target, ["type", "post"]) || target.type !== "post")
        return false;
      const post = target.post;
      return (
        plainObject(post) &&
        id(post.id) &&
        (post.circleId === null || id(post.circleId)) &&
        typeof post.text === "string" &&
        plainObject(post.author) &&
        id(post.author.id)
      );
    }
    return false;
  }
  if (expected === "circle-home-object") {
    const fields = [
      "circleId",
      "viewerId",
      "welcomeMessage",
      "rules",
      "pinnedPost",
      "canManage",
      "updatedAt",
    ];
    if (
      !plainObject(value) ||
      !fields.every((field) => field in value) ||
      !Object.keys(value).every((field) => fields.includes(field)) ||
      !positiveInteger(value.circleId) ||
      !(value.viewerId === null || positiveInteger(value.viewerId)) ||
      typeof value.welcomeMessage !== "string" ||
      Array.from(value.welcomeMessage).length > 2_000 ||
      !Array.isArray(value.rules) ||
      value.rules.length > 10 ||
      !value.rules.every(
        (rule) =>
          typeof rule === "string" &&
          rule.trim().length > 0 &&
          rule === rule.trim() &&
          !/[\r\n]/.test(rule) &&
          Array.from(rule).length <= 300,
      ) ||
      new Set(
        value.rules.map((rule) =>
          rule.replace(/[A-Z]/g, (letter) => letter.toLowerCase()),
        ),
      ).size !== value.rules.length ||
      typeof value.canManage !== "boolean" ||
      (value.canManage && value.viewerId === null) ||
      typeof value.updatedAt !== "string" ||
      value.updatedAt.length > 64 ||
      !Number.isFinite(Date.parse(value.updatedAt))
    )
      return false;
    const post = value.pinnedPost;
    return (
      post === null ||
      (plainObject(post) &&
        positiveInteger(post.id) &&
        post.circleId === value.circleId &&
        typeof post.text === "string" &&
        plainObject(post.author) &&
        positiveInteger(post.author.id))
    );
  }
  if (expected === "paged-object") {
    if (
      !plainObject(value) ||
      !Array.isArray(value.items) ||
      value.items.length > 50 ||
      typeof value.hasMore !== "boolean"
    )
      return false;
    if (!value.hasMore) return value.nextCursor === null;
    const cursor = value.nextCursor;
    return (
      plainObject(cursor) &&
      positiveInteger(cursor.id) &&
      Object.keys(cursor).every((key) => key === "id" || key === "createdAt") &&
      (cursor.createdAt === undefined ||
        (typeof cursor.createdAt === "string" &&
          cursor.createdAt.length <= 64 &&
          Number.isFinite(Date.parse(cursor.createdAt))))
    );
  }
  if (expected === "object") return plainObject(value);
  if (expected === "object-or-null")
    return value === null || plainObject(value);
  if (expected === "publication-status") {
    return (
      plainObject(value) &&
      Object.hasOwn(value, "ready") &&
      Object.keys(value).length === 1 &&
      typeof value.ready === "boolean"
    );
  }
  if (expected === "authenticated-object") return plainObject(value);
  if (expected === "health") return plainObject(value) && value.ok === true;
  return false;
}

function isExpectedAnonymousDenial(status, text) {
  if (status === 401 || status === 403) return true;
  try {
    const parsed = JSON.parse(text);
    return (
      plainObject(parsed) &&
      plainObject(parsed.error) &&
      plainObject(parsed.error.data) &&
      parsed.error.data.code === "UNAUTHORIZED"
    );
  } catch {
    return false;
  }
}

function trpcUrl(apiBaseUrl, endpoint, input) {
  const url = new URL(`/api/trpc/${endpoint}`, apiBaseUrl);
  if (input !== undefined) {
    url.searchParams.set("input", JSON.stringify({ json: input }));
  }
  return url;
}

/** Performs one bounded GET query. No query body or response content is retained. */
export async function callReadOnlyQuery({
  apiBaseUrl,
  endpoint,
  input,
  bearerToken,
  fetchImpl = fetch,
}) {
  const headers = { Accept: "application/json" };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  let response;
  try {
    response = await fetchImpl(trpcUrl(apiBaseUrl, endpoint, input), {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  const bounded = await readBoundedResponse(response);
  if (!bounded.ok) return bounded;
  return { ok: response.ok, status: response.status, text: bounded.text };
}

function result(name, check, status, reason) {
  return { name, check, status, ...(reason ? { reason } : {}) };
}

/**
 * Verifies only source-derived GET query procedures. Protected routes get a
 * distinct anonymous-denial gate and, when supplied, a positive bearer test.
 */
export async function verifyReadOnlyEndpoints({
  apiBaseUrl,
  inventory,
  manifest = {},
  auth = { bearerToken: /** @type {string | null} */ (null), ids: {} },
  checkAnonymousGates = true,
  fetchImpl = fetch,
}) {
  const checks = [];
  let authenticatedContext = null;

  const ordered = [...inventory.endpoints].sort((left, right) => {
    if (left.name === "auth.me") return -1;
    if (right.name === "auth.me") return 1;
    return left.name.localeCompare(right.name);
  });

  for (const endpoint of ordered) {
    if (!endpoint.supported) {
      checks.push(
        result(endpoint.name, "positive", "skipped", "inventory_drift"),
      );
      continue;
    }
    const inputResult = endpointInput(endpoint, auth.ids, manifest);
    const requiresAuth = endpoint.requiresAuth;

    if (requiresAuth && checkAnonymousGates && inputResult.ok) {
      const anonymous = await callReadOnlyQuery({
        apiBaseUrl,
        endpoint: endpoint.name,
        input: inputResult.input,
        fetchImpl,
      });
      if (endpoint.name === "auth.me") {
        const payload = anonymous.ok ? trpcPayload(anonymous.text) : null;
        checks.push(
          anonymous.ok && payload?.ok && payload.value === null
            ? result(endpoint.name, "anonymous_state", "passed")
            : result(
                endpoint.name,
                "anonymous_state",
                "failed",
                "anonymous_state_unexpected",
              ),
        );
      } else {
        checks.push(
          isExpectedAnonymousDenial(anonymous.status, anonymous.text)
            ? result(endpoint.name, "anonymous_denial", "passed")
            : result(
                endpoint.name,
                "anonymous_denial",
                "failed",
                "anonymous_gate_unexpected",
              ),
        );
      }
    }

    if (!inputResult.ok) {
      checks.push(
        result(endpoint.name, "positive", "skipped", inputResult.reason),
      );
      continue;
    }
    if (requiresAuth && !auth.bearerToken) {
      checks.push(
        result(
          endpoint.name,
          "positive",
          "skipped",
          "missing_verification_auth",
        ),
      );
      continue;
    }
    if (!hasActiveLiveContextAttestation(endpoint, inputResult.input, auth)) {
      checks.push(
        result(
          endpoint.name,
          "positive",
          "skipped",
          "missing_active_live_context",
        ),
      );
      continue;
    }
    if (
      requiresAuth &&
      endpoint.name !== "auth.me" &&
      authenticatedContext !== true
    ) {
      checks.push(
        result(
          endpoint.name,
          "positive",
          "skipped",
          "no_active_viewer_context",
        ),
      );
      continue;
    }

    const positive = await callReadOnlyQuery({
      apiBaseUrl,
      endpoint: endpoint.name,
      input: inputResult.input,
      bearerToken: requiresAuth ? auth.bearerToken : undefined,
      fetchImpl,
    });
    const payload = positive.ok ? trpcPayload(positive.text) : null;
    const shapeMatches =
      payload?.ok &&
      expectedShape(payload.value, endpoint.expected, inputResult.input);
    checks.push(
      shapeMatches
        ? result(endpoint.name, "positive", "passed")
        : result(
            endpoint.name,
            "positive",
            "failed",
            "query_failed_or_shape_invalid",
          ),
    );
    if (endpoint.name === "auth.me")
      authenticatedContext = Boolean(shapeMatches);
  }

  const positive = checks.filter((check) => check.check === "positive");
  const summary = {
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
    skipped: checks.filter((check) => check.status === "skipped").length,
    declaredQueries: inventory.endpoints.length,
    completedPositiveQueries: positive.filter(
      (check) => check.status === "passed",
    ).length,
  };
  return {
    checks,
    summary,
    complete:
      summary.failed === 0 &&
      summary.skipped === 0 &&
      !inventory.drift.missingConfigured.length &&
      !inventory.drift.unsupported.length &&
      !inventory.drift.classificationMismatch.length,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * A finite post-restart readiness check using an actual public data query, not
 * only /api/health. This is intentionally separate from the source-derived final
 * inventory and cannot loop indefinitely.
 */
export async function waitForApiReadiness({
  apiBaseUrl,
  fetchImpl = fetch,
  sleep = delay,
}) {
  for (let attempt = 1; attempt <= READINESS_ATTEMPTS; attempt += 1) {
    const response = await callReadOnlyQuery({
      apiBaseUrl,
      endpoint: "social.feed",
      input: { filter: "for-you" },
      fetchImpl,
    });
    const payload = response.ok ? trpcPayload(response.text) : null;
    if (payload?.ok && Array.isArray(payload.value)) {
      return { ok: true, attempts: attempt };
    }
    if (attempt < READINESS_ATTEMPTS) await sleep(READINESS_RETRY_DELAY_MS);
  }
  return { ok: false, attempts: READINESS_ATTEMPTS };
}

/** True only when current source references the reviewed durable session authority. */
export function authBuildRequiresSessionSchema(
  projectRoot = PROJECT_ROOT,
  fsModule = fs,
) {
  const candidates = [
    "server/_core/application-sessions.ts",
    "server/_core/sdk.ts",
    "drizzle/session-schema.ts",
  ];
  return candidates.some((relativePath) => {
    const filename = path.join(projectRoot, relativePath);
    return (
      fsModule.existsSync(filename) &&
      /applicationSessions/.test(fsModule.readFileSync(filename, "utf8"))
    );
  });
}

function privateCatalogQuery(text, values = []) {
  return { text, values, query_timeout: DATABASE_QUERY_TIMEOUT_MS };
}

/** @typedef {{ text: string, values: unknown[], query_timeout: number }} PrivateCatalogQuery */
/** @typedef {{ rows: unknown[] }} PrivateCatalogResult */
/**
 * @typedef {{
 *   connect: () => Promise<unknown>,
 *   query: (query: PrivateCatalogQuery) => Promise<PrivateCatalogResult> | PrivateCatalogResult,
 *   end: () => Promise<unknown>
 * }} ReadOnlyPostgresClient
 */
/** @typedef {{ Client: new (options: Record<string, unknown>) => ReadOnlyPostgresClient }} ReadOnlyPgModule */
/** @typedef {(configuration: Record<string, string | undefined>, projectRoot: string) => Record<string, unknown>} ConnectionOptionsFactory */
/** @typedef {{ projectRoot?: string, pgModule?: ReadOnlyPgModule, connectionOptions?: ConnectionOptionsFactory }} DatabaseReadinessOptions */

function applicationColumnsAreComplete(rows) {
  if (!Array.isArray(rows)) return false;
  const discovered = new Map();
  for (const row of rows) {
    if (
      typeof row?.table_name !== "string" ||
      typeof row?.column_name !== "string"
    )
      return false;
    if (!Object.hasOwn(REQUIRED_APPLICATION_COLUMNS, row.table_name))
      return false;
    const columns = discovered.get(row.table_name) ?? new Set();
    columns.add(row.column_name);
    discovered.set(row.table_name, columns);
  }
  return Object.entries(REQUIRED_APPLICATION_COLUMNS).every(
    ([table, columns]) => {
      const actual = discovered.get(table);
      return (
        actual &&
        actual.size === columns.length &&
        columns.every((column) => actual.has(column))
      );
    },
  );
}

function applicationTablesAreSecured(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== REQUIRED_APPLICATION_TABLES.length
  )
    return false;
  const discovered = new Map(rows.map((row) => [row?.table_name, row]));
  return REQUIRED_APPLICATION_TABLES.every((table) => {
    const row = discovered.get(table);
    if (row?.rls_enabled !== true || row?.can_select !== true) return false;
    // Import completion markers are visible to runtime for state awareness but
    // remain administrator/importer-owned and cannot be changed by the API role.
    if (table === "_dataMigrations") {
      return (
        row?.can_insert === false &&
        row?.can_update === false &&
        row?.can_delete === false
      );
    }
    if (table === "moderationActions") {
      return (
        row?.can_insert === true &&
        row?.can_update === false &&
        row?.can_delete === false
      );
    }
    return (
      row?.can_insert === true &&
      row?.can_update === true &&
      row?.can_delete === true
    );
  });
}

function runtimeRoleIsRestricted(rows) {
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return Boolean(
    row &&
    row.rolname === APPLICATION_RUNTIME_ROLE &&
    row.rolcanlogin === false &&
    row.rolinherit === false &&
    row.rolbypassrls === false &&
    row.rolsuper === false,
  );
}

function identitySequencesAreComplete(rows) {
  if (!Array.isArray(rows) || rows.length !== REQUIRED_IDENTITY_TABLES.length) {
    return false;
  }
  const discovered = new Map(rows.map((row) => [row?.table_name, row]));
  return REQUIRED_IDENTITY_TABLES.every((table) => {
    const row = discovered.get(table);
    return (
      row?.expected_sequence_name === REQUIRED_IDENTITY_SEQUENCES[table] &&
      row?.sequence_name === REQUIRED_IDENTITY_SEQUENCES[table] &&
      row?.owner_table_name === table &&
      row?.owner_column_name === "id" &&
      row?.is_identity === true &&
      row?.can_use_sequence === true &&
      row?.can_select_sequence === true &&
      row?.can_update_sequence === false &&
      row?.observed_sequence_count === REQUIRED_IDENTITY_TABLES.length
    );
  });
}

function runtimePoliciesAreExact(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== REQUIRED_APPLICATION_TABLES.length
  ) {
    return false;
  }
  const discovered = new Map(rows.map((row) => [row?.table_name, row]));
  return REQUIRED_APPLICATION_TABLES.every((table) => {
    const expected = REQUIRED_RUNTIME_POLICIES[table];
    const row = discovered.get(table);
    if (
      !expected ||
      row?.policy_name !== expected.name ||
      row?.policy_command !== expected.command ||
      row?.runtime_role_only !== true ||
      row?.policy_permissive !== true ||
      row?.using_expression !== "true"
    ) {
      return false;
    }
    return expected.command === "r"
      ? row?.with_check_expression === null
      : row?.with_check_expression === "true";
  });
}

async function getSharedPostgresConnectionOptions(configuration, projectRoot) {
  const helperPath = pathToFileURL(
    path.join(projectRoot, "server", "_core", "postgres-config.mjs"),
  ).href;
  const helper = await import(helperPath);
  if (
    helper.PRIVATE_SCHEMA !== APPLICATION_SCHEMA ||
    helper.RUNTIME_ROLE !== APPLICATION_RUNTIME_ROLE ||
    typeof helper.getPostgresConnectionOptions !== "function"
  ) {
    throw new Error("postgres_helper_contract_invalid");
  }
  return helper.getPostgresConnectionOptions(configuration, projectRoot);
}

/**
 * @param {Record<string, string | undefined>} configuration
 * @param {string} projectRoot
 * @param {DatabaseReadinessOptions} [options]
 */
async function openReadOnlyPostgresConnection(
  configuration,
  projectRoot,
  { pgModule, connectionOptions } = {},
) {
  const pg =
    pgModule ?? createRequire(path.join(projectRoot, "package.json"))("pg");
  const options = connectionOptions
    ? connectionOptions(configuration, projectRoot)
    : await getSharedPostgresConnectionOptions(configuration, projectRoot);
  const client = new pg.Client({
    ...options,
    connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
    query_timeout: DATABASE_QUERY_TIMEOUT_MS,
  });
  await client.connect();
  return client;
}

/** @param {ReadOnlyPostgresClient | undefined} connection */
async function closeDatabaseConnection(connection) {
  if (connection) await connection.end().catch(() => undefined);
}

/**
 * Confirms the shared PostgreSQL configuration reaches database postgres. No
 * managed MySQL URL is read or accepted as a runtime fallback.
 *
 * @param {Record<string, string | undefined>} configuration
 * @param {DatabaseReadinessOptions} [options]
 */
export async function checkDatabaseReady(
  configuration,
  { projectRoot = PROJECT_ROOT, pgModule, connectionOptions } = {},
) {
  let connection;
  try {
    connection = await openReadOnlyPostgresConnection(
      configuration,
      projectRoot,
      {
        pgModule,
        connectionOptions,
      },
    );
    const result = await connection.query(
      privateCatalogQuery("SELECT current_database() AS database_name"),
    );
    return (
      Array.isArray(result?.rows) &&
      result.rows.length === 1 &&
      result.rows[0]?.database_name === "postgres"
    );
  } catch {
    return false;
  } finally {
    await closeDatabaseConnection(connection);
  }
}

/**
 * Verifies role, schema use, every required table/column, RLS/DML grants,
 * exact backend policies, session indexes, and the complete identity-sequence
 * ownership/privilege inventory with bounded catalog reads only. It never
 * reads app data, performs DDL, or mutates the target.
 *
 * @param {Record<string, string | undefined>} configuration
 * @param {DatabaseReadinessOptions} [options]
 */
export async function checkApplicationSchema(
  configuration,
  { projectRoot = PROJECT_ROOT, pgModule, connectionOptions } = {},
) {
  let connection;
  try {
    connection = await openReadOnlyPostgresConnection(
      configuration,
      projectRoot,
      {
        pgModule,
        connectionOptions,
      },
    );
    const role = await connection.query(
      privateCatalogQuery(
        "SELECT rolname, rolcanlogin, rolinherit, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1 LIMIT 1",
        [APPLICATION_RUNTIME_ROLE],
      ),
    );
    if (!runtimeRoleIsRestricted(role?.rows)) return false;

    const schema = await connection.query(
      privateCatalogQuery(
        "SELECT has_schema_privilege($1, $2, 'USAGE') AS can_use_schema",
        [APPLICATION_RUNTIME_ROLE, APPLICATION_SCHEMA],
      ),
    );
    if (schema?.rows?.[0]?.can_use_schema !== true) return false;

    const columns = await connection.query(
      privateCatalogQuery(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = ANY($2::text[]) ORDER BY table_name, ordinal_position",
        [APPLICATION_SCHEMA, REQUIRED_APPLICATION_TABLES],
      ),
    );
    if (!applicationColumnsAreComplete(columns?.rows)) return false;

    const tables = await connection.query(
      privateCatalogQuery(
        "SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, has_table_privilege($2, c.oid, 'SELECT') AS can_select, has_table_privilege($2, c.oid, 'INSERT') AS can_insert, has_table_privilege($2, c.oid, 'UPDATE') AS can_update, has_table_privilege($2, c.oid, 'DELETE') AS can_delete FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND c.relname = ANY($3::text[]) ORDER BY c.relname",
        [
          APPLICATION_SCHEMA,
          APPLICATION_RUNTIME_ROLE,
          REQUIRED_APPLICATION_TABLES,
        ],
      ),
    );
    if (!applicationTablesAreSecured(tables?.rows)) return false;

    const policies = await connection.query(
      privateCatalogQuery(
        "SELECT c.relname AS table_name, p.polname AS policy_name, p.polcmd AS policy_command, p.polpermissive AS policy_permissive, p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = $2)]::oid[] AS runtime_role_only, pg_get_expr(p.polqual, p.polrelid) AS using_expression, CASE WHEN p.polwithcheck IS NULL THEN NULL ELSE pg_get_expr(p.polwithcheck, p.polrelid) END AS with_check_expression FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace JOIN pg_policy AS p ON p.polrelid = c.oid WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND c.relname = ANY($3::text[]) ORDER BY c.relname, p.polname",
        [
          APPLICATION_SCHEMA,
          APPLICATION_RUNTIME_ROLE,
          REQUIRED_APPLICATION_TABLES,
        ],
      ),
    );
    if (!runtimePoliciesAreExact(policies?.rows)) return false;

    const indexes = await connection.query(
      privateCatalogQuery(
        "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2",
        [APPLICATION_SCHEMA, SESSION_TABLE],
      ),
    );
    const indexNames = new Set(
      (indexes?.rows ?? []).map((row) => row?.indexname),
    );
    if (!SESSION_INDEXES.every((name) => indexNames.has(name))) return false;

    const sequences = await connection.query(
      privateCatalogQuery(
        "WITH expected(table_name, expected_sequence_name) AS (SELECT * FROM unnest($2::text[], $3::text[])), app_sequences AS (SELECT c.oid, c.relname AS sequence_name FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind = 'S'), sequence_owners AS (SELECT sequence_relation.relname AS sequence_name, table_relation.relname AS owner_table_name, attribute_catalog.attname AS owner_column_name, attribute_catalog.attidentity IN ('a', 'd') AS is_identity FROM pg_depend AS dependency_catalog JOIN pg_class AS sequence_relation ON sequence_relation.oid = dependency_catalog.objid JOIN pg_class AS table_relation ON table_relation.oid = dependency_catalog.refobjid JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_relation.relnamespace JOIN pg_attribute AS attribute_catalog ON attribute_catalog.attrelid = table_relation.oid AND attribute_catalog.attnum = dependency_catalog.refobjsubid WHERE dependency_catalog.deptype = 'i' AND table_namespace.nspname = $1) SELECT expected.table_name, expected.expected_sequence_name, app_sequences.sequence_name, sequence_owners.owner_table_name, sequence_owners.owner_column_name, sequence_owners.is_identity, has_sequence_privilege($4, app_sequences.oid, 'USAGE') AS can_use_sequence, has_sequence_privilege($4, app_sequences.oid, 'SELECT') AS can_select_sequence, has_sequence_privilege($4, app_sequences.oid, 'UPDATE') AS can_update_sequence, (SELECT count(*)::integer FROM app_sequences) AS observed_sequence_count FROM expected LEFT JOIN app_sequences ON app_sequences.sequence_name = expected.expected_sequence_name LEFT JOIN sequence_owners ON sequence_owners.sequence_name = app_sequences.sequence_name ORDER BY expected.table_name",
        [
          APPLICATION_SCHEMA,
          REQUIRED_IDENTITY_TABLES,
          REQUIRED_IDENTITY_TABLES.map(
            (table) => REQUIRED_IDENTITY_SEQUENCES[table],
          ),
          APPLICATION_RUNTIME_ROLE,
        ],
      ),
    );
    return identitySequencesAreComplete(sequences?.rows);
  } catch {
    return false;
  } finally {
    await closeDatabaseConnection(connection);
  }
}

/** Compatibility export; durable-session verification is now part of full app readiness. */
export const checkApplicationSessionSchema = checkApplicationSchema;

function restrictedRuntimeEnvironment(referenceEnvironment, configuration) {
  const runtime = { PATH: referenceEnvironment.PATH ?? "/usr/bin:/bin" };
  for (const key of SAFE_RUNTIME_KEYS) {
    if (hasValue(referenceEnvironment[key]))
      runtime[key] = referenceEnvironment[key];
    if (hasValue(configuration[key])) runtime[key] = configuration[key];
  }
  runtime.PORT = String(API_PORT);
  return runtime;
}

function trustedPm2ManagerEnvironment(referenceEnvironment) {
  const home = referenceEnvironment.HOME;
  const pm2Home = referenceEnvironment.PM2_HOME;
  const isTrustedPath = (value) =>
    hasValue(value) &&
    value.length <= 4_096 &&
    !value.includes("\0") &&
    path.isAbsolute(value);
  if (!isTrustedPath(home) || !isTrustedPath(pm2Home)) return null;
  return { HOME: home, PM2_HOME: pm2Home };
}

function finiteSpawn(command, args, environment, spawn = spawnSync) {
  const child = spawn(command, args, {
    env: environment,
    shell: false,
    detached: false,
    stdio: "ignore",
    timeout: RESTART_TIMEOUT_MS,
    killSignal: "SIGTERM",
  });
  return !child.error && child.status === 0 && !child.signal;
}

/**
 * Restarts the only accepted API service name. No shell, wildcard process kill,
 * arbitrary PID, Metro process, detached child, or secret-bearing argv is used.
 */
export function restartKnownApiService(
  /** @type {any} */ {
    serviceName,
    serviceManager,
    restartAdapter,
    configuration,
    referenceEnvironment = process.env,
    spawn = spawnSync,
  },
) {
  if (serviceName !== ALLOWED_SERVICE_NAME)
    return { ok: false, reason: "unsafe_service_target" };
  const environment = restrictedRuntimeEnvironment(
    referenceEnvironment,
    configuration,
  );
  if (serviceManager === "systemd" && !restartAdapter) {
    return {
      ok: finiteSpawn(
        "systemctl",
        ["restart", serviceName],
        environment,
        spawn,
      ),
      reason: "restart_failed",
    };
  }
  if (serviceManager === "pm2" && !restartAdapter) {
    const pm2ManagerEnvironment =
      trustedPm2ManagerEnvironment(referenceEnvironment);
    if (!pm2ManagerEnvironment) {
      return { ok: false, reason: "pm2_manager_context_required" };
    }
    return {
      ok: finiteSpawn(
        "pm2",
        ["restart", serviceName, "--update-env"],
        { ...environment, ...pm2ManagerEnvironment },
        spawn,
      ),
      reason: "restart_failed",
    };
  }
  if (restartAdapter) {
    try {
      assertTrustedExecutable(restartAdapter);
    } catch {
      return { ok: false, reason: "restart_adapter_not_trusted" };
    }
    return {
      ok: finiteSpawn(restartAdapter, [serviceName], environment, spawn),
      reason: "restart_failed",
    };
  }
  return { ok: false, reason: "restart_manager_required" };
}

function emptyVerification() {
  return {
    checks: [],
    summary: {
      passed: 0,
      failed: 0,
      skipped: 0,
      declaredQueries: 0,
      completedPositiveQueries: 0,
    },
    complete: false,
  };
}

/** A dry run never claims data coverage because it deliberately makes no request. */
function dryRunVerification(inventory, manifest, auth) {
  const checks = inventory.endpoints.map((endpoint) => {
    if (!endpoint.supported) {
      return result(endpoint.name, "positive", "skipped", "inventory_drift");
    }
    const input = endpointInput(endpoint, auth.ids, manifest);
    if (!input.ok) {
      return result(endpoint.name, "positive", "skipped", input.reason);
    }
    if (endpoint.requiresAuth && !auth.bearerToken) {
      return result(
        endpoint.name,
        "positive",
        "skipped",
        "missing_verification_auth",
      );
    }
    return result(endpoint.name, "positive", "skipped", "dry_run_not_verified");
  });
  return {
    checks,
    summary: {
      passed: 0,
      failed: 0,
      skipped: checks.length,
      declaredQueries: inventory.endpoints.length,
      completedPositiveQueries: 0,
    },
    complete: false,
  };
}

/**
 * Orchestrates a single guarded run. Dependency injection keeps tests synthetic:
 * no test needs a real DB, service manager, browser, provider, or .env file.
 */
export async function runRecovery(
  /** @type {any} */ {
    mode = "dry-run",
    configuration,
    environmentSource,
    envFile,
    envCommand,
    envCommandArgs,
    operatorBaseUrl,
    auth,
    authFile,
    endpointManifest,
    manifest,
    projectRoot = PROJECT_ROOT,
    projectDir,
    referenceEnvironment = process.env,
    strict = false,
    checkAnonymousGates = true,
    serviceName,
    serviceManager,
    restartAdapter,
    forceSessionSchemaCheck = false,
    databaseReady = checkDatabaseReady,
    schemaCheck = checkApplicationSchema,
    restart = restartKnownApiService,
    readinessCheck = waitForApiReadiness,
    sleep = delay,
    fetchImpl = fetch,
    fsModule = fs,
  },
) {
  const report = {
    mode,
    ok: false,
    configuration: { ok: false, errors: [] },
    database: {
      required: mode !== "verify-only",
      ok: mode === "verify-only" ? null : false,
    },
    applicationSchema: {
      required: mode !== "verify-only",
      ok: mode === "verify-only" ? null : false,
    },
    restart: { attempted: false, ok: null },
    readiness: { attempted: false, ok: null, attempts: 0 },
    inventory: {
      declaredQueries: 0,
      drift: {
        missingConfigured: [],
        unsupported: [],
        classificationMismatch: [],
      },
    },
    verification: emptyVerification(),
  };
  if (mode !== "dry-run" && mode !== "apply" && mode !== "verify-only") {
    report.configuration.errors = [
      issue("mode", "must be dry-run, apply or verify-only"),
    ];
    return report;
  }

  const selectedProjectRoot = projectDir ?? projectRoot;
  if (
    typeof selectedProjectRoot !== "string" ||
    !path.isAbsolute(selectedProjectRoot)
  ) {
    report.configuration.errors = [
      issue("projectDir", "must be an absolute source repository path"),
    ];
    return report;
  }

  let selectedEnvironment;
  try {
    selectedEnvironment =
      mode === "verify-only" && !configuration && !envFile && !envCommand
        ? { source: "explicit-api-origin", values: {} }
        : configuration
          ? { source: environmentSource ?? "injected", values: configuration }
          : loadTrustedEnvironment({
              envFile,
              envCommand,
              envCommandArgs,
              environment: referenceEnvironment,
              fsModule,
            });
  } catch (error) {
    report.configuration.errors = [
      issue(
        "environment",
        error instanceof Error ? error.message : "environment_source_invalid",
      ),
    ];
    return report;
  }

  const preflight =
    mode === "verify-only"
      ? validateVerificationConfiguration(selectedEnvironment.values, {
          operatorBaseUrl,
          // Reject an unbound target before loadVerificationAuth can read a bearer.
          credentialed: Boolean(auth?.bearerToken) || Boolean(authFile),
        })
      : validateRefreshConfiguration(selectedEnvironment.values, {
          referenceEnvironment,
          operatorBaseUrl,
        });
  report.configuration = { ok: preflight.ok, errors: preflight.errors };
  if (!preflight.ok) return report;

  let discovered;
  try {
    discovered = deriveEndpointInventory(selectedProjectRoot, fsModule);
    report.inventory = {
      declaredQueries: discovered.endpoints.length,
      drift: discovered.drift,
    };
  } catch {
    report.configuration = {
      ok: false,
      errors: [issue("inventory", "source_inventory_unavailable")],
    };
    return report;
  }

  let selectedManifest;
  let selectedAuth;
  try {
    selectedManifest =
      manifest ?? loadEndpointManifest(endpointManifest, discovered, fsModule);
    selectedAuth = auth ?? loadVerificationAuth(authFile, fsModule);
  } catch (error) {
    report.configuration = {
      ok: false,
      errors: [
        issue(
          "verification",
          error instanceof Error ? error.message : "verification_input_invalid",
        ),
      ],
    };
    return report;
  }

  if (mode !== "verify-only") {
    try {
      report.database.ok = Boolean(
        await databaseReady(selectedEnvironment.values, {
          projectRoot: selectedProjectRoot,
        }),
      );
    } catch {
      report.database.ok = false;
    }
    if (!report.database.ok) return report;

    // Durable sessions are part of the complete application catalog contract.
    // The retained CLI flag cannot weaken the now-mandatory private-schema check.
    void forceSessionSchemaCheck;
    try {
      report.applicationSchema.ok = Boolean(
        await schemaCheck(selectedEnvironment.values, {
          projectRoot: selectedProjectRoot,
        }),
      );
    } catch {
      report.applicationSchema.ok = false;
    }
    if (!report.applicationSchema.ok) return report;
  }

  const hasInventoryDrift =
    discovered.drift.missingConfigured.length > 0 ||
    discovered.drift.unsupported.length > 0 ||
    discovered.drift.classificationMismatch.length > 0;
  if (mode === "dry-run") {
    report.verification = dryRunVerification(
      discovered,
      selectedManifest,
      selectedAuth,
    );
    report.ok = !strict && !hasInventoryDrift;
    return report;
  }

  if (mode === "verify-only") {
    report.verification = await verifyReadOnlyEndpoints({
      apiBaseUrl: preflight.apiBaseUrl,
      inventory: discovered,
      manifest: selectedManifest,
      auth: selectedAuth,
      checkAnonymousGates,
      fetchImpl,
    });
    report.ok =
      report.verification.summary.failed === 0 &&
      (!strict || (report.verification.complete && !hasInventoryDrift));
    return report;
  }

  report.restart.attempted = true;
  const restarted = await restart({
    serviceName,
    serviceManager,
    restartAdapter,
    configuration: selectedEnvironment.values,
    referenceEnvironment,
  });
  report.restart.ok = Boolean(restarted?.ok);
  if (!report.restart.ok) {
    report.restart.reason = restarted?.reason ?? "restart_failed";
    return report;
  }

  report.readiness.attempted = true;
  try {
    const readiness = await readinessCheck({
      apiBaseUrl: preflight.apiBaseUrl,
      fetchImpl,
      sleep,
    });
    report.readiness.ok = Boolean(readiness?.ok);
    report.readiness.attempts = Number.isSafeInteger(readiness?.attempts)
      ? readiness.attempts
      : READINESS_ATTEMPTS;
  } catch {
    report.readiness.ok = false;
    report.readiness.attempts = READINESS_ATTEMPTS;
  }
  if (!report.readiness.ok) return report;

  report.verification = await verifyReadOnlyEndpoints({
    apiBaseUrl: preflight.apiBaseUrl,
    inventory: discovered,
    manifest: selectedManifest,
    auth: selectedAuth,
    checkAnonymousGates,
    fetchImpl,
  });
  report.ok =
    report.verification.summary.failed === 0 &&
    (!strict || (report.verification.complete && !hasInventoryDrift));
  return report;
}

export function parseCliArguments(argv) {
  const options = { mode: "dry-run", strict: false, checkAnonymousGates: true };
  let explicitMode;
  const setMode = (mode) => {
    if (explicitMode && explicitMode !== mode)
      throw new Error("recovery_mode_ambiguous");
    explicitMode = mode;
    options.mode = mode;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") setMode("apply");
    else if (argument === "--dry-run") setMode("dry-run");
    else if (argument === "--verify-only") setMode("verify-only");
    else if (argument === "--strict") options.strict = true;
    else if (argument === "--no-anonymous-gates")
      options.checkAnonymousGates = false;
    else if (argument === "--require-session-schema")
      options.forceSessionSchemaCheck = true;
    else if (argument === "--env-command-arg") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error("argument_value_missing");
      options.envCommandArgs ??= [];
      options.envCommandArgs.push(value);
      index += 1;
    } else if (
      [
        "--env-file",
        "--env-command",
        "--api-base-url",
        "--auth-file",
        "--endpoint-manifest",
        "--service-name",
        "--service-manager",
        "--restart-adapter",
        "--project-dir",
      ].includes(argument)
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error("argument_value_missing");
      const key = {
        "--env-file": "envFile",
        "--env-command": "envCommand",
        "--api-base-url": "operatorBaseUrl",
        "--auth-file": "authFile",
        "--endpoint-manifest": "endpointManifest",
        "--service-name": "serviceName",
        "--service-manager": "serviceManager",
        "--restart-adapter": "restartAdapter",
        "--project-dir": "projectDir",
      }[argument];
      options[key] = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error("argument_invalid");
    }
  }
  if (
    options.serviceManager &&
    !["systemd", "pm2"].includes(options.serviceManager)
  ) {
    throw new Error("service_manager_invalid");
  }
  if (options.projectDir && !path.isAbsolute(options.projectDir)) {
    throw new Error("project_dir_must_be_absolute");
  }
  if (
    options.mode === "verify-only" &&
    (options.serviceName ||
      options.serviceManager ||
      options.restartAdapter ||
      options.forceSessionSchemaCheck)
  ) {
    throw new Error("verify_only_restart_options_invalid");
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/recover-api.mjs --dry-run|--apply --env-file /trusted/runtime.env [options]",
    "       node scripts/recover-api.mjs --dry-run|--apply --env-command /trusted/exporter --env-command-arg export [options]",
    "       node scripts/recover-api.mjs --verify-only --api-base-url https://published-api.example --project-dir /absolute/circles [options]",
    "Options: --service-name circles-api --service-manager systemd|pm2 | --restart-adapter /absolute/adapter",
    "         --auth-file /private/auth.json --endpoint-manifest examples/recover-api.manifest.json --strict",
    "         --api-base-url https://known-api.example --project-dir /absolute/circles --require-session-schema --no-anonymous-gates",
  ].join("\n");
}

async function main() {
  let options;
  try {
    options = parseCliArguments(process.argv.slice(2));
  } catch {
    console.error("recover-api: invalid arguments");
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const report = await runRecovery(options);
  // Report deliberately contains only names, categories, route names and counts.
  console.log(JSON.stringify(report));
  return report.ok ? 0 : 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main();
}
