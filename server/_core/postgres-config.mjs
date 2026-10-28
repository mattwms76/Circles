import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkServerIdentity } from "node:tls";

export const PRIVATE_SCHEMA = "circles_app";
export const RUNTIME_ROLE = "circles_app_runtime";
export const POSTGRES_CONNECTION_TIMEOUT_MS = 5_000;
export const POSTGRES_QUERY_TIMEOUT_MS = 8_000;
export const POSTGRES_STATEMENT_TIMEOUT_MS = 8_000;
export const POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS = 10_000;
export const LEGACY_LOGIN_ROLE = "postgres";
export const DEDICATED_APP_LOGIN_ROLE = "circles_app_login";
export const APPLICATION_LOGIN_MODE_LEGACY = "legacy";
export const APPLICATION_LOGIN_MODE_DEDICATED = "dedicated";

const PROJECT_REF = "vvclcsqletcxzoaayqzq";
const DATABASE_NAME = "postgres";
const DIRECT_HOST = `db.${PROJECT_REF}.supabase.co`;
const SESSION_POOLER_HOST = "aws-0-eu-west-1.pooler.supabase.com";
const SESSION_POOLER_USERS = new Map([
  [LEGACY_LOGIN_ROLE, `${LEGACY_LOGIN_ROLE}.${PROJECT_REF}`],
  [DEDICATED_APP_LOGIN_ROLE, `${DEDICATED_APP_LOGIN_ROLE}.${PROJECT_REF}`],
]);
const SUPABASE_ROOT_CA_SHA256 =
  "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa";
const SUPABASE_CA_RELATIVE_PATH = "server/certificates/supabase-root-2021.crt";

function configurationError(message) {
  return new Error(message);
}

function decodeComponent(value, message) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw configurationError(message);
  }
}

function expectedApplicationLoginRole(env) {
  const configuredMode = env.CIRCLES_DB_LOGIN_MODE;
  // The existing deployment remains on the audited postgres connection until a
  // parent-controlled secret update explicitly selects the dedicated principal.
  // A supplied mode is never advisory: it pins the URL principal below.
  const mode =
    typeof configuredMode === "string" && configuredMode.length > 0
      ? configuredMode
      : APPLICATION_LOGIN_MODE_LEGACY;

  if (mode === APPLICATION_LOGIN_MODE_LEGACY) return LEGACY_LOGIN_ROLE;
  if (mode === APPLICATION_LOGIN_MODE_DEDICATED)
    return DEDICATED_APP_LOGIN_ROLE;
  throw configurationError("CIRCLES_DB_LOGIN_MODE is invalid");
}

function loadVerifiedSupabaseCa(projectRoot) {
  let ca;
  try {
    ca = readFileSync(resolve(projectRoot, SUPABASE_CA_RELATIVE_PATH), "utf8");
  } catch {
    throw configurationError("Unable to load the Supabase TLS certificate");
  }
  let caFingerprint;
  try {
    caFingerprint = new X509Certificate(ca).fingerprint256
      .replaceAll(":", "")
      .toLowerCase();
  } catch {
    throw configurationError("Supabase TLS certificate verification failed");
  }
  if (caFingerprint !== SUPABASE_ROOT_CA_SHA256) {
    throw configurationError("Supabase TLS certificate verification failed");
  }
  return ca;
}

/**
 * Parses a connection URL only for one reviewed database principal. This is
 * also used by the separately invoked DB-02 operator runner; it never accepts
 * an arbitrary target, TLS mode, database, or role supplied through URL query
 * parameters.
 */
