#!/usr/bin/env node
/**
 * Validates operator-supplied native device evidence against the checked-out
 * Circles source. It deliberately cannot turn Expo Web, Expo Go, an exported
 * bundle, or a source-only assertion into native proof.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const VALID_SURFACES = new Set([
  "development-build",
  "internal-distribution-build",
  "release-build",
]);
const REQUIRED_DEVICE_CHECKS = Object.freeze([
  "nativeModule",
  "login",
  "deepLink",
  "secureStore",
  "privateReads",
  "camera",
  "microphone",
  "hostViewer",
  "teardown",
]);

function hasText(value, maximum = 2_048) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function check(name, status, reason) {
  return { name, status, ...(reason ? { reason } : {}) };
}

export function assertTrustedPrivateFile(filePath, fsModule = fs) {
  if (!hasText(filePath, 4_096)) throw new Error("evidence_file_required");
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
    throw new Error("evidence_file_not_private");
  }
  return absolute;
}

export function loadNativeEvidence(filePath, fsModule = fs) {
  const trustedPath = assertTrustedPrivateFile(filePath, fsModule);
  try {
    const value = JSON.parse(fsModule.readFileSync(trustedPath, "utf8"));
    if (!isPlainObject(value) || value.version !== 1)
      throw new Error("evidence_file_invalid");
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === "evidence_file_invalid")
      throw error;
    throw new Error("evidence_file_invalid");
  }
}

export function parseCliArguments(argv) {
  const options = { evidenceFile: null, projectDir: PROJECT_ROOT, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--evidence-file")
      options.evidenceFile = argv[++index] ?? null;
    else if (argument === "--project-dir")
      options.projectDir = argv[++index] ?? null;
    else throw new Error("invalid_arguments");
  }
  if (!hasText(options.projectDir, 4_096))
    throw new Error("project_dir_required");
  return options;
}

export function usage() {
  return "Usage: node scripts/verify-native-readiness.mjs --evidence-file /private/circles-native-evidence.json [--project-dir /home/ubuntu/circles]";
}

function sourceContains(projectRoot, relativePath, expressions, fsModule) {
  try {
    const source = fsModule.readFileSync(
      path.join(projectRoot, relativePath),
      "utf8",
    );
    return expressions.every((expression) => source.includes(expression));
  } catch {
    return false;
  }
}

/** Source checks only establish intended implementation; device evidence establishes execution. */
export function verifySourceContracts(
  projectRoot = PROJECT_ROOT,
  fsModule = fs,
) {
  const contracts = [
    [
      "source.oauth_native_redirect",
      "constants/oauth.ts",
      [
        'Linking.createURL("/oauth/callback"',
        "NATIVE_OAUTH_FLOW_KEY",
        "SecureStore.setItemAsync",
      ],
    ],
    [
      "source.secure_store_session",
      "lib/_core/auth.ts",
      [
        "SecureStore.getItemAsync(SESSION_TOKEN_KEY)",
        "SecureStore.deleteItemAsync(SESSION_TOKEN_KEY)",
        "SecureStore.setItemAsync(SESSION_TOKEN_KEY",
      ],
    ],
    [
      "source.oauth_server_guard",
      "server/_core/oauth.ts",
      ["isSafeNativeRedirectUri", "x-manus-oauth-flow", "app_session_id"],
    ],
    [
      "source.native_webrtc_guard",
      "components/live-media.native.tsx",
      [
        'Constants.appOwnership === "expo"',
        'import("react-native-webrtc")',
        "mediaDevices.getUserMedia",
      ],
    ],
    [
      "source.native_transport_cleanup",
      "components/live-media.native.tsx",
      [
        "getTracks().forEach((track) => track.stop())",
        "api.live.leave.mutate",
        "api.live.end.mutate",
      ],
    ],
    [
      "source.native_permissions",
      "app.config.ts",
      [
        "@config-plugins/react-native-webrtc",
        "cameraPermission",
        "microphonePermission",
      ],
    ],
    [
      "source.private_media_route",
      "shared/media.ts",
      ["/api/media/${key}", "requiresNativeMediaAuthorization"],
    ],
  ];
  return contracts.map(([name, relativePath, expressions]) =>
    sourceContains(projectRoot, relativePath, expressions, fsModule)
      ? check(name, "PASSED")
      : check(name, "FAILED", "expected_native_contract_missing"),
  );
}

function evidenceExecutionStatus(evidence) {
  const execution = evidence?.execution;
  if (!isPlainObject(execution))
    return { status: "INCOMPLETE", reason: "missing_execution_evidence" };
  const excluded = [
    "web",
    "expo-go",
    "expo_go",
    "bundle",
    "export",
    "metro",
    "browser",
  ];
  if (excluded.includes(String(execution.surface).toLowerCase())) {
    return {
      status: "BLOCKED",
      reason: "non_native_execution_surface_rejected",
    };
  }
  if (!VALID_SURFACES.has(execution.surface))
    return { status: "BLOCKED", reason: "installed_native_build_required" };
  if (execution.deviceKind !== "physical")
    return { status: "BLOCKED", reason: "physical_device_evidence_required" };
  if (!["ios", "android"].includes(execution.platform))
    return { status: "INCOMPLETE", reason: "platform_missing" };
  if (
    !hasText(execution.buildId, 256) ||
    !hasText(execution.deviceId, 256) ||
    !hasText(execution.evidenceRef, 1_024)
  ) {
    return { status: "INCOMPLETE", reason: "build_or_device_evidence_missing" };
  }
  if (
    !hasText(execution.executedAt, 64) ||
    Number.isNaN(Date.parse(execution.executedAt))
  ) {
    return { status: "INCOMPLETE", reason: "execution_timestamp_missing" };
  }
  return { status: "PASSED" };
}

export function verifyNativeEvidence(evidence) {
  const results = [];
  const execution = evidenceExecutionStatus(evidence);
  results.push(
    check("native.execution_surface", execution.status, execution.reason),
  );
  if (execution.status !== "PASSED") {
    for (const name of REQUIRED_DEVICE_CHECKS)
      results.push(
        check(
          `device.${name}`,
          "BLOCKED",
          "native_execution_evidence_not_accepted",
        ),
      );
    return results;
  }
  const checks = evidence?.checks;
  for (const name of REQUIRED_DEVICE_CHECKS) {
    const value = checks?.[name];
    if (value === "passed") results.push(check(`device.${name}`, "PASSED"));
    else if (value === "failed")
      results.push(
        check(`device.${name}`, "FAILED", "operator_reported_failure"),
      );
    else if (value === "blocked")
      results.push(
        check(`device.${name}`, "BLOCKED", "operator_reported_blocker"),
      );
    else
      results.push(
        check(
          `device.${name}`,
          "INCOMPLETE",
          "missing_or_unrecognized_device_outcome",
        ),
      );
  }
  return results;
}

export function runNativeReadiness({
  evidence,
  projectRoot = PROJECT_ROOT,
  fsModule = fs,
}) {
  const source = verifySourceContracts(projectRoot, fsModule);
  const device = verifyNativeEvidence(evidence);
  const checks = [...source, ...device];
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

function main() {
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
  if (!options.evidenceFile) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  let evidence;
  try {
    evidence = loadNativeEvidence(options.evidenceFile);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ status: "BLOCKED", checks: [check("evidence", "BLOCKED", error instanceof Error ? error.message : "evidence_file_invalid")] })}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const report = runNativeReadiness({
    evidence,
    projectRoot: path.resolve(options.projectDir),
  });
  // Do not print device identifiers, build IDs, evidence references, or authentication data.
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "PASSED") process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
