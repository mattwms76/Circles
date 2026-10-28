#!/usr/bin/env node
import fs from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as configureDotenv } from "dotenv";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(moduleDirectory, "..");

/**
 * Load only the local runtime file, never overriding platform-injected values.
 * @param {string} [directory]
 * @param {Record<string, string | undefined>} [environment]
 */
export function loadLocalEnvironment(
  directory = projectDirectory,
  environment = process.env,
) {
  const envPath = path.join(directory, ".env");
  if (!fs.existsSync(envPath)) return;
  const result = configureDotenv({
    path: envPath,
    processEnv: environment,
    override: false,
  });
  if (result.error) throw new Error("Unable to read the local .env file");
}

/**
 * The explicit environment contract for this starter. Keep this list synchronized with every
 * process.env consumer below; --template checks the source files rather than guessing from docs.
 */
export const ENVIRONMENT_CONTRACT = Object.freeze({
  runtime: Object.freeze({
    required: Object.freeze([
      "MANUS_PROJECT_ID",
      "MANUS_OAUTH_PORTAL_URL",
      "MANUS_OAUTH_API_URL",
      "MANUS_JWT_SECRET",
      "SUPABASE_DATABASE_URL",
      "BUILT_IN_FORGE_API_URL",
      "BUILT_IN_FORGE_API_KEY",
      "EXPO_PUBLIC_API_BASE_URL",
    ]),
    trustedFrontendOrigins: Object.freeze([
      "EXPO_PACKAGER_PROXY_URL",
      "EXPO_WEB_PREVIEW_URL",
      "FRONTEND_ORIGIN",
      "WEB_ORIGIN",
      "EXPO_PUBLIC_WEB_URL",
      "PUBLIC_URL",
    ]),
    productionLive: Object.freeze(["TURN_SERVER_URLS", "TURN_SHARED_SECRET"]),
  }),
  platformManaged: Object.freeze(["NODE_ENV", "PORT", "EXPO_OS"]),
  sourceNames: Object.freeze([
    "API_BASE_URL",
    "API_ORIGIN",
    "BUILT_IN_FORGE_API_KEY",
    "BUILT_IN_FORGE_API_URL",
    "CIRCLES_APP_DATABASE_URL",
    "CIRCLES_DB_LOGIN_MODE",
    "CIRCLES_EMAIL_AUTH_ENABLED",
    "CIRCLES_PLATFORM_SETTINGS_ENABLED",
    "DATABASE_URL",
    "SUPABASE_AUTH_URL",
    "SUPABASE_AUTH_PUBLISHABLE_KEY",
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
    "OAUTH_CALLBACK_ORIGIN",
    "OAUTH_PORTAL_URL",
    "OAUTH_SERVER_URL",
    "OWNER_NAME",
    "OWNER_OPEN_ID",
    "PUBLIC_URL",
    "TURN_SERVER_URLS",
    "TURN_SHARED_SECRET",
    "VITE_APP_ID",
    "VITE_OAUTH_PORTAL_URL",
    "WEB_ORIGIN",
  ]),
  templateKeys: Object.freeze([
    "API_BASE_URL",
    "API_ORIGIN",
    "BUILT_IN_FORGE_API_KEY",
    "BUILT_IN_FORGE_API_URL",
    "CIRCLES_APP_DATABASE_URL",
    "CIRCLES_DB_LOGIN_MODE",
    "CIRCLES_EMAIL_AUTH_ENABLED",
    "CIRCLES_PLATFORM_SETTINGS_ENABLED",
    "DATABASE_URL",
    "SUPABASE_AUTH_URL",
    "SUPABASE_AUTH_PUBLISHABLE_KEY",
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
    "OAUTH_CALLBACK_ORIGIN",
    "OAUTH_PORTAL_URL",
    "OAUTH_SERVER_URL",
    "OWNER_NAME",
    "OWNER_OPEN_ID",
    "PUBLIC_URL",
    "TURN_SERVER_URLS",
    "TURN_SHARED_SECRET",
    "VITE_APP_ID",
    "VITE_OAUTH_PORTAL_URL",
    "WEB_ORIGIN",
  ]),
});

/** Files that own the application environment contract; tests are intentionally excluded. */
export const ENV_REFERENCE_SOURCE_FILES = Object.freeze([
  "app.config.ts",
  "components/external-link.tsx",
  "components/haptic-tab.tsx",
  "constants/oauth.ts",
  "drizzle.config.ts",
  "scripts/load-env.js",
  "scripts/preview-api-proxy.cjs",
  "server/db.ts",
  "server/platform-settings.ts",
  "server/social-service.ts",
  "server/storage.ts",
  "server/turn-config.ts",
  "server/_core/cookies.ts",
  "server/_core/cors.ts",
  "server/_core/frontend-origins.ts",
  "server/_core/env.ts",
  "server/_core/email-auth.ts",
  "server/_core/index.ts",
  "server/_core/oauth.ts",
  "server/_core/postgres-config.mjs",
]);