export function getPostgresConnectionOptionsForLogin(
  suppliedUrl,
  expectedLoginRole,
  projectRoot = process.cwd(),
  { requireSessionPooler = false } = {},
) {
  if (!SESSION_POOLER_USERS.has(expectedLoginRole)) {
    throw configurationError("PostgreSQL login role is not approved");
  }
  if (typeof suppliedUrl !== "string" || suppliedUrl.length === 0) {
    throw configurationError("PostgreSQL connection URL is required");
  }

  let parsed;
  try {
    parsed = new URL(suppliedUrl);
  } catch {
    throw configurationError("PostgreSQL connection URL is not valid");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw configurationError(
      "PostgreSQL connection URL must use a PostgreSQL URL",
    );
  }
  if (
    parsed.pathname !== `/${DATABASE_NAME}` ||
    (parsed.port && parsed.port !== "5432")
  ) {
    throw configurationError(
      "PostgreSQL connection URL targets an unexpected database",
    );
  }

  const sourceHost = parsed.hostname.toLowerCase();
  const sourceUser = decodeComponent(
    parsed.username,
    "PostgreSQL connection URL has an invalid username",
  );
  const isKnownDirectHost = sourceHost === DIRECT_HOST;
  const isKnownSessionPooler = sourceHost === SESSION_POOLER_HOST;
  if (!isKnownDirectHost && !isKnownSessionPooler) {
    throw configurationError(
      "PostgreSQL connection URL targets an unexpected host",
    );
  }
  if (requireSessionPooler && !isKnownSessionPooler) {
    throw configurationError(
      "PostgreSQL connection URL must use the verified session pooler host",
    );
  }

  const expectedPoolerUser = SESSION_POOLER_USERS.get(expectedLoginRole);
  const acceptedSourceUser = isKnownDirectHost
    ? sourceUser === expectedLoginRole
    : sourceUser === expectedPoolerUser;
  if (!acceptedSourceUser) {
    throw configurationError(
      "PostgreSQL connection URL targets an unexpected database user",
    );
  }

  const password = decodeComponent(
    parsed.password,
    "PostgreSQL connection URL has an invalid password",
  );
  if (password.length === 0) {
    throw configurationError("PostgreSQL connection URL requires a password");
  }

  const ca = loadVerifiedSupabaseCa(projectRoot);
  return {
    host: SESSION_POOLER_HOST,
    port: 5432,
    database: DATABASE_NAME,
    user: expectedPoolerUser,
    password,
    // These limits apply before application code sees a client, including
    // readiness and the role-initialization query. They are intentionally
    // finite because the server must fail closed rather than strand handlers.
    connectionTimeoutMillis: POSTGRES_CONNECTION_TIMEOUT_MS,
    query_timeout: POSTGRES_QUERY_TIMEOUT_MS,
    statement_timeout: POSTGRES_STATEMENT_TIMEOUT_MS,
    lock_timeout: POSTGRES_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS,
    max: 10,
    idleTimeoutMillis: 30_000,
    ssl: {
      ca,
      rejectUnauthorized: true,
      servername: SESSION_POOLER_HOST,
      checkServerIdentity(host, certificate) {
        if (host !== SESSION_POOLER_HOST) {
          return configurationError(
            "Supabase TLS hostname verification failed",
          );
        }
        return checkServerIdentity(SESSION_POOLER_HOST, certificate);
      },
    },
  };
}

/**
 * Returns only an explicit, certificate-verified node-postgres config for the
 * authorized Circles Supabase project. The source URL is never returned or
 * logged, and known direct URLs are converted in memory to the verified IPv4
 * session pooler endpoint.
 */
export function getPostgresConnectionOptions(
  env = process.env,
  projectRoot = process.cwd(),
) {
  const expectedLoginRole = expectedApplicationLoginRole(env);
  const dedicatedUrl = env.CIRCLES_APP_DATABASE_URL;

  if (expectedLoginRole === DEDICATED_APP_LOGIN_ROLE) {
    // A label does not make postgres safe. Dedicated mode both requires the
    // separately held app URL and rejects a co-resident operational URL; the
    // parsed credential principal is then bound to circles_app_login below.
    if (
      typeof env.SUPABASE_DATABASE_URL === "string" &&
      env.SUPABASE_DATABASE_URL.trim()
    ) {
      throw configurationError(
        "SUPABASE_DATABASE_URL is not permitted in dedicated application mode",
      );
    }
    if (typeof dedicatedUrl !== "string" || dedicatedUrl.length === 0) {
      throw configurationError(
        "CIRCLES_APP_DATABASE_URL is required in dedicated application mode",
      );
    }
    return getPostgresConnectionOptionsForLogin(
      dedicatedUrl,
      expectedLoginRole,
      projectRoot,
      { requireSessionPooler: true },
    );
  }

  if (typeof dedicatedUrl === "string" && dedicatedUrl.trim()) {
    throw configurationError(
      "CIRCLES_APP_DATABASE_URL requires dedicated application mode",
    );
  }
  const suppliedUrl = env.SUPABASE_DATABASE_URL;
  if (typeof suppliedUrl !== "string" || suppliedUrl.length === 0) {
    throw configurationError(
      "SUPABASE_DATABASE_URL is required for PostgreSQL",
    );
  }
  return getPostgresConnectionOptionsForLogin(
    suppliedUrl,
    expectedLoginRole,
    projectRoot,
  );
}
