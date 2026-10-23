#!/usr/bin/env node
/**
 * Guarded authenticated operator verification for Circles.
 *
 * This tool consumes already-issued, real test-session credentials from a
 * private 0600 fixture file. It never creates accounts, issues codes, joins
 * circles, or logs in on an operator's behalf. Read-only checks are the
 * default. Any logout or live lifecycle mutation requires explicit command
 * acknowledgement and a fixture nomination for the precise test session.
 */
import fs from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
export const MAX_RESPONSE_BYTES = 64 * 1024;
export const REQUEST_TIMEOUT_MS = 12_000;
export const MUTATION_ACKNOWLEDGEMENT =
  "I_ACKNOWLEDGE_NOMINATED_TEST_SESSIONS_ONLY";
export const LOGOUT_ACKNOWLEDGEMENT = "REVOKE_NOMINATED_TEST_SESSION";

const ACCOUNT_NAMES = Object.freeze([
  "member",
  "moderator",
  "host",
  "viewer",
  "logout",
]);
const MUTABLE_ACCOUNT_NAMES = new Set(["host", "viewer", "logout"]);
const PRIVATE_MEDIA_PATH =
  /^\/manus-storage\/social-encrypted\/[1-9]\d*\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|mp4)\.enc$/;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasText(value, maximum = 16_384) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function check(name, status, reason) {
  return { name, status, ...(reason ? { reason } : {}) };
}

function safeOrigin(value) {
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    if (
      parsed.protocol === "http:" &&
      !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Require an owner-only regular file; never follow a symlink for credentials. */
export function assertTrustedPrivateFile(filePath, fsModule = fs) {
  if (!hasText(filePath, 4_096)) throw new Error("fixture_file_required");
  const absolute = path.resolve(filePath);
  const stat = fsModule.lstatSync(absolute);
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (currentUid !== null && stat.uid !== currentUid) ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error("fixture_file_not_private");
  }
  return absolute;
}

/** Loads a deliberately small fixture contract without returning it to stdout. */
export function loadAuthenticatedE2EFixture(filePath, fsModule = fs) {
  const trustedPath = assertTrustedPrivateFile(filePath, fsModule);
  let parsed;
  try {
    parsed = JSON.parse(fsModule.readFileSync(trustedPath, "utf8"));
  } catch {
    throw new Error("fixture_file_invalid");
  }
  if (!isPlainObject(parsed) || parsed.version !== 1) {
    throw new Error("fixture_file_invalid");
  }
  return parsed;
}

export function parseCliArguments(argv) {
  const options = {
    fixtureFile: null,
    apiBaseUrl: null,
    allowMutations: false,
    mutationAcknowledgement: null,
    verifyLogout: false,
    logoutAcknowledgement: null,
    liveFlow: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--fixture-file")
      options.fixtureFile = argv[++index] ?? null;
    else if (argument === "--api-base-url")
      options.apiBaseUrl = argv[++index] ?? null;
    else if (argument === "--allow-mutations") options.allowMutations = true;
    else if (argument === "--acknowledge-mutations") {
      options.mutationAcknowledgement = argv[++index] ?? null;
    } else if (argument === "--verify-logout") options.verifyLogout = true;
    else if (argument === "--acknowledge-logout") {
      options.logoutAcknowledgement = argv[++index] ?? null;
    } else if (argument === "--live-flow")
      options.liveFlow = argv[++index] ?? null;
    else throw new Error("invalid_arguments");
  }
  if (
    options.liveFlow &&
    !["reconnect", "reload", "teardown"].includes(options.liveFlow)
  ) {
    throw new Error("invalid_live_flow");
  }
  if ((options.liveFlow || options.verifyLogout) && !options.allowMutations) {
    throw new Error("mutations_require_allow_flag");
  }
  if (
    options.allowMutations &&
    options.mutationAcknowledgement !== MUTATION_ACKNOWLEDGEMENT
  ) {
    throw new Error("mutation_acknowledgement_required");
  }
  if (
    options.verifyLogout &&
    options.logoutAcknowledgement !== LOGOUT_ACKNOWLEDGEMENT
  ) {
    throw new Error("logout_acknowledgement_required");
  }
  return options;
}

export function usage() {
  return `Usage: node scripts/verify-authenticated-e2e.mjs --fixture-file /private/circles-e2e.json --api-base-url https://api.example\n\nRead-only is the default. The fixture must be a current-user-owned 0600 JSON file.\nFor a nominated live session: --allow-mutations --acknowledge-mutations ${MUTATION_ACKNOWLEDGEMENT} --live-flow reconnect|reload|teardown\nFor only the nominated disposable logout session: --allow-mutations --acknowledge-mutations ${MUTATION_ACKNOWLEDGEMENT} --verify-logout --acknowledge-logout ${LOGOUT_ACKNOWLEDGEMENT}`;
}

async function readText(response, limit = MAX_RESPONSE_BYTES) {
  if (!response.body) return { ok: true, text: "" };
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
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
      reader.releaseLock();
    } catch {
      // The structured report must not fail while cleaning up a malformed body.
    }
  }
}

