import { Pool, type PoolClient, type PoolConfig } from "pg";
import { RUNTIME_ROLE } from "./_core/postgres-config.mjs";
import { withOperationDeadline } from "./_core/bounded-network";

export const SET_RUNTIME_ROLE_SQL = `SET ROLE ${RUNTIME_ROLE}`;
export const VERIFY_RUNTIME_ROLE_SQL = `
  SELECT
    current_user = $1 AS runtime_role_active,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = current_user
        AND NOT rolcanlogin
        AND NOT rolinherit
        AND NOT rolsuper
        AND NOT rolbypassrls
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_auth_members
          WHERE member = pg_roles.oid
        )
    ) AS runtime_role_restricted
`;
export const RUNTIME_ROLE_INITIALIZATION_TIMEOUT_MS = 8_000;
export const RUNTIME_ROLE_RELEASE_CLEANUP_SQL = "DISCARD ALL";
export const RUNTIME_ROLE_RELEASE_CLEANUP_TIMEOUT_MS = 8_000;

type PoolConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  done: (releaseError?: Error | boolean) => void,
) => void;

type RuntimeRoleVerificationRow = {
  runtime_role_active: boolean;
  runtime_role_restricted: boolean;
};

type UntypedQuery = (...args: unknown[]) => unknown;

type SqlLexeme = {
  kind: "word" | "symbol";
  value: string;
};

/** Returned instead of a driver error so source URLs or credentials cannot escape through logs. */
export class RuntimeRoleInitializationError extends Error {
  constructor() {
    super("PostgreSQL runtime role initialization failed");
    this.name = "RuntimeRoleInitializationError";
  }
}

/** Returned when application SQL attempts to restore or replace the login role. */
export class RuntimeRoleSessionControlError extends Error {
  constructor() {
    super("PostgreSQL runtime role session control is prohibited");
    this.name = "RuntimeRoleSessionControlError";
  }
}

/** Returned once caller-owned code has released a checked-out runtime client. */
export class RuntimeRoleClientReleasedError extends Error {
  constructor() {
    super("PostgreSQL runtime client has been released");
    this.name = "RuntimeRoleClientReleasedError";
  }
}

