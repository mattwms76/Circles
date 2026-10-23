#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT_CODES = Object.freeze({
  ready: 0,
  blocked: 1,
  prerequisites: 2,
});

const TARGETS = new Set(["internal-preview", "store"]);
const PLATFORMS = new Set(["android", "ios"]);
const PREVIEW_HOST_SUFFIXES = Object.freeze([
  ".manus.computer",
  ".exp.direct",
  ".ngrok.io",
  ".ngrok.app",
  ".ngrok-free.app",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasTrue(record, key) {
  return isRecord(record) && record[key] === true;
}

function check(id, area, status, message) {
  return Object.freeze({ id, area, status, message });
}

function isPreviewOnlyHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    PREVIEW_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/**
 * Returns true only for a stable, credential-free HTTPS API origin. It intentionally rejects
 * temporary Preview URLs rather than attempting to contact the supplied origin.
 */
export function isProductionApiOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      !isPreviewOnlyHost(url.hostname)
    );
  } catch {
    return false;
  }
}

function getRequiredPlatforms(input, checks) {
  const platforms = input.requiredPlatforms;
  if (!Array.isArray(platforms) || platforms.length === 0) {
    checks.push(
      check(
        "manifest.platforms",
        "manifest",
        "blocked",
        "requiredPlatforms must declare at least one native platform.",
      ),
    );
    return [];
  }

  const unique = new Set(platforms);
  if (
    unique.size !== platforms.length ||
    platforms.some((platform) => !PLATFORMS.has(platform))
  ) {
    checks.push(
      check(
        "manifest.platforms",
        "manifest",
        "blocked",
        "requiredPlatforms may contain android and ios once each.",
      ),
    );
    return [];
  }
  return [...platforms].sort();
}

function validateManifest(input, checks) {
  const manifest = input.manifest;
  if (!isRecord(manifest)) {
    checks.push(
      check(
        "manifest",
        "manifest",
        "blocked",
        "manifest attestation is required.",
      ),
    );
    return;
  }

  for (const [key, label] of [
    ["appConfig", "app.config.ts must be reviewed."],
    ["scheme", "The existing app scheme must be preserved."],
    [
      "nativeIds",
      "The existing iOS and Android identifiers must be preserved.",
    ],
  ]) {
    checks.push(
      check(
        `manifest.${key}`,
        "manifest",
        hasTrue(manifest, key) ? "pass" : "blocked",
        hasTrue(manifest, key) ? `${label} Confirmed.` : label,
      ),
    );
  }

  const expectedProfile = input.target === "store" ? "store" : "preview";
  checks.push(
    check(
      "manifest.eas-profile",
      "manifest",
      manifest.easProfile === expectedProfile ? "pass" : "blocked",
      manifest.easProfile === expectedProfile
        ? `EAS ${expectedProfile} profile selected.`
        : `Target requires the EAS ${expectedProfile} profile.`,
    ),
  );

  const nativeWebRtc = manifest.nativeWebRtc;
  const requiresNativeWebRtc =
    isRecord(nativeWebRtc) && nativeWebRtc.required === true;
  if (requiresNativeWebRtc) {
    checks.push(
      check(
        "manifest.native-webrtc-plugin",
        "manifest",
        nativeWebRtc.configPlugin === true ? "pass" : "blocked",
        nativeWebRtc.configPlugin === true
          ? "The native WebRTC config plugin is declared."
          : "Native WebRTC requires its config plugin in app configuration.",
      ),
    );
    if (input.target === "internal-preview") {
      checks.push(
        check(
          "manifest.preview-surface",
          "manifest",
          manifest.previewSurface === "standalone" ? "pass" : "blocked",
          manifest.previewSurface === "standalone"
            ? "Preview is an internal standalone native build."
            : "Native WebRTC preview must use a standalone build, not Expo Go.",
        ),
      );
    }
  }
}