function trpcPayload(text) {
  try {
    const parsed = JSON.parse(text);
    if (
      !isPlainObject(parsed) ||
      !isPlainObject(parsed.result) ||
      !isPlainObject(parsed.result.data)
    ) {
      return null;
    }
    return Object.hasOwn(parsed.result.data, "json")
      ? parsed.result.data.json
      : null;
  } catch {
    return null;
  }
}

function trpcErrorCode(text) {
  try {
    const parsed = JSON.parse(text);
    const code = parsed?.error?.data?.code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

export async function callTrpc({
  apiBaseUrl,
  procedure,
  input,
  bearerToken,
  method = "GET",
  fetchImpl = fetch,
}) {
  const url = new URL(`/api/trpc/${procedure}`, apiBaseUrl);
  const headers = { Accept: "application/json" };
  const request = {
    method,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  if (method === "GET" && input !== undefined) {
    url.searchParams.set("input", JSON.stringify({ json: input }));
  } else if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    request.body = JSON.stringify({ json: input ?? {} });
  }
  try {
    const response = await fetchImpl(url, request);
    const body = await readText(response);
    return body.ok
      ? { ok: response.ok, status: response.status, text: body.text }
      : { ok: false, status: response.status, reason: body.reason, text: "" };
  } catch {
    return { ok: false, status: 0, reason: "network_error", text: "" };
  }
}

async function callProtectedMedia({
  apiBaseUrl,
  attachmentPath,
  bearerToken,
  fetchImpl,
}) {
  const pathMatch = PRIVATE_MEDIA_PATH.test(attachmentPath);
  if (!pathMatch)
    return { ok: false, status: 0, reason: "attachment_path_not_canonical" };
  try {
    const response = await fetchImpl(
      new URL(
        `/api/media/${attachmentPath.slice("/manus-storage/".length)}`,
        apiBaseUrl,
      ),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${bearerToken}`, Range: "bytes=0-0" },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const body = await readText(response, 4 * 1024);
    if (!body.ok)
      return { ok: false, status: response.status, reason: body.reason };
    return {
      ok:
        response.status === 206 &&
        Boolean(response.headers.get("content-type")) &&
        body.text.length === 1,
      status: response.status,
      reason:
        response.status === 206
          ? "attachment_response_invalid"
          : "attachment_read_failed",
    };
  } catch {
    return { ok: false, status: 0, reason: "network_error" };
  }
}

function accountFromFixture(fixture, name) {
  const account = fixture?.accounts?.[name];
  if (!isPlainObject(account)) return null;
  return hasText(account.bearerToken) && positiveInteger(account.userId)
    ? account
    : null;
}

function idFromFixture(fixture, name) {
  const value = fixture?.ids?.[name];
  return positiveInteger(value) ? value : null;
}

function mutableAccountIsNominated(fixture, name) {
  const account = accountFromFixture(fixture, name);
  const nominations = fixture?.mutations?.nominatedAccounts;
  return (
    MUTABLE_ACCOUNT_NAMES.has(name) &&
    account?.nominatedForMutations === true &&
    Array.isArray(nominations) &&
    nominations.includes(name) &&
    hasText(fixture?.mutations?.runId, 160)
  );
}

function responseIsArray(response) {
  const value = response.ok ? trpcPayload(response.text) : null;
  return Array.isArray(value) ? value : null;
}

function hasExpectedHostRestartSignal(signals, hostId, hostGeneration) {
  return signals.some((signal) => {
    if (
      !isPlainObject(signal) ||
      signal.kind !== "join" ||
      signal.fromId !== hostId ||
      typeof signal.payload !== "string"
    ) {
      return false;
    }
    try {
      const payload = JSON.parse(signal.payload);
      return (
        payload?.type === "host-generation-restart" &&
        payload.hostGeneration === hostGeneration
      );
    } catch {
      return false;
    }
  });
}

async function authenticatedAccountCheck(name, account, apiBaseUrl, fetchImpl) {
  if (!account)
    return check(`auth.${name}`, "INCOMPLETE", "missing_real_account_fixture");
  const response = await callTrpc({
    apiBaseUrl,
    procedure: "auth.me",
    bearerToken: account.bearerToken,
    fetchImpl,
  });
  const user = response.ok ? trpcPayload(response.text) : null;
  if (isPlainObject(user) && user.id === account.userId)
    return check(`auth.${name}`, "PASSED");
  if (response.status === 401 || response.status === 403 || user === null) {
    return check(`auth.${name}`, "BLOCKED", "session_not_authenticated");
  }
  return check(
    `auth.${name}`,
    "FAILED",
    "auth_me_identity_mismatch_or_invalid_response",
  );
}

function dependenciesPassed(results, names) {
  return names.every(
    (name) =>
      results.find((result) => result.name === name)?.status === "PASSED",
  );
}

async function queryArrayCheck({
  name,
  apiBaseUrl,
  procedure,
  input,
  account,
  results,
  dependencies,
  fetchImpl,
  predicate,
}) {
  if (!dependenciesPassed(results, dependencies)) {
    results.push(
      check(name, "BLOCKED", "required_authenticated_context_unavailable"),
    );
    return;
  }
  const response = await callTrpc({
    apiBaseUrl,
    procedure,
    input,
    bearerToken: account.bearerToken,
    fetchImpl,
  });
  const data = responseIsArray(response);
  if (data && (!predicate || predicate(data)))
    results.push(check(name, "PASSED"));
  else if (response.status === 401 || response.status === 403)
    results.push(check(name, "BLOCKED", "authenticated_access_denied"));
  else
    results.push(
      check(name, "FAILED", "query_failed_or_expected_context_not_returned"),
    );
}

async function queryObjectCheck({
  name,
  apiBaseUrl,
  procedure,
  input,
  account,
  results,
  dependencies,
  fetchImpl,
  predicate,
}) {
  if (!dependenciesPassed(results, dependencies)) {
    results.push(
      check(name, "BLOCKED", "required_authenticated_context_unavailable"),
    );
    return;
  }
  const response = await callTrpc({
    apiBaseUrl,
    procedure,
    input,
    bearerToken: account.bearerToken,
    fetchImpl,
  });
  const data = response.ok ? trpcPayload(response.text) : null;
  if (isPlainObject(data) && (!predicate || predicate(data)))
    results.push(check(name, "PASSED"));
  else if (response.status === 401 || response.status === 403)
    results.push(check(name, "BLOCKED", "authenticated_access_denied"));
  else
    results.push(
      check(name, "FAILED", "query_failed_or_expected_context_not_returned"),
    );
}

function appendMissingFixtureChecks(results, fixture) {
  const requirements = [
    ["fixture.private_circle", idFromFixture(fixture, "privateCircleId")],
    ["fixture.private_post", idFromFixture(fixture, "privatePostId")],
    [
      "fixture.moderation_pending_member",
      idFromFixture(fixture, "moderationPendingMemberId"),
    ],
    [
      "fixture.direct_conversation",
      idFromFixture(fixture, "directConversationId"),
    ],
    ["fixture.live_stream", idFromFixture(fixture, "streamId")],
    ["fixture.viewer_generation", idFromFixture(fixture, "viewerGeneration")],
    [
      "fixture.attachment",
      typeof fixture?.ids?.attachmentPath === "string" &&
        PRIVATE_MEDIA_PATH.test(fixture.ids.attachmentPath),
    ],
  ];
  for (const [name, present] of requirements) {
    if (!present)
      results.push(
        check(name, "INCOMPLETE", "missing_existing_fixture_context"),
      );
  }
}

async function runReadOnlyChecks({ fixture, apiBaseUrl, fetchImpl }) {
  const results = [];
  for (const name of ACCOUNT_NAMES) {
    results.push(
      await authenticatedAccountCheck(
        name,
        accountFromFixture(fixture, name),
        apiBaseUrl,
        fetchImpl,
      ),
    );
  }
  appendMissingFixtureChecks(results, fixture);

  const member = accountFromFixture(fixture, "member");
  const moderator = accountFromFixture(fixture, "moderator");
  const viewer = accountFromFixture(fixture, "viewer");
  const privateCircleId = idFromFixture(fixture, "privateCircleId");
  const privatePostId = idFromFixture(fixture, "privatePostId");
  const pendingMemberId = idFromFixture(fixture, "moderationPendingMemberId");
  const directConversationId = idFromFixture(fixture, "directConversationId");
  const streamId = idFromFixture(fixture, "streamId");
  const viewerGeneration = idFromFixture(fixture, "viewerGeneration");
  const memberDependencies = ["auth.member"];
  const moderatorDependencies = ["auth.moderator"];
  const viewerDependencies = ["auth.viewer"];

  if (member && privateCircleId) {
    await queryObjectCheck({
      name: "private.circle.read",
      apiBaseUrl,
      procedure: "social.circle",
      input: { id: privateCircleId },
      account: member,
      results,
      dependencies: memberDependencies,
      fetchImpl,
      predicate: (value) =>
        value.id === privateCircleId &&
        value.privacy === "private" &&
        value.joined === true,
    });
    await queryArrayCheck({
      name: "private.members.read",
      apiBaseUrl,
      procedure: "social.members",
      input: { circleId: privateCircleId },
      account: member,
      results,
      dependencies: memberDependencies,
      fetchImpl,
    });
    if (privatePostId) {
      await queryArrayCheck({
        name: "private.feed.read",
        apiBaseUrl,
        procedure: "social.feed",
        input: { filter: "for-you", circleId: privateCircleId },
        account: member,
        results,
        dependencies: memberDependencies,
        fetchImpl,
        predicate: (posts) => posts.some((post) => post?.id === privatePostId),
      });
      await queryArrayCheck({
        name: "private.comments.read",
        apiBaseUrl,
        procedure: "social.comments",
        input: { postId: privatePostId },
        account: member,
        results,
        dependencies: memberDependencies,
        fetchImpl,
      });
    }
  }

  if (moderator && privateCircleId && pendingMemberId) {
    await queryObjectCheck({
      name: "moderation.circle.read",
      apiBaseUrl,
      procedure: "social.circle",
      input: { id: privateCircleId },
      account: moderator,
      results,
      dependencies: moderatorDependencies,
      fetchImpl,
      predicate: (value) =>
        value.id === privateCircleId &&
        ["owner", "moderator"].includes(value.role),
    });
    await queryArrayCheck({
      name: "moderation.pending_member.read",
      apiBaseUrl,
      procedure: "social.members",
      input: { circleId: privateCircleId },
      account: moderator,
      results,
      dependencies: moderatorDependencies,
      fetchImpl,
      predicate: (members) =>
        members.some(
          (memberRow) =>
            memberRow?.user?.id === pendingMemberId &&
            memberRow?.role === "pending",
        ),
    });
  }

  if (member && directConversationId) {
    await queryArrayCheck({
      name: "dm.conversation.read",
      apiBaseUrl,
      procedure: "social.conversations",
      account: member,
      results,
      dependencies: memberDependencies,
      fetchImpl,
      predicate: (conversations) =>
        conversations.some(
          (conversation) => conversation?.id === directConversationId,
        ),
    });
    await queryArrayCheck({
      name: "dm.messages.read",
      apiBaseUrl,
      procedure: "social.messages",
      input: { conversationId: directConversationId, limit: 1 },
      account: member,
      results,
      dependencies: memberDependencies,
      fetchImpl,
    });
    if (typeof fixture?.ids?.attachmentPath === "string") {
      if (!dependenciesPassed(results, memberDependencies)) {
        results.push(
          check(
            "attachment.private_read",
            "BLOCKED",
            "required_authenticated_context_unavailable",
          ),
        );
      } else {
        const media = await callProtectedMedia({
          apiBaseUrl,
          attachmentPath: fixture.ids.attachmentPath,
          bearerToken: member.bearerToken,
          fetchImpl,
        });
        results.push(
          media.ok
            ? check("attachment.private_read", "PASSED")
            : check(
                "attachment.private_read",
                media.status === 401 || media.status === 403
                  ? "BLOCKED"
                  : "FAILED",
                media.reason,
              ),
        );
      }
    }
  }

  if (viewer && streamId && viewerGeneration) {
    await queryArrayCheck({
      name: "live.viewer_signals.read",
      apiBaseUrl,
      procedure: "live.signals",
      input: { streamId, generation: viewerGeneration },
      account: viewer,
      results,
      dependencies: viewerDependencies,
      fetchImpl,
    });
    await queryArrayCheck({
      name: "live.viewer_chat.read",
      apiBaseUrl,
      procedure: "live.chat",
      input: { streamId },
      account: viewer,
      results,
      dependencies: viewerDependencies,
      fetchImpl,
    });
  }
  return results;
}

async function mutate({ apiBaseUrl, procedure, input, account, fetchImpl }) {
  const response = await callTrpc({
    apiBaseUrl,
    procedure,
    input,
    bearerToken: account.bearerToken,
    method: "POST",
    fetchImpl,
  });
  const value = response.ok ? trpcPayload(response.text) : null;
  return { response, value };
}

function mutationAllowed(fixture, names) {
  return names.every((name) => mutableAccountIsNominated(fixture, name));
}

async function runReconnectFlow({ fixture, apiBaseUrl, fetchImpl }) {
  const results = [];
  const viewer = accountFromFixture(fixture, "viewer");
  const streamId = idFromFixture(fixture, "streamId");
  if (!viewer || !streamId || !mutationAllowed(fixture, ["viewer"])) {
    return [
      check("live.reconnect", "BLOCKED", "viewer_not_nominated_for_mutation"),
    ];
  }
  let firstJoined = false;
  let secondJoined = false;
  try {
    const first = await mutate({
      apiBaseUrl,
      procedure: "live.join",
      input: { streamId },
      account: viewer,
      fetchImpl,
    });
    if (
      !isPlainObject(first.value) ||
      !positiveInteger(first.value.generation)
    ) {
      results.push(
        check("live.reconnect", "FAILED", "initial_viewer_join_failed"),
      );
      return results;
    }
    firstJoined = true;
    const firstGeneration = first.value.generation;
    const firstHeartbeat = await mutate({
      apiBaseUrl,
      procedure: "live.heartbeat",
      input: { streamId },
      account: viewer,
      fetchImpl,
    });
    if (!firstHeartbeat.response.ok || firstHeartbeat.value?.success !== true) {
      results.push(
        check("live.reconnect", "FAILED", "initial_viewer_heartbeat_failed"),
      );
      return results;
    }
    const firstSignals = await callTrpc({
      apiBaseUrl,
      procedure: "live.signals",
      input: { streamId, generation: firstGeneration },
      bearerToken: viewer.bearerToken,
      fetchImpl,
    });
    if (!responseIsArray(firstSignals)) {
      results.push(
        check("live.reconnect", "FAILED", "initial_signal_read_failed"),
      );
      return results;
    }
    const left = await mutate({
      apiBaseUrl,
      procedure: "live.leave",
      input: { streamId },
      account: viewer,
      fetchImpl,
    });
    if (!left.response.ok || left.value?.success !== true) {
      results.push(
        check("live.reconnect", "FAILED", "initial_viewer_leave_failed"),
      );
      return results;
    }
    firstJoined = false;

    const second = await mutate({
      apiBaseUrl,
      procedure: "live.join",
      input: { streamId },
      account: viewer,
      fetchImpl,
    });
    if (
      !isPlainObject(second.value) ||
      !positiveInteger(second.value.generation) ||
      second.value.generation <= firstGeneration
    ) {
      results.push(
        check(
          "live.reconnect",
          "FAILED",
          "reconnected_viewer_generation_invalid",
        ),
      );
      return results;
    }
    secondJoined = true;
    const secondHeartbeat = await mutate({
      apiBaseUrl,
      procedure: "live.heartbeat",
      input: { streamId },
      account: viewer,
      fetchImpl,
    });
    if (
      !secondHeartbeat.response.ok ||
      secondHeartbeat.value?.success !== true
    ) {
      results.push(
        check(
          "live.reconnect",
          "FAILED",
          "reconnected_viewer_heartbeat_failed",
        ),
      );
      return results;
    }
    const secondSignals = await callTrpc({
      apiBaseUrl,
      procedure: "live.signals",
      input: { streamId, generation: second.value.generation },
      bearerToken: viewer.bearerToken,
      fetchImpl,
    });
    if (!responseIsArray(secondSignals)) {
      results.push(
        check("live.reconnect", "FAILED", "reconnected_signal_read_failed"),
      );
      return results;
    }
    results.push(check("live.reconnect", "PASSED"));
    return results;
  } finally {
    if (firstJoined || secondJoined) {
      const cleanup = await mutate({
        apiBaseUrl,
        procedure: "live.leave",
        input: { streamId },
        account: viewer,
        fetchImpl,
      });
      if (!cleanup.response.ok || cleanup.value?.success !== true)
        results.push(
          check(
            "live.reconnect.cleanup",
            "FAILED",
            "viewer_leave_cleanup_failed",
          ),
        );
    }
  }
}

async function runReloadFlow({ fixture, apiBaseUrl, fetchImpl }) {
  const results = [];
  const host = accountFromFixture(fixture, "host");
  const viewer = accountFromFixture(fixture, "viewer");
  const streamId = idFromFixture(fixture, "streamId");
  if (
    !host ||
    !viewer ||
    !streamId ||
    !mutationAllowed(fixture, ["host", "viewer"])
  ) {
    return [
      check(
        "live.reload",
        "BLOCKED",
        "host_or_viewer_not_nominated_for_mutation",
      ),
    ];
  }
  let viewerJoined = false;
  try {
    const before = await mutate({
      apiBaseUrl,
      procedure: "live.join",
      input: { streamId },
      account: viewer,
      fetchImpl,
    });
    if (
      !isPlainObject(before.value) ||
      !positiveInteger(before.value.generation) ||
      before.value.hostId !== host.userId
    ) {
      results.push(
        check("live.reload", "FAILED", "viewer_join_or_host_identity_invalid"),
      );
      return results;
    }
    viewerJoined = true;
    const oldGeneration = before.value.generation;
    const reload = await mutate({
      apiBaseUrl,
      procedure: "live.join",
      input: { streamId },
      account: host,
      fetchImpl,
    });
    if (
      !isPlainObject(reload.value) ||
      !positiveInteger(reload.value.generation) ||
      reload.value.hostGeneration !== reload.value.generation
    ) {
      results.push(
        check("live.reload", "FAILED", "host_reload_generation_invalid"),
      );
      return results;
    }
    const restart = await callTrpc({
      apiBaseUrl,
      procedure: "live.signals",
      input: { streamId, generation: oldGeneration },
      bearerToken: viewer.bearerToken,
      fetchImpl,
    });
    const restartSignals = responseIsArray(restart);
    if (
      !restartSignals ||
      !hasExpectedHostRestartSignal(
        restartSignals,
        host.userId,
        reload.value.generation,
      )
    ) {
      results.push(
        check("live.reload", "FAILED", "host_restart_signal_missing"),
      );
      return results;
    }
    const rejoined = await mutate({
      apiBaseUrl,
      procedure: "live.join",
      input: { streamId },
      account: viewer,
      fetchImpl,
    });
    if (
      !isPlainObject(rejoined.value) ||
      !positiveInteger(rejoined.value.generation) ||
      rejoined.value.generation <= oldGeneration ||
      rejoined.value.hostGeneration !== reload.value.generation
    ) {
      results.push(
        check("live.reload", "FAILED", "viewer_rejoin_generation_invalid"),
      );
      return results;
    }
    const stale = await callTrpc({
      apiBaseUrl,
      procedure: "live.signals",
      input: { streamId, generation: oldGeneration },
      bearerToken: viewer.bearerToken,
      fetchImpl,
    });
    if (
      stale.ok ||
      !["FORBIDDEN", "NOT_FOUND", "CONFLICT"].includes(
        trpcErrorCode(stale.text) ?? "",
      )
    ) {
      results.push(
        check("live.reload", "FAILED", "stale_viewer_generation_not_rejected"),
      );
      return results;
    }
    const fresh = await callTrpc({
      apiBaseUrl,
      procedure: "live.signals",
      input: { streamId, generation: rejoined.value.generation },
      bearerToken: viewer.bearerToken,
      fetchImpl,
    });
    if (!responseIsArray(fresh)) {
      results.push(
        check("live.reload", "FAILED", "fresh_viewer_signal_read_failed"),
      );
      return results;
    }
    results.push(check("live.reload", "PASSED"));
    return results;
  } finally {
    if (viewerJoined) {
      const cleanup = await mutate({
        apiBaseUrl,
        procedure: "live.leave",
        input: { streamId },
        account: viewer,
        fetchImpl,
      });
      if (!cleanup.response.ok || cleanup.value?.success !== true)
        results.push(
          check("live.reload.cleanup", "FAILED", "viewer_leave_cleanup_failed"),
        );
    }
  }
}

async function runTeardownFlow({ fixture, apiBaseUrl, fetchImpl }) {
  const host = accountFromFixture(fixture, "host");
  const streamId = idFromFixture(fixture, "streamId");
  const generation = idFromFixture(fixture, "hostGeneration");
  if (
    !host ||
    !streamId ||
    !generation ||
    !mutableAccountIsNominated(fixture, "host") ||
    fixture?.mutations?.teardownStreamId !== streamId
  ) {
    return [
      check(
        "live.teardown",
        "BLOCKED",
        "host_stream_or_generation_not_explicitly_nominated_for_teardown",
      ),
    ];
  }
  const ended = await mutate({
    apiBaseUrl,
    procedure: "live.end",
    input: { streamId, generation },
    account: host,
    fetchImpl,
  });
  return ended.response.ok && ended.value?.success === true
    ? [check("live.teardown", "PASSED")]
    : [check("live.teardown", "FAILED", "host_end_failed")];
}

async function runLogoutCheck({ fixture, apiBaseUrl, fetchImpl }) {
  const account = accountFromFixture(fixture, "logout");
  if (
    !account ||
    !mutableAccountIsNominated(fixture, "logout") ||
    account.nominatedForLogout !== true
  ) {
    return [
      check(
        "logout.revocation",
        "BLOCKED",
        "logout_session_not_explicitly_nominated",
      ),
    ];
  }
  let response;
  try {
    response = await fetchImpl(new URL("/api/auth/logout", apiBaseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.bearerToken}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return [check("logout.revocation", "FAILED", "logout_network_error")];
  }
  const body = await readText(response);
  let success = false;
  try {
    success = response.ok && JSON.parse(body.text)?.success === true;
  } catch {
    // Invalid logout JSON is never a successful revocation result.
  }
  if (!success)
    return [check("logout.revocation", "FAILED", "logout_not_confirmed")];
  const after = await callTrpc({
    apiBaseUrl,
    procedure: "auth.me",
    bearerToken: account.bearerToken,
    fetchImpl,
  });
  const user = after.ok ? trpcPayload(after.text) : undefined;
  return after.status === 401 || after.status === 403 || user === null
    ? [check("logout.revocation", "PASSED")]
    : [
        check(
          "logout.revocation",
          "FAILED",
          "revoked_session_still_authenticated",
        ),
      ];
}

export async function runAuthenticatedE2E({
  fixture,
  apiBaseUrl,
  options = {},
  fetchImpl = fetch,
}) {
  const origin = safeOrigin(apiBaseUrl);
  if (!origin)
    return {
      status: "BLOCKED",
      checks: [
        check(
          "configuration.api_base_url",
          "BLOCKED",
          "credential_free_http_origin_required",
        ),
      ],
    };
  const checks = await runReadOnlyChecks({
    fixture,
    apiBaseUrl: origin,
    fetchImpl,
  });
  if (options.liveFlow) {
    if (
      !options.allowMutations ||
      options.mutationAcknowledgement !== MUTATION_ACKNOWLEDGEMENT
    ) {
      checks.push(
        check(
          "live.mutation_guard",
          "BLOCKED",
          "explicit_mutation_acknowledgement_required",
        ),
      );
    } else if (options.liveFlow === "reconnect") {
      checks.push(
        ...(await runReconnectFlow({ fixture, apiBaseUrl: origin, fetchImpl })),
      );
    } else if (options.liveFlow === "reload") {
      checks.push(
        ...(await runReloadFlow({ fixture, apiBaseUrl: origin, fetchImpl })),
      );
    } else {
      checks.push(
        ...(await runTeardownFlow({ fixture, apiBaseUrl: origin, fetchImpl })),
      );
    }
  }
  if (options.verifyLogout) {
    if (
      !options.allowMutations ||
      options.mutationAcknowledgement !== MUTATION_ACKNOWLEDGEMENT ||
      options.logoutAcknowledgement !== LOGOUT_ACKNOWLEDGEMENT
    ) {
      checks.push(
        check(
          "logout.revocation",
          "BLOCKED",
          "explicit_logout_acknowledgement_required",
        ),
      );
    } else {
      checks.push(
        ...(await runLogoutCheck({ fixture, apiBaseUrl: origin, fetchImpl })),
      );
    }
  }
  const status = checks.some((item) => item.status === "FAILED")
    ? "FAILED"
    : checks.some((item) => item.status === "BLOCKED")
      ? "BLOCKED"
      : checks.some((item) => item.status === "INCOMPLETE")
        ? "INCOMPLETE"
        : "PASSED";
  return {
    status,
    summary: {
      passed: checks.filter((item) => item.status === "PASSED").length,
      failed: checks.filter((item) => item.status === "FAILED").length,
      blocked: checks.filter((item) => item.status === "BLOCKED").length,
      incomplete: checks.filter((item) => item.status === "INCOMPLETE").length,
    },
    checks,
  };
}

async function main() {
  let options;
  try {
    options = parseCliArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "invalid_arguments"}\n`,
    );
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.fixtureFile || !options.apiBaseUrl) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  let fixture;
  try {
    fixture = loadAuthenticatedE2EFixture(options.fixtureFile);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ status: "BLOCKED", checks: [check("fixture", "BLOCKED", error instanceof Error ? error.message : "fixture_file_invalid")] })}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const report = await runAuthenticatedE2E({
    fixture,
    apiBaseUrl: options.apiBaseUrl,
    options,
  });
  // Reports contain only named checks and statuses: never identities, tokens, IDs, URLs, or response bodies.
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "PASSED") process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