const PUBLIC_URL_KEYS = new Set([
  "API_BASE_URL",
  "API_ORIGIN",
  "EXPO_PACKAGER_PROXY_URL",
  "EXPO_PUBLIC_API_BASE_URL",
  "EXPO_PUBLIC_OAUTH_PORTAL_URL",
  "EXPO_PUBLIC_OAUTH_SERVER_URL",
  "EXPO_PUBLIC_WEB_URL",
  "EXPO_WEB_PREVIEW_URL",
  "FRONTEND_ORIGIN",
  "MANUS_OAUTH_API_URL",
  "MANUS_OAUTH_PORTAL_URL",
  "OAUTH_CALLBACK_ORIGIN",
  "OAUTH_PORTAL_URL",
  "OAUTH_SERVER_URL",
  "PUBLIC_URL",
  "VITE_OAUTH_PORTAL_URL",
  "WEB_ORIGIN",
]);

const ORIGIN_ONLY_KEYS = new Set([
  "API_BASE_URL",
  "API_ORIGIN",
  "EXPO_PACKAGER_PROXY_URL",
  "EXPO_PUBLIC_API_BASE_URL",
  "EXPO_PUBLIC_WEB_URL",
  "EXPO_WEB_PREVIEW_URL",
  "FRONTEND_ORIGIN",
  "OAUTH_CALLBACK_ORIGIN",
  "PUBLIC_URL",
  "WEB_ORIGIN",
]);

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(name, reason) {
  return { name, reason };
}

function isSafeHttpUrl(value, originOnly) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (!originOnly) return true;
    return url.origin === value;
  } catch {
    return false;
  }
}

function validatePublicUrls(env) {
  const errors = [];
  for (const name of PUBLIC_URL_KEYS) {
    const value = env[name];
    if (!hasValue(value)) continue;
    if (!isSafeHttpUrl(value.trim(), ORIGIN_ONLY_KEYS.has(name))) {
      errors.push(issue(name, "must be an HTTP(S) URL without credentials"));
    }
  }
  return errors;
}

/**
 * Validates the selected environment mode without logging or returning any environment values.
 * Runtime mode checks the canonical OAuth/media contract. CI mode deliberately never requires
 * database, storage, OAuth, or signing credentials.
 * @param {Record<string, string | undefined>} env
 * @param {"runtime" | "ci"} mode
 */