function validateApi(input, checks) {
  const api = input.api;
  if (!isRecord(api)) {
    checks.push(
      check("api", "api", "blocked", "API deployment attestation is required."),
    );
    return;
  }

  for (const [key, label] of [
    ["dockerfile", "A production Dockerfile is required."],
    ["frozenLockfile", "The container must install from a frozen lockfile."],
    [
      "buildWithoutRuntimeCredentials",
      "The image build must not require database or API credentials.",
    ],
    ["runsAsNonRoot", "The runtime container must use a nonroot user."],
  ]) {
    checks.push(
      check(
        `api.${key}`,
        "api",
        hasTrue(api, key) ? "pass" : "blocked",
        hasTrue(api, key) ? `${label} Confirmed.` : label,
      ),
    );
  }

  checks.push(
    check(
      "api.port",
      "api",
      api.port === 3000 ? "pass" : "blocked",
      api.port === 3000
        ? "API runtime defaults to port 3000."
        : "API runtime must default to port 3000.",
    ),
  );
  checks.push(
    check(
      "api.health-path",
      "api",
      api.healthPath === "/api/ready" ? "pass" : "blocked",
      api.healthPath === "/api/ready"
        ? "Health path matches the unauthenticated API route."
        : "Health path must match the current unauthenticated /api/ready route.",
    ),
  );

  if (input.target === "store") {
    checks.push(
      check(
        "api.production-origin",
        "api",
        isProductionApiOrigin(api.productionOrigin) ? "pass" : "blocked",
        isProductionApiOrigin(api.productionOrigin)
          ? "Production API origin is stable HTTPS, not a Preview endpoint."
          : "Store releases require a stable HTTPS API origin, not localhost or a Preview endpoint.",
      ),
    );
  }
}

function validateProviders(input, checks) {
  const required = input.requiredProviders;
  const providers = input.providers;
  if (
    !Array.isArray(required) ||
    required.length === 0 ||
    !isRecord(providers)
  ) {
    checks.push(
      check(
        "providers.contract",
        "providers",
        "blocked",
        "Required provider and secret attestations are required; do not supply secret values.",
      ),
    );
    return;
  }

  if (
    input.target === "store" ||
    input.manifest?.nativeWebRtc?.required === true
  ) {
    const relay = required.find((entry) => entry?.name === "turn-relay");
    const complete =
      Array.isArray(relay?.secrets) &&
      ["TURN_SERVER_URLS", "TURN_SHARED_SECRET"].every((name) =>
        relay.secrets.includes(name),
      );
    checks.push(
      check(
        "providers.turn-relay.contract",
        "providers",
        complete ? "pass" : "blocked",
        complete
          ? "Production live relay setup is explicitly required."
          : "Live-enabled releases require the TURN relay provider and both server settings.",
      ),
    );
  }

  const names = new Set();
  for (const requirement of required) {
    if (
      !isRecord(requirement) ||
      typeof requirement.name !== "string" ||
      requirement.name.length === 0 ||
      names.has(requirement.name) ||
      !Array.isArray(requirement.secrets) ||
      requirement.secrets.some(
        (name) => typeof name !== "string" || name.length === 0,
      )
    ) {
      checks.push(
        check(
          "providers.contract",
          "providers",
          "blocked",
          "Each required provider needs a unique name and a list of secret names.",
        ),
      );
      return;
    }
    names.add(requirement.name);
    const configured = providers[requirement.name];
    checks.push(
      check(
        `providers.${requirement.name}`,
        "providers",
        isRecord(configured) && configured.configured === true
          ? "pass"
          : "blocked",
        isRecord(configured) && configured.configured === true
          ? "Provider configuration is attested."
          : "Required provider configuration is absent.",
      ),
    );
    const secretStates =
      isRecord(configured) && isRecord(configured.secrets)
        ? configured.secrets
        : {};
    for (const secretName of requirement.secrets) {
      checks.push(
        check(
          `providers.${requirement.name}.secret.${secretName}`,
          "providers",
          secretStates[secretName] === true ? "pass" : "blocked",
          secretStates[secretName] === true
            ? "Required secret setup is attested without reading its value."
            : "Required secret setup is absent.",
        ),
      );
    }
  }
}

