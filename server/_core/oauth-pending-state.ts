import { createHash } from "node:crypto";
import { getDb } from "../db";

const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const INSERT_PENDING_STATE_SQL = `
  WITH expired AS (
    DELETE FROM circles_auth.oauth_pending_states
    WHERE expires_at <= pg_catalog.clock_timestamp()
  )
  INSERT INTO circles_auth.oauth_pending_states (
    state_fingerprint,
    flow_kind,
    cookie_binding_fingerprint,
    flow_token_fingerprint,
    redirect_uri,
    nonce,
    frontend_origin,
    expires_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

const CONSUME_WEB_PENDING_STATE_SQL = `
  DELETE FROM circles_auth.oauth_pending_states
  WHERE flow_kind = 'web'
    AND state_fingerprint = $1
    AND cookie_binding_fingerprint = $2
    AND expires_at > pg_catalog.clock_timestamp()
  RETURNING
    redirect_uri AS "redirectUri",
    nonce,
    frontend_origin AS "frontendOrigin",
    expires_at AS "expiresAt"
`;

const CONSUME_NATIVE_PENDING_STATE_SQL = `
  DELETE FROM circles_auth.oauth_pending_states
  WHERE flow_kind = 'native'
    AND state_fingerprint = $1
    AND flow_token_fingerprint = $2
    AND expires_at > pg_catalog.clock_timestamp()
  RETURNING
    redirect_uri AS "redirectUri",
    nonce,
    frontend_origin AS "frontendOrigin",
    expires_at AS "expiresAt"
`;

type QueryResult = { rows: Record<string, unknown>[] };

export interface OAuthPendingStateQueryExecutor {
  query(text: string, values: unknown[]): Promise<QueryResult>;
}

export type NewWebOAuthPendingState = {
  state: string;
  cookieBinding: string;
  redirectUri: string;
  nonce: string;
  frontendOrigin: string;
  expiresAt: Date;
};

export type NewNativeOAuthPendingState = {
  state: string;
  flowToken: string;
  redirectUri: string;
  nonce: string;
  expiresAt: Date;
};

export type ConsumedWebOAuthPendingState = {
  redirectUri: string;
  nonce: string;
  frontendOrigin: string;
  expiresAt: Date;
};

export type ConsumedNativeOAuthPendingState = {
  redirectUri: string;
  nonce: string;
  expiresAt: Date;
};

export interface OAuthPendingStateStore {
  createWeb(input: NewWebOAuthPendingState): Promise<void>;
  consumeWeb(input: {
    state: string;
    cookieBinding: string;
  }): Promise<ConsumedWebOAuthPendingState | null>;
  createNative(input: NewNativeOAuthPendingState): Promise<void>;
  consumeNative(input: {
    state: string;
    flowToken: string;
  }): Promise<ConsumedNativeOAuthPendingState | null>;
}

/** Raised when the migration, connection, or restricted runtime role is unavailable. */
export class OAuthPendingStateStoreUnavailableError extends Error {
  constructor() {
    super("OAuth pending state store is unavailable");
    this.name = "OAuthPendingStateStoreUnavailableError";
  }
}

/** Keeps bearer-quality OAuth state and handoff values out of persistent storage. */
export function fingerprintOAuthPendingStateSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hasValidExpiry(value: Date): boolean {
  return Number.isFinite(value.getTime()) && value.getTime() > Date.now();
}

function readExpiry(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(String(value));
  return hasValidExpiry(date) ? date : null;
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

function readConsumedBase(
  row: Record<string, unknown> | undefined,
): { redirectUri: string; nonce: string; expiresAt: Date } | null {
  if (
    !row ||
    !isBoundedString(row.redirectUri, 2_048) ||
    !isBoundedString(row.nonce, 128) ||
    !NONCE_PATTERN.test(row.nonce)
  ) {
    return null;
  }

  const expiresAt = readExpiry(row.expiresAt);
  if (!expiresAt) return null;
  return { redirectUri: row.redirectUri, nonce: row.nonce, expiresAt };
}

/**
 * Uses only the restricted runtime-role pool. Every consume is one DELETE ...
 * RETURNING statement, so one pending row can authorize only one callback
 * across all server instances.
 */
export class PostgresOAuthPendingStateStore implements OAuthPendingStateStore {
  constructor(
    private readonly suppliedExecutor?: OAuthPendingStateQueryExecutor,
  ) {}

  private async executor(): Promise<OAuthPendingStateQueryExecutor> {
    if (this.suppliedExecutor) return this.suppliedExecutor;

    const db = await getDb();
    if (!db) throw new OAuthPendingStateStoreUnavailableError();
    return db.$client as unknown as OAuthPendingStateQueryExecutor;
  }

  private async query(text: string, values: unknown[]): Promise<QueryResult> {
    try {
      return await (await this.executor()).query(text, values);
    } catch {
      throw new OAuthPendingStateStoreUnavailableError();
    }
  }

  async createWeb(input: NewWebOAuthPendingState): Promise<void> {
    if (!hasValidExpiry(input.expiresAt)) {
      throw new OAuthPendingStateStoreUnavailableError();
    }

    await this.query(INSERT_PENDING_STATE_SQL, [
      fingerprintOAuthPendingStateSecret(input.state),
      "web",
      fingerprintOAuthPendingStateSecret(input.cookieBinding),
      null,
      input.redirectUri,
      input.nonce,
      input.frontendOrigin,
      input.expiresAt,
    ]);
  }

  async consumeWeb(input: {
    state: string;
    cookieBinding: string;
  }): Promise<ConsumedWebOAuthPendingState | null> {
    const result = await this.query(CONSUME_WEB_PENDING_STATE_SQL, [
      fingerprintOAuthPendingStateSecret(input.state),
      fingerprintOAuthPendingStateSecret(input.cookieBinding),
    ]);
    const base = readConsumedBase(result.rows[0]);
    if (!base || !isBoundedString(result.rows[0]?.frontendOrigin, 2_048)) {
      return null;
    }

    return { ...base, frontendOrigin: result.rows[0].frontendOrigin };
  }

  async createNative(input: NewNativeOAuthPendingState): Promise<void> {
    if (!hasValidExpiry(input.expiresAt)) {
      throw new OAuthPendingStateStoreUnavailableError();
    }

    await this.query(INSERT_PENDING_STATE_SQL, [
      fingerprintOAuthPendingStateSecret(input.state),
      "native",
      null,
      fingerprintOAuthPendingStateSecret(input.flowToken),
      input.redirectUri,
      input.nonce,
      null,
      input.expiresAt,
    ]);
  }

  async consumeNative(input: {
    state: string;
    flowToken: string;
  }): Promise<ConsumedNativeOAuthPendingState | null> {
    const result = await this.query(CONSUME_NATIVE_PENDING_STATE_SQL, [
      fingerprintOAuthPendingStateSecret(input.state),
      fingerprintOAuthPendingStateSecret(input.flowToken),
    ]);
    const base = readConsumedBase(result.rows[0]);
    if (!base || result.rows[0]?.frontendOrigin !== null) return null;
    return base;
  }
}

export const oauthPendingStateStore = new PostgresOAuthPendingStateStore();