function isRestrictedRuntimeRole(result: {
  rows: RuntimeRoleVerificationRow[];
}): boolean {
  const [row] = result.rows;
  return (
    result.rows.length === 1 &&
    row?.runtime_role_active === true &&
    row.runtime_role_restricted === true
  );
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function isDollarQuoteTagPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function skipLineComment(queryText: string, start: number): number {
  const newline = queryText.slice(start + 2).search(/[\r\n]/);
  return newline === -1 ? queryText.length : start + 2 + newline;
}

/** PostgreSQL block comments nest; retain that behavior while finding executable tokens. */
function skipBlockComment(queryText: string, start: number): number {
  let depth = 1;
  let index = start + 2;

  while (index < queryText.length && depth > 0) {
    if (queryText.startsWith("/*", index)) {
      depth += 1;
      index += 2;
    } else if (queryText.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
    } else {
      index += 1;
    }
  }

  return index;
}

function isEscapeStringPrefix(queryText: string, quoteIndex: number): boolean {
  const prefix = queryText[quoteIndex - 1];
  const prefixStart = quoteIndex - 2;
  const unprefixed = !isIdentifierPart(queryText[prefixStart]);

  if (unprefixed && (prefix === "e" || prefix === "E")) return true;
  return (
    prefix === "&" &&
    (queryText[prefixStart] === "u" || queryText[prefixStart] === "U") &&
    !isIdentifierPart(queryText[prefixStart - 1])
  );
}

function skipSingleQuotedString(
  queryText: string,
  start: number,
  backslashEscapes: boolean,
): number {
  let index = start + 1;

  while (index < queryText.length) {
    if (backslashEscapes && queryText[index] === "\\") {
      index += 2;
      continue;
    }
    if (queryText[index] === "'") {
      if (queryText[index + 1] === "'") {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }

  return index;
}

function skipDoubleQuotedIdentifier(queryText: string, start: number): number {
  let index = start + 1;

  while (index < queryText.length) {
    if (queryText[index] === '"') {
      if (queryText[index + 1] === '"') {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }

  return index;
}

function dollarQuoteDelimiterAt(
  queryText: string,
  start: number,
): string | undefined {
  if (queryText[start] !== "$") return undefined;
  if (queryText[start + 1] === "$") return "$$";
  if (!isIdentifierStart(queryText[start + 1])) return undefined;

  let index = start + 2;
  while (isDollarQuoteTagPart(queryText[index])) index += 1;
  return queryText[index] === "$"
    ? queryText.slice(start, index + 1)
    : undefined;
}

function skipDollarQuotedString(
  queryText: string,
  start: number,
  delimiter: string,
): number {
  const end = queryText.indexOf(delimiter, start + delimiter.length);
  return end === -1 ? queryText.length : end + delimiter.length;
}

/**
 * Tokenizes only executable SQL. PostgreSQL comments (including nested block
 * comments), ordinary/E/unicode strings, quoted identifiers, and dollar-quoted
 * bodies are skipped rather than searched as text.
 */
function executableSqlLexemes(queryText: string): SqlLexeme[] {
  const lexemes: SqlLexeme[] = [];
  let index = 0;

  while (index < queryText.length) {
    const character = queryText[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (queryText.startsWith("--", index)) {
      index = skipLineComment(queryText, index);
      continue;
    }
    if (queryText.startsWith("/*", index)) {
      index = skipBlockComment(queryText, index);
      continue;
    }
    if (character === "'") {
      index = skipSingleQuotedString(
        queryText,
        index,
        isEscapeStringPrefix(queryText, index),
      );
      continue;
    }
    if (character === '"') {
      index = skipDoubleQuotedIdentifier(queryText, index);
      continue;
    }
    if (character === "$" && !isIdentifierPart(queryText[index - 1])) {
      const delimiter = dollarQuoteDelimiterAt(queryText, index);
      if (delimiter) {
        index = skipDollarQuotedString(queryText, index, delimiter);
        continue;
      }
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (isIdentifierPart(queryText[index])) index += 1;
      lexemes.push({
        kind: "word",
        value: queryText.slice(start, index).toLowerCase(),
      });
      continue;
    }

    lexemes.push({ kind: "symbol", value: character });
    index += 1;
  }

  return lexemes;
}

function isWord(lexeme: SqlLexeme | undefined, value: string): boolean {
  return lexeme?.kind === "word" && lexeme.value === value;
}

function isProhibitedSessionControlStatement(statement: SqlLexeme[]): boolean {
  const [command] = statement;
  if (isWord(command, "discard")) return true;

  if (isWord(command, "reset")) {
    return (
      isWord(statement[1], "all") ||
      isWord(statement[1], "role") ||
      isWord(statement[1], "session_authorization") ||
      (isWord(statement[1], "session") && isWord(statement[2], "authorization"))
    );
  }

  if (!isWord(command, "set")) return false;

  let index = 1;
  if (isWord(statement[index], "local")) index += 1;
  if (isWord(statement[index], "session")) {
    if (isWord(statement[index + 1], "authorization")) return true;
    index += 1;
  }

  return (
    isWord(statement[index], "role") ||
    isWord(statement[index], "session_authorization")
  );
}

function hasProhibitedSetConfigCall(lexemes: SqlLexeme[]): boolean {
  return lexemes.some(
    (lexeme, index) =>
      isWord(lexeme, "set_config") && lexemes[index + 1]?.value === "(",
  );
}

/**
 * Reject commands which could move a pooled session away from the verified
 * runtime authority. This lexical guard is deliberately an accidental-misuse
 * defense for trusted server code, not a SQL parser or hostile-code sandbox.
 */
export function assertRuntimeRoleSessionControlSafe(queryText: string): void {
  const lexemes = executableSqlLexemes(queryText);
  if (hasProhibitedSetConfigCall(lexemes)) {
    throw new RuntimeRoleSessionControlError();
  }

  let statementStart = 0;
  for (let index = 0; index <= lexemes.length; index += 1) {
    if (index !== lexemes.length && lexemes[index]?.value !== ";") continue;
    if (
      isProhibitedSessionControlStatement(lexemes.slice(statementStart, index))
    ) {
      throw new RuntimeRoleSessionControlError();
    }
    statementStart = index + 1;
  }
}

function queryTextFromInvocation(query: unknown): string | undefined {
  if (typeof query === "string") return query;
  if (
    query !== null &&
    typeof query === "object" &&
    "text" in query &&
    typeof query.text === "string"
  ) {
    return query.text;
  }
  return undefined;
}

function isSubmittableQuery(query: unknown): boolean {
  return (
    query !== null &&
    typeof query === "object" &&
    "submit" in query &&
    typeof query.submit === "function"
  );
}

function rejectedQueryInvocation(
  args: readonly unknown[],
  error: Error,
): Promise<never> | void {
  const callback = [...args]
    .reverse()
    .find((value) => typeof value === "function");
  if (typeof callback === "function") {
    queueMicrotask(() => callback(error, undefined));
    return;
  }
  return Promise.reject(error);
}

/**
 * Gives callers a PoolClient-compatible view without exposing an unguarded
 * query path or allowing a released checkout to race its cleanup barrier. The
 * proxy preserves node-postgres string/config/callback overloads; unknown
 * low-level Submittable objects are rejected because their SQL cannot be
 * reviewed before they submit to the connection.
 */
export function guardRuntimeRoleClient(client: PoolClient): PoolClient {
  const rawQuery = client.query.bind(client) as UntypedQuery;
  const rawRelease = client.release.bind(client);
  let checkoutReleased = false;
  let rawClientReleased = false;

  const onCheckedOutError = (error: Error): void => {
    checkoutReleased = true;
    releaseRawClient(error);
  };

  const releaseRawClient = (releaseError?: Error | boolean): void => {
    if (rawClientReleased) return;
    rawClientReleased = true;
    if (typeof client.removeListener === "function") {
      client.removeListener("error", onCheckedOutError);
    }
    try {
      if (releaseError === undefined) rawRelease();
      else rawRelease(releaseError);
    } catch {
      // The raw client is already unusable and must never be exposed again.
    }
  };

  const cleanupThenRelease = async (): Promise<void> => {
    try {
      await withOperationDeadline(
        Promise.resolve(rawQuery(RUNTIME_ROLE_RELEASE_CLEANUP_SQL)),
        RUNTIME_ROLE_RELEASE_CLEANUP_TIMEOUT_MS,
      );
      releaseRawClient();
    } catch {
      // DISCARD ALL is invalid in a leaked transaction. A timeout or driver
      // failure is likewise unsafe: destroy rather than return this session.
      releaseRawClient(true);
    }
  };

  const guardedRelease = ((releaseError?: Error | boolean): void => {
    if (checkoutReleased) return;
    checkoutReleased = true;

    if (releaseError) {
      releaseRawClient(releaseError);
      return;
    }

    // PoolClient.release() is void. Keep the checked-out client terminal now,
    // then return the raw client only when its bounded cleanup has succeeded.
    void cleanupThenRelease();
  }) as PoolClient["release"];

  const guardedQuery = ((...args: unknown[]) => {
    if (checkoutReleased) {
      return rejectedQueryInvocation(
        args,
        new RuntimeRoleClientReleasedError(),
      );
    }

    const [queryInput] = args;
    const queryText = queryTextFromInvocation(queryInput);

    try {
      if (queryText !== undefined) {
        assertRuntimeRoleSessionControlSafe(queryText);
      } else if (isSubmittableQuery(queryInput)) {
        throw new RuntimeRoleSessionControlError();
      }
    } catch (error) {
      if (error instanceof RuntimeRoleSessionControlError) {
        return rejectedQueryInvocation(args, error);
      }
      throw error;
    }

    return rawQuery(...args);
  }) as PoolClient["query"];

  // pg-pool handles errors on idle clients, not checked-out ones. Own that
  // interval (including the asynchronous cleanup barrier) and retire failures.
  if (typeof client.on === "function") client.on("error", onCheckedOutError);

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") return guardedQuery;
      if (property === "release") return guardedRelease;
      // PoolClient does not expose this internal driver connection in its public
      // type. Do not leave it as a second, unguarded query submission path.
      if (property === "connection") {
        throw new RuntimeRoleSessionControlError();
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * Executes before application code sees a checked-out connection. Failure
 * destroys the client rather than returning it to the pool as postgres.
 */
export async function initializeRuntimeRole(
  client: PoolClient,
): Promise<PoolClient> {
  try {
    await withOperationDeadline(
      client.query(SET_RUNTIME_ROLE_SQL),
      RUNTIME_ROLE_INITIALIZATION_TIMEOUT_MS,
    );
    const verification = await withOperationDeadline(
      client.query<RuntimeRoleVerificationRow>(VERIFY_RUNTIME_ROLE_SQL, [
        RUNTIME_ROLE,
      ]),
      RUNTIME_ROLE_INITIALIZATION_TIMEOUT_MS,
    );
    if (!isRestrictedRuntimeRole(verification)) {
      throw new Error("runtime role verification did not pass");
    }
    return client;
  } catch {
    try {
      client.release(true);
    } catch {
      // The checkout is already unusable; retain the generic external error.
    }
    throw new RuntimeRoleInitializationError();
  }
}

/**
 * A node-postgres Pool subclass, not a query wrapper. Parent `pool.query()`
 * internally calls this overridden `connect()`, while Drizzle transactions use
 * the Promise overload; both paths therefore receive only verified, guarded
 * runtime clients.
 */
export class RuntimeRolePool extends Pool {
  private async acquireRuntimeClient(): Promise<PoolClient> {
    let client: PoolClient | undefined;
    try {
      client = await super.connect();
      await initializeRuntimeRole(client);
      return guardRuntimeRoleClient(client);
    } catch (error) {
      // initializeRuntimeRole already destroys a client whose SET ROLE or
      // verification failed. A pre-initialization acquire failure has no client.
      if (error instanceof RuntimeRoleInitializationError) throw error;
      if (client) client.release(true);
      throw new RuntimeRoleInitializationError();
    }
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: PoolConnectCallback): void;
  override connect(callback?: PoolConnectCallback): Promise<PoolClient> | void {
    const acquisition = this.acquireRuntimeClient();
    if (!callback) return acquisition;

    void acquisition.then(
      (client) =>
        callback(undefined, client, (releaseError) =>
          client.release(releaseError),
        ),
      () =>
        callback(
          new RuntimeRoleInitializationError(),
          undefined,
          () => undefined,
        ),
    );
  }
}

export function createRuntimeRolePool(options: PoolConfig): RuntimeRolePool {
  return new RuntimeRolePool(options);
}