function assessRealEvidence(checks, id, record, label) {
  if (!isRecord(record) || record.status === "not_run") {
    checks.push(
      check(id, "evidence", "prerequisite", `${label} has not been run.`),
    );
    return;
  }
  if (record.status === "failed") {
    checks.push(
      check(id, "evidence", "blocked", `${label} reported a failure.`),
    );
    return;
  }
  if (record.status !== "passed" || record.source !== "real") {
    checks.push(
      check(
        id,
        "evidence",
        "prerequisite",
        `${label} needs real, recorded evidence; synthetic or unverified evidence is insufficient.`,
      ),
    );
    return;
  }
  checks.push(
    check(id, "evidence", "pass", `${label} has real recorded evidence.`),
  );
}

function validateEvidence(input, platforms, checks) {
  const evidence = isRecord(input.evidence) ? input.evidence : {};
  assessRealEvidence(
    checks,
    "evidence.api-container",
    evidence.apiContainer,
    "API container build",
  );
  assessRealEvidence(
    checks,
    "evidence.api-health",
    evidence.apiHealth,
    "Deployed API health check",
  );

  if (
    input.target === "store" ||
    input.manifest?.nativeWebRtc?.required === true
  ) {
    assessRealEvidence(
      checks,
      "evidence.live-relay",
      evidence.liveRelay,
      "Real two-party live relay/network verification",
    );
  }

  const nativeBuilds = isRecord(evidence.nativeBuilds)
    ? evidence.nativeBuilds
    : {};
  const devices = isRecord(evidence.devices) ? evidence.devices : {};
  const signedClaim =
    isRecord(evidence.claims) && evidence.claims.signedBuild === true;

  for (const platform of platforms) {
    const nativeBuild = nativeBuilds[platform];
    assessRealEvidence(
      checks,
      `evidence.native-build.${platform}`,
      nativeBuild,
      `${platform} native build`,
    );

    if (
      isRecord(nativeBuild) &&
      nativeBuild.status === "passed" &&
      (input.target === "store" || signedClaim) &&
      nativeBuild.signing !== "signed"
    ) {
      checks.push(
        check(
          `evidence.native-build-signing.${platform}`,
          "evidence",
          "blocked",
          "An unsigned or unverified bundle cannot satisfy a signed-build claim.",
        ),
      );
    }

    assessRealEvidence(
      checks,
      `evidence.device.${platform}`,
      devices[platform],
      `${platform} device verification`,
    );
  }
}

/**
 * Evaluates value-free release attestations. It never reads process.env, contacts external systems,
 * or accepts synthetic evidence as proof of a deployable native release.
 */
export function evaluateReleaseReadiness(input) {
  const checks = [];
  if (!isRecord(input) || !TARGETS.has(input.target)) {
    checks.push(
      check(
        "input.target",
        "input",
        "blocked",
        "target must be internal-preview or store.",
      ),
    );
  } else {
    const platforms = getRequiredPlatforms(input, checks);
    validateManifest(input, checks);
    validateApi(input, checks);
    validateProviders(input, checks);
    validateEvidence(input, platforms, checks);
  }

  const hasBlocked = checks.some((item) => item.status === "blocked");
  const hasPrerequisite = checks.some((item) => item.status === "prerequisite");
  const status = hasBlocked
    ? "blocked"
    : hasPrerequisite
      ? "prerequisites"
      : "ready";
  return Object.freeze({
    status,
    exitCode: EXIT_CODES[status],
    checks: Object.freeze(checks),
  });
}

function usage() {
  console.log(
    "Usage: node scripts/check-release-readiness.mjs --input <value-free-attestation.json>",
  );
}

export function runCli(args = process.argv.slice(2)) {
  if (args[0] === "--") args = args.slice(1);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }
  if (args.length !== 2 || args[0] !== "--input" || !args[1]) {
    usage();
    return 2;
  }

  const inputPath = path.resolve(process.cwd(), args[1]);
  let input;
  try {
    input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch {
    console.error("Unable to read a valid JSON readiness attestation.");
    return 2;
  }

  const result = evaluateReleaseReadiness(input);
  console.log(JSON.stringify(result, null, 2));
  return result.exitCode;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runCli();
}
