import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkServerIdentity } from "node:tls";

export const PRIVATE_SCHEMA = "circles_app";
export const RUNTIME_ROLE = "circles_app_runtime";
/**
 * Current source accepts only this privileged Supabase connection principal.
 * It is deliberately explicit so it is not mistaken for the proposed
 * least-privilege bootstrap principal below.
 */
export const CURRENT_CONNECTION_PRINCIPAL = "postgres";
/** Prepared only: activation requires owner-provisioned provider access and a reviewed DSN change. */
export const PROPOSED_RUNTIME_BOOTSTRAP_PRINCIPAL = "circles_app_bootstrap";
export const POSTGRES_CONNECTION_TIMEOUT_MS = 5_000;
export const POSTGRES_QUERY_TIMEOUT_MS = 8_000;
export const POSTGRES_STATEMENT_TIMEOUT_MS = 8_000;
export const POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS = 10_000;

const PROJECT_REF = "vvclcsqletcxzoaayqzq";
const DATABASE_NAME = "postgres";
const DIRECT_HOST = `db.${PROJECT_REF}.supabase.co`;
const SESSION_POOLER_HOST = "aws-0-eu-west-1.pooler.supabase.com";
const SESSION_POOLER_USER = `${CURRENT_CONNECTION_PRINCIPAL}.${PROJECT_REF}`;
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
  const suppliedUrl = env.SUPABASE_DATABASE_URL;
  if (typeof suppliedUrl !== "string" || suppliedUrl.length === 0) {
    throw configurationError(
      "SUPABASE_DATABASE_URL is required for PostgreSQL",
    );
  }

  let parsed;
  try {
    parsed = new URL(suppliedUrl);
  } catch {
    throw configurationError(
      "SUPABASE_DATABASE_URL is not a valid PostgreSQL URL",
    );
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw configurationError("SUPABASE_DATABASE_URL must use a PostgreSQL URL");
  }
  if (
    parsed.pathname !== `/${DATABASE_NAME}` ||
    (parsed.port && parsed.port !== "5432")
  ) {
    throw configurationError(
      "SUPABASE_DATABASE_URL targets an unexpected database",
    );
  }

  const sourceHost = parsed.hostname.toLowerCase();
  const sourceUser = decodeComponent(
    parsed.username,
    "SUPABASE_DATABASE_URL has an invalid username",
  );
  const isKnownDirectHost = sourceHost === DIRECT_HOST;
  const isKnownSessionPooler = sourceHost === SESSION_POOLER_HOST;
  if (!isKnownDirectHost && !isKnownSessionPooler) {
    throw configurationError(
      "SUPABASE_DATABASE_URL targets an unexpected host",
    );
  }
  if (
    (isKnownDirectHost && sourceUser !== CURRENT_CONNECTION_PRINCIPAL) ||
    (isKnownSessionPooler && sourceUser !== SESSION_POOLER_USER)
  ) {
    throw configurationError(
      "SUPABASE_DATABASE_URL targets an unexpected database user",
    );
  }

  const password = decodeComponent(
    parsed.password,
    "SUPABASE_DATABASE_URL has an invalid password",
  );
  if (password.length === 0) {
    throw configurationError("SUPABASE_DATABASE_URL requires a password");
  }

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

  return {
    host: SESSION_POOLER_HOST,
    port: 5432,
    database: DATABASE_NAME,
    user: SESSION_POOLER_USER,
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