export function validateEnvironment(env = process.env, mode = "runtime") {
  if (!new Set(["runtime", "ci"]).has(mode)) {
    throw new Error("mode must be runtime or ci");
  }

  const errors = validatePublicUrls(env);
  const warnings = [];

  if (mode === "runtime") {
    const databaseLoginMode = env.CIRCLES_DB_LOGIN_MODE || "legacy";
    if (!new Set(["legacy", "dedicated"]).has(databaseLoginMode)) {
      errors.push(
        issue("CIRCLES_DB_LOGIN_MODE", "must be legacy or dedicated"),
      );
    }
    for (const name of ENVIRONMENT_CONTRACT.runtime.required) {
      if (name === "SUPABASE_DATABASE_URL" && databaseLoginMode === "dedicated")
        continue;
      if (!hasValue(env[name]))
        errors.push(issue(name, "is required at runtime"));
    }

    if (databaseLoginMode === "dedicated") {
      if (!hasValue(env.CIRCLES_APP_DATABASE_URL)) {
        errors.push(
          issue(
            "CIRCLES_APP_DATABASE_URL",
            "is required in dedicated application mode",
          ),
        );
      }
      if (hasValue(env.SUPABASE_DATABASE_URL)) {
        errors.push(
          issue(
            "SUPABASE_DATABASE_URL",
            "must not coexist with dedicated application credentials",
          ),
        );
      }
    } else if (hasValue(env.CIRCLES_APP_DATABASE_URL)) {
      errors.push(
        issue(
          "CIRCLES_APP_DATABASE_URL",
          "requires dedicated application mode",
        ),
      );
    }

    if (env.NODE_ENV === "production") {
      for (const name of ENVIRONMENT_CONTRACT.runtime.productionLive) {
        if (!hasValue(env[name]))
          errors.push(
            issue(name, "is required for production live operations"),
          );
      }
      if (
        hasValue(env.TURN_SHARED_SECRET) &&
        Buffer.byteLength(env.TURN_SHARED_SECRET, "utf8") < 32
      ) {
        errors.push(
          issue("TURN_SHARED_SECRET", "must contain at least 32 bytes"),
        );
      }
    }

    const signingSecret = env.MANUS_JWT_SECRET;
    if (hasValue(signingSecret) && Array.from(signingSecret).length < 32) {
      errors.push(
        issue(
          "MANUS_JWT_SECRET",
          "must contain at least 32 Unicode characters",
        ),
      );
    }

    if (hasValue(env.DATABASE_URL)) {
      try {
        const legacySource = new URL(env.DATABASE_URL);
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

    const configuredFrontendOrigin =
      ENVIRONMENT_CONTRACT.runtime.trustedFrontendOrigins.some((name) =>
        hasValue(env[name]),
      );
    if (!configuredFrontendOrigin) {
      warnings.push(
        issue(
          "EXPO_PACKAGER_PROXY_URL",
          "or another documented trusted frontend origin is needed for OAuth on Expo Web",
        ),
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Extract direct process.env access plus literal-name dynamic access. Some
 * helpers accept an injected `environment` for testability but default it to
 * process.env, so that explicit source-level access is part of the same
 * runtime contract.
 */
export function extractEnvironmentNames(sourceText) {
  const names = new Set();
  const direct = /\b(?:process\.env|env|environment)\.([A-Z][A-Z0-9_]*)\b/g;
  const literalBracket =
    /\b(?:process\.env|env|environment)\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g;
  let match;

  while ((match = direct.exec(sourceText))) names.add(match[1]);
  while ((match = literalBracket.exec(sourceText))) names.add(match[1]);

  // The source has a dynamic process.env[name] or injected environment[name]
  // access. Its allowed literal key set is declared beside it (typed union,
  // array, or mapping), so include those uppercase environment literals.
  if (
    /\b(?:process\.env|environment)\[\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\]/.test(
      sourceText,
    )
  ) {
    const environmentLiteral = /["']([A-Z][A-Z0-9_]*_[A-Z0-9_]+)["']/g;
    while ((match = environmentLiteral.exec(sourceText))) names.add(match[1]);
  }

  return names;
}

export function parseEnvTemplateKeys(templateText) {
  const keys = new Set();
  for (const line of templateText.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

export function readEnvironmentReferenceSources(cwd = projectDirectory) {
  return ENV_REFERENCE_SOURCE_FILES.map((relativePath) => ({
    relativePath,
    text: fs.readFileSync(path.join(cwd, relativePath), "utf8"),
  }));
}

/**
 * Ensures the template documents every real process.env consumer, including dynamic origin names,
 * and rejects undocumented template settings. Errors contain variable names only.
 */
export function validateTemplateCoverage({
  templateText,
  sourceTexts,
  contract = ENVIRONMENT_CONTRACT,
}) {
  const templateKeys = parseEnvTemplateKeys(templateText);
  const referenced = new Set();
  for (const sourceText of sourceTexts) {
    for (const name of extractEnvironmentNames(sourceText))
      referenced.add(name);
  }

  const errors = [];
  const contractNames = new Set(contract.sourceNames);
  const platformManaged = new Set(contract.platformManaged);
  const expectedTemplateKeys = new Set(contract.templateKeys);

  for (const name of [...referenced].sort()) {
    if (!platformManaged.has(name) && !contractNames.has(name)) {
      errors.push(
        issue(
          name,
          "is referenced in source but missing from ENVIRONMENT_CONTRACT",
        ),
      );
    }
  }
  for (const name of [...contractNames].sort()) {
    if (!referenced.has(name)) {
      errors.push(
        issue(
          name,
          "is in ENVIRONMENT_CONTRACT but no longer referenced in source",
        ),
      );
    }
  }
  for (const name of [...expectedTemplateKeys].sort()) {
    if (!templateKeys.has(name)) {
      errors.push(
        issue(
          name,
          "is documented by the contract but missing from .env.example",
        ),
      );
    }
  }
  for (const name of [...templateKeys].sort()) {
    if (!expectedTemplateKeys.has(name)) {
      errors.push(
        issue(
          name,
          "exists in .env.example but is not in ENVIRONMENT_CONTRACT",
        ),
      );
    }
  }

  return { ok: errors.length === 0, errors, referenced, templateKeys };
}

function printIssues(issues) {
  for (const { name, reason } of issues) {
    // Do not print values: environment values may contain credentials.
    console.error(`${name}: ${reason}`);
  }
}

function usage() {
  console.log("Usage: node scripts/check-env.mjs --mode runtime|ci|template");
}

function runCli() {
  let args = process.argv.slice(2);
  // `pnpm run` may preserve a leading delimiter; accept it without requiring callers to use one.
  if (args[0] === "--") args = args.slice(1);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }

  const modeIndex = args.indexOf("--mode");
  const mode = args[0] === "--template" ? "template" : args[modeIndex + 1];
  const hasTemplateShorthand = args.length === 1 && args[0] === "--template";
  const hasExplicitMode = args.length === 2 && modeIndex === 0 && Boolean(mode);
  if (!hasTemplateShorthand && !hasExplicitMode) {
    usage();
    return 2;
  }

  if (mode === "template") {
    const templateText = fs.readFileSync(
      path.join(projectDirectory, ".env.example"),
      "utf8",
    );
    const result = validateTemplateCoverage({
      templateText,
      sourceTexts: readEnvironmentReferenceSources(projectDirectory).map(
        ({ text }) => text,
      ),
    });
    if (!result.ok) {
      printIssues(result.errors);
      return 1;
    }
    console.log("environment template coverage passed");
    return 0;
  }

  try {
    if (mode === "runtime") loadLocalEnvironment();
    const result = validateEnvironment(process.env, mode);
    if (!result.ok) {
      printIssues(result.errors);
      return 1;
    }
    printIssues(result.warnings);
    console.log(`environment validation passed (${mode})`);
    return 0;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "environment validation failed",
    );
    return 2;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runCli();
}
