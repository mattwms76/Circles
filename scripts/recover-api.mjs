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
import { fileURLToPath } from "node:url";
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
export const SESSION_TABLE = "applicationSessions";
export const SESSION_INDEXES = Object.freeze([
  "application_sessions_user_app_idx",
  "application_sessions_expiry_idx",
]);

const REQUIRED_RUNTIME_KEYS = Object.freeze([
  "MANUS_PROJECT_ID",
  "MANUS_OAUTH_PORTAL_URL",
  "MANUS_OAUTH_API_URL",
  "MANUS_JWT_SECRET",
  "DATABASE_URL",
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
  "DATABASE_URL",
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
  "VITE_APP_ID",
  "VITE_OAUTH_PORTAL_URL",
  "WEB_ORIGIN",
]);

const ALLOWED_SERVICE_NAME = "circles-api";
const SOURCE_ROUTERS = Object.freeze([
  { file: "server/social-router.ts", namespace: "social", indent: 2 },
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
  "auth.me": { expected: "authenticated-object", requiresAuth: true },
  "social.feed": { expected: "array", input: { filter: "for-you" } },
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
  "live.list": { expected: "array" },
  "live.signals": {
    expected: "array",
    requiresAuth: true,
    identifier: { source: "streamId", field: "streamId" },
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

function assertTrustedFile(filePath, fsModule = fs, { privateFile = false } = {}) {
  const absolute = path.resolve(filePath);
  const stat = fsModule.lstatSync(absolute);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
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
    const trustedPath = assertTrustedFile(envFile, fsModule, { privateFile: true });
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

function hasFixedPort(url, port) {
  const effectivePort = url.port || (url.protocol === "https:" ? "443" : "80");
  return effectivePort === String(port);
}

function isTemporarySandboxHost(url) {
  return url.hostname.endsWith(".manus.computer");
}

function isLoopbackHost(url) {
  return ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
}

function verificationOrigin(value) {
  const origin = hasValue(value) ? safeHttpOrigin(value.trim()) : null;
  if (!origin) return null;
  if (origin.protocol === "http:" && !isLoopbackHost(origin)) return null;
  if (
    isTemporarySandboxHost(origin) &&
    (origin.protocol !== "https:" || !hasFixedPort(origin, 443))
  ) {
    return null;
  }
  return origin;
}

/**
 * Verify-only is a post-refresh/public-origin boundary. It deliberately accepts
 * a proxied HTTPS origin (including a current *.manus.computer port-443
 * Preview) without treating it as the internal API:3000 restart target.
 */
export function validateVerificationConfiguration(
  configuration = {},
  { operatorBaseUrl } = {},
) {
  const selectedBaseUrl = hasValue(operatorBaseUrl)
    ? operatorBaseUrl
    : [
        configuration.EXPO_PUBLIC_API_BASE_URL,
        configuration.API_BASE_URL,
        configuration.API_ORIGIN,
        configuration.PUBLIC_URL,
      ].find(hasValue);
  const apiOrigin = verificationOrigin(selectedBaseUrl);
  return {
    ok: Boolean(apiOrigin),
    errors: apiOrigin
      ? []
      : [
          issue(
            "API_BASE_URL",
            "must be an explicit credential-free HTTPS origin or local API origin",
          ),
        ],
    apiBaseUrl: apiOrigin?.origin ?? null,
  };
}

/**
 * Validates only configuration shape/presence and identity continuity. It never
 * opens a database or prints a value, DSN, token, or signing material.
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
    errors.push(issue("MANUS_JWT_SECRET", "must contain at least 32 characters"));
  }
  for (const key of [
    "MANUS_OAUTH_PORTAL_URL",
    "MANUS_OAUTH_API_URL",
    "BUILT_IN_FORGE_API_URL",
  ]) {
    if (hasValue(configuration[key]) && !safeHttpOrigin(configuration[key].trim())) {
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

  const selectedBaseUrl = operatorBaseUrl || configuration.EXPO_PUBLIC_API_BASE_URL;
  const apiOrigin = hasValue(selectedBaseUrl) ? safeHttpOrigin(selectedBaseUrl.trim()) : null;
  if (!apiOrigin || !hasFixedPort(apiOrigin, API_PORT)) {
    errors.push(issue("API_BASE_URL", `must be a credential-free HTTP(S) origin on ${API_PORT}`));
  } else if (isTemporarySandboxHost(apiOrigin)) {
    errors.push(issue("API_BASE_URL", "must not use a temporary Manus session hostname"));
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
    apiBaseUrl: apiOrigin?.origin ?? null,
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
        sourceAccess:
          match[2] === "publicProcedure" ? "public" : "protected",
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
export function deriveEndpointInventory(projectRoot = PROJECT_ROOT, fsModule = fs) {
  const discovered = [];
  for (const source of SOURCE_ROUTERS) {
    const sourceText = fsModule.readFileSync(path.join(projectRoot, source.file), "utf8");
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
        return { ...discoveredEndpoint, supported: false, drift: "duplicate_route" };
      }
      names.add(discoveredEndpoint.name);
      const definition = ENDPOINT_DEFINITIONS[discoveredEndpoint.name];
      if (!definition) {
        return { ...discoveredEndpoint, supported: false, drift: "missing_definition" };
      }
      const requiresAuth = Boolean(definition.requiresAuth) || discoveredEndpoint.sourceAccess === "protected";
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
    parsed = JSON.parse(fsModule.readFileSync(path.resolve(manifestPath), "utf8"));
  } catch {
    throw new Error("endpoint_manifest_invalid");
  }
  if (!plainObject(parsed) || parsed.version !== 1 || !plainObject(parsed.endpoints)) {
    throw new Error("endpoint_manifest_invalid");
  }
  const discovered = new Set(inventory.endpoints.map((endpoint) => endpoint.name));
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
  const trustedPath = assertTrustedFile(authFile, fsModule, { privateFile: true });
  let parsed;
  try {
    parsed = JSON.parse(fsModule.readFileSync(trustedPath, "utf8"));
  } catch {
    throw new Error("verification_auth_invalid");
  }
  if (!plainObject(parsed) || !hasValue(parsed.bearerToken) || parsed.bearerToken.length > 16_384) {
    throw new Error("verification_auth_invalid");
  }
  const ids = plainObject(parsed.ids) ? parsed.ids : {};
  for (const value of Object.values(ids)) {
    if (!positiveInteger(value)) throw new Error("verification_auth_invalid");
  }
  return { bearerToken: parsed.bearerToken, ids: cloneJson(ids) };
}

function endpointInput(endpoint, ids, manifest) {
  if (endpoint.identifier && !positiveInteger(ids[endpoint.identifier.source])) {
    return { ok: false, reason: "missing_existing_identifier" };
  }
  let input = endpoint.input === undefined ? undefined : cloneJson(endpoint.input);
  if (manifest[endpoint.name]) input = cloneJson(manifest[endpoint.name].input);
  if (endpoint.identifier) {
    input = {
      ...(input ?? {}),
      [endpoint.identifier.field]: ids[endpoint.identifier.source],
    };
  }
  return { ok: true, input };
}

async function readBoundedResponse(response, limit = RESPONSE_BODY_LIMIT_BYTES) {
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
    if (!plainObject(parsed) || !plainObject(parsed.result) || !plainObject(parsed.result.data)) {
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

function expectedShape(value, expected) {
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return plainObject(value);
  if (expected === "object-or-null") return value === null || plainObject(value);
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
  auth = { bearerToken: null, ids: {} },
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
      checks.push(result(endpoint.name, "positive", "skipped", "inventory_drift"));
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
            : result(endpoint.name, "anonymous_state", "failed", "anonymous_state_unexpected"),
        );
      } else {
        checks.push(
          isExpectedAnonymousDenial(anonymous.status, anonymous.text)
            ? result(endpoint.name, "anonymous_denial", "passed")
            : result(endpoint.name, "anonymous_denial", "failed", "anonymous_gate_unexpected"),
        );
      }
    }

    if (!inputResult.ok) {
      checks.push(result(endpoint.name, "positive", "skipped", inputResult.reason));
      continue;
    }
    if (requiresAuth && !auth.bearerToken) {
      checks.push(result(endpoint.name, "positive", "skipped", "missing_verification_auth"));
      continue;
    }
    if (requiresAuth && endpoint.name !== "auth.me" && authenticatedContext !== true) {
      checks.push(result(endpoint.name, "positive", "skipped", "no_active_viewer_context"));
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
    const shapeMatches = payload?.ok && expectedShape(payload.value, endpoint.expected);
    checks.push(
      shapeMatches
        ? result(endpoint.name, "positive", "passed")
        : result(endpoint.name, "positive", "failed", "query_failed_or_shape_invalid"),
    );
    if (endpoint.name === "auth.me") authenticatedContext = Boolean(shapeMatches);
  }

  const positive = checks.filter((check) => check.check === "positive");
  const summary = {
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
    skipped: checks.filter((check) => check.status === "skipped").length,
    declaredQueries: inventory.endpoints.length,
    completedPositiveQueries: positive.filter((check) => check.status === "passed").length,
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
 * only /api/health. This is intentionally separate from the 14-query final
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
export function authBuildRequiresSessionSchema(projectRoot = PROJECT_ROOT, fsModule = fs) {
  const candidates = [
    "server/_core/application-sessions.ts",
    "server/_core/sdk.ts",
    "drizzle/session-schema.ts",
  ];
  return candidates.some((relativePath) => {
    const filename = path.join(projectRoot, relativePath);
    return fsModule.existsSync(filename) && /applicationSessions/.test(fsModule.readFileSync(filename, "utf8"));
  });
}

async function openReadOnlyDatabaseConnection(databaseUrl, projectRoot, mysqlModule) {
  const mysql =
    mysqlModule ??
    createRequire(path.join(projectRoot, "package.json"))("mysql2/promise");
  return mysql.createConnection({
    uri: databaseUrl,
    connectTimeout: DATABASE_CONNECT_TIMEOUT_MS,
  });
}

async function readOnlyDatabaseQuery(connection, sql, values = []) {
  return connection.query({
    sql,
    values,
    timeout: DATABASE_QUERY_TIMEOUT_MS,
  });
}

async function closeDatabaseConnection(connection) {
  if (connection) await connection.end().catch(() => undefined);
}

/**
 * Opens one bounded connection and issues only SELECT 1 before any restart.
 * @param {string} databaseUrl
 * @param {{ projectRoot?: string, mysqlModule?: any }} [options]
 */
export async function checkDatabaseReady(
  databaseUrl,
  { projectRoot = PROJECT_ROOT, mysqlModule } = {},
) {
  let connection;
  try {
    connection = await openReadOnlyDatabaseConnection(
      databaseUrl,
      projectRoot,
      mysqlModule,
    );
    const [rows] = await readOnlyDatabaseQuery(connection, "SELECT 1 AS ready");
    return Array.isArray(rows) && rows.length === 1 && Number(rows[0]?.ready) === 1;
  } catch {
    return false;
  } finally {
    await closeDatabaseConnection(connection);
  }
}

/**
 * Uses bounded read-only information_schema reads and always closes the connection.
 * @param {string} databaseUrl
 * @param {{ projectRoot?: string, mysqlModule?: any }} [options]
 */
export async function checkApplicationSessionSchema(
  databaseUrl,
  { projectRoot = PROJECT_ROOT, mysqlModule } = {},
) {
  let connection;
  try {
    connection = await openReadOnlyDatabaseConnection(
      databaseUrl,
      projectRoot,
      mysqlModule,
    );
    const [tableRows] = await readOnlyDatabaseQuery(
      connection,
      "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
      [SESSION_TABLE],
    );
    if (!Array.isArray(tableRows) || tableRows.length !== 1) return false;
    const [primaryKeyRows] = await readOnlyDatabaseQuery(
      connection,
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND COLUMN_KEY = 'PRI' LIMIT 1",
      [SESSION_TABLE],
    );
    if (
      !Array.isArray(primaryKeyRows) ||
      primaryKeyRows.length !== 1 ||
      primaryKeyRows[0]?.COLUMN_NAME !== "sessionFingerprint"
    ) {
      return false;
    }
    const [indexRows] = await readOnlyDatabaseQuery(
      connection,
      "SELECT DISTINCT INDEX_NAME FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ?",
      [SESSION_TABLE],
    );
    const indexes = new Set(indexRows.map((row) => row.INDEX_NAME));
    return SESSION_INDEXES.every((name) => indexes.has(name));
  } catch {
    return false;
  } finally {
    await closeDatabaseConnection(connection);
  }
}

function restrictedRuntimeEnvironment(referenceEnvironment, configuration) {
  const runtime = { PATH: referenceEnvironment.PATH ?? "/usr/bin:/bin" };
  for (const key of SAFE_RUNTIME_KEYS) {
    if (hasValue(referenceEnvironment[key])) runtime[key] = referenceEnvironment[key];
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
export function restartKnownApiService(/** @type {any} */ {
  serviceName,
  serviceManager,
  restartAdapter,
  configuration,
  referenceEnvironment = process.env,
  spawn = spawnSync,
}) {
  if (serviceName !== ALLOWED_SERVICE_NAME) return { ok: false, reason: "unsafe_service_target" };
  const environment = restrictedRuntimeEnvironment(referenceEnvironment, configuration);
  if (serviceManager === "systemd" && !restartAdapter) {
    return {
      ok: finiteSpawn("systemctl", ["restart", serviceName], environment, spawn),
      reason: "restart_failed",
    };
  }
  if (serviceManager === "pm2" && !restartAdapter) {
    const pm2ManagerEnvironment = trustedPm2ManagerEnvironment(referenceEnvironment);
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
      return result(endpoint.name, "positive", "skipped", "missing_verification_auth");
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
export async function runRecovery(/** @type {any} */ {
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
  schemaCheck = checkApplicationSessionSchema,
  restart = restartKnownApiService,
  readinessCheck = waitForApiReadiness,
  sleep = delay,
  fetchImpl = fetch,
  fsModule = fs,
}) {
  const report = {
    mode,
    ok: false,
    configuration: { ok: false, errors: [] },
    database: { required: mode !== "verify-only", ok: mode === "verify-only" ? null : false },
    sessionSchema: { required: false, ok: true },
    restart: { attempted: false, ok: null },
    readiness: { attempted: false, ok: null, attempts: 0 },
    inventory: { declaredQueries: 0, drift: { missingConfigured: [], unsupported: [], classificationMismatch: [] } },
    verification: emptyVerification(),
  };
  if (mode !== "dry-run" && mode !== "apply" && mode !== "verify-only") {
    report.configuration.errors = [issue("mode", "must be dry-run, apply or verify-only")];
    return report;
  }

  const selectedProjectRoot = projectDir ?? projectRoot;
  if (typeof selectedProjectRoot !== "string" || !path.isAbsolute(selectedProjectRoot)) {
    report.configuration.errors = [issue("projectDir", "must be an absolute source repository path")];
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
    report.configuration.errors = [issue("environment", error instanceof Error ? error.message : "environment_source_invalid")];
    return report;
  }

  const preflight =
    mode === "verify-only"
      ? validateVerificationConfiguration(selectedEnvironment.values, { operatorBaseUrl })
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
    report.configuration = { ok: false, errors: [issue("inventory", "source_inventory_unavailable")] };
    return report;
  }

  let selectedManifest;
  let selectedAuth;
  try {
    selectedManifest = manifest ?? loadEndpointManifest(endpointManifest, discovered, fsModule);
    selectedAuth = auth ?? loadVerificationAuth(authFile, fsModule);
  } catch (error) {
    report.configuration = { ok: false, errors: [issue("verification", error instanceof Error ? error.message : "verification_input_invalid")] };
    return report;
  }

  if (mode !== "verify-only") {
    try {
      report.database.ok = Boolean(
        await databaseReady(selectedEnvironment.values.DATABASE_URL, {
          projectRoot: selectedProjectRoot,
        }),
      );
    } catch {
      report.database.ok = false;
    }
    if (!report.database.ok) return report;

    const needsSessionSchema =
      forceSessionSchemaCheck || authBuildRequiresSessionSchema(selectedProjectRoot, fsModule);
    report.sessionSchema.required = needsSessionSchema;
    if (needsSessionSchema) {
      try {
        report.sessionSchema.ok = Boolean(
          await schemaCheck(selectedEnvironment.values.DATABASE_URL, {
            projectRoot: selectedProjectRoot,
          }),
        );
      } catch {
        report.sessionSchema.ok = false;
      }
      if (!report.sessionSchema.ok) return report;
    }
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
    if (explicitMode && explicitMode !== mode) throw new Error("recovery_mode_ambiguous");
    explicitMode = mode;
    options.mode = mode;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") setMode("apply");
    else if (argument === "--dry-run") setMode("dry-run");
    else if (argument === "--verify-only") setMode("verify-only");
    else if (argument === "--strict") options.strict = true;
    else if (argument === "--no-anonymous-gates") options.checkAnonymousGates = false;
    else if (argument === "--require-session-schema") options.forceSessionSchemaCheck = true;
    else if (argument === "--env-command-arg") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("argument_value_missing");
      options.envCommandArgs ??= [];
      options.envCommandArgs.push(value);
      index += 1;
    }
    else if (["--env-file", "--env-command", "--api-base-url", "--auth-file", "--endpoint-manifest", "--service-name", "--service-manager", "--restart-adapter", "--project-dir"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("argument_value_missing");
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
  if (options.serviceManager && !["systemd", "pm2"].includes(options.serviceManager)) {
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
