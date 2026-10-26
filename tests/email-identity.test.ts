import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  EmailIdentityLinkRequiredError,
  EmailIdentityStore,
  EmailIdentityUnavailableError,
} from "../server/_core/email-identity";

const identity = {
  subject: "4a8b4821-a2bf-4a84-8dd7-e9f2723e5eb1",
  email: "member@example.test",
  name: "Member",
};
const sourceOpenId = `supabase:${identity.subject}`;

type FakeDatabase = {
  execute: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

function queuedDatabase(rows: unknown[][]): FakeDatabase {
  const execute = vi.fn();
  for (const next of rows) execute.mockResolvedValueOnce({ rows: next });
  const database: FakeDatabase = {
    execute,
    transaction: vi.fn(async (work: (transaction: FakeDatabase) => unknown) =>
      work(database),
    ),
  };
  return database;
}

describe("email provider identity authority", () => {
  it("uses the existing durable subject mapping without creating a source user", async () => {
    const database = queuedDatabase([
      [],
      [],
      [{ userId: 71, openId: sourceOpenId, name: "Existing" }],
    ]);
    const upsertSourceUserInTransaction = vi.fn();
    const store = new EmailIdentityStore({
      getDatabase: async () => database as never,
      upsertSourceUserInTransaction,
    });

    await expect(store.resolveForSignIn(identity)).resolves.toEqual({
      userId: 71,
      openId: sourceOpenId,
      name: "Existing",
    });
    expect(upsertSourceUserInTransaction).not.toHaveBeenCalled();
    expect(database.execute).toHaveBeenCalledTimes(3);
  });

  it("runs the established registration source-upsert helper and mapping insert in one identity transaction", async () => {
    const database = queuedDatabase([
      // subject lock, normalized email allocation lock, no mapping/source/collision
      [],
      [],
      [],
      [],
      [],
      // source created by the injected transaction-aware helper, then re-read,
      // collision check, immutable user mapping check, and map insert
      [{ id: 72, openId: sourceOpenId, name: "Member" }],
      [],
      [],
      [],
    ]);
    const upsertSourceUserInTransaction = vi.fn(async () => undefined);
    const store = new EmailIdentityStore({
      getDatabase: async () => database as never,
      upsertSourceUserInTransaction,
    });

    await expect(store.resolveForSignIn(identity)).resolves.toEqual({
      userId: 72,
      openId: sourceOpenId,
      name: "Member",
    });
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(upsertSourceUserInTransaction).toHaveBeenCalledWith(database, {
      openId: sourceOpenId,
      name: "Member",
      email: identity.email,
      loginMethod: "email",
    });
    const source = readFileSync("server/_core/email-identity.ts", "utf8");
    expect(source).toContain("await this.upsertSourceUserInTransaction");
    expect(source).toContain("await database.transaction");
    expect(source).not.toContain("await this.upsertSourceUser(");
    expect(source).not.toMatch(/role:\s*["']admin/);
    expect(source).toContain("supabase:");
  });

  it("refuses a same-email legacy/source collision only after provider validation reaches this store", async () => {
    const database = queuedDatabase([[], [], [], [], [{ id: 9 }]]);
    const upsertSourceUserInTransaction = vi.fn();
    const store = new EmailIdentityStore({
      getDatabase: async () => database as never,
      upsertSourceUserInTransaction,
    });

    await expect(store.resolveForSignIn(identity)).rejects.toBeInstanceOf(
      EmailIdentityLinkRequiredError,
    );
    expect(upsertSourceUserInTransaction).not.toHaveBeenCalled();
  });

  it("connects only an actual actor user and refuses both subject and user-unique cross-account conflicts", async () => {
    const subjectAlreadyLinked = queuedDatabase([
      [],
      [],
      [{ userId: 88, openId: "legacy-user", name: "Other" }],
    ]);
    const storeBySubject = new EmailIdentityStore({
      getDatabase: async () => subjectAlreadyLinked as never,
    });
    await expect(
      storeBySubject.linkToExistingUser(identity, 19),
    ).rejects.toBeInstanceOf(EmailIdentityLinkRequiredError);

    const userAlreadyLinked = queuedDatabase([
      [],
      [],
      [],
      [{ subject: "7f9ad046-2ba1-48b2-bb14-d649015c80a7" }],
    ]);
    const storeByUser = new EmailIdentityStore({
      getDatabase: async () => userAlreadyLinked as never,
    });
    await expect(
      storeByUser.linkToExistingUser(identity, 19),
    ).rejects.toBeInstanceOf(EmailIdentityLinkRequiredError);
  });

  it("fails unavailable with no fake mapping when database configuration/store access is missing", async () => {
    const store = new EmailIdentityStore({ getDatabase: async () => null });
    await expect(store.resolveForSignIn(identity)).rejects.toBeInstanceOf(
      EmailIdentityUnavailableError,
    );
    await expect(store.isReady()).resolves.toBe(false);
  });

  it("preserves an immutable same-source mapping after a unique insert conflict", async () => {
    const unique = Object.assign(new Error("duplicate"), { code: "23505" });
    const database = queuedDatabase([
      // subject lock, email lock, no subject link, existing source, no collision
      [],
      [],
      [],
      [{ id: 72, openId: sourceOpenId, name: "Member" }],
      [],
      // second collision check, no existing user binding, failed insert
      [],
      [],
      [],
      // fresh post-rollback transaction: subject lock, email lock, re-read
      [],
      [],
      [{ userId: 72, openId: sourceOpenId, name: "Member" }],
    ]);
    database.execute.mockReset();
    [
      [],
      [],
      [],
      [{ id: 72, openId: sourceOpenId, name: "Member" }],
      [],
      [],
      [],
      unique,
      [],
      [],
      [{ userId: 72, openId: sourceOpenId, name: "Member" }],
    ].forEach((next) => {
      if (next === unique) database.execute.mockRejectedValueOnce(unique);
      else database.execute.mockResolvedValueOnce({ rows: next });
    });
    const store = new EmailIdentityStore({
      getDatabase: async () => database as never,
    });

    await expect(store.resolveForSignIn(identity)).resolves.toEqual({
      userId: 72,
      openId: sourceOpenId,
      name: "Member",
    });
    expect(database.transaction).toHaveBeenCalledTimes(2);
  });
});

describe("0014 private provider-link migration", () => {
  const migration = readFileSync(
    "operations/migrations/0014_circles_email_identity.sql",
    "utf8",
  );

  it("creates only the dedicated private mapping with immutable UUID and user uniqueness", () => {
    expect(migration).toContain(
      "CREATE SCHEMA circles_identity AUTHORIZATION postgres;",
    );
    expect(migration).toContain("provider_subject uuid PRIMARY KEY");
    expect(migration).toContain("user_id integer NOT NULL UNIQUE");
    expect(migration).toContain(
      "REFERENCES circles_app.users(id) ON DELETE CASCADE",
    );
    expect(migration).toContain("created_at timestamptz NOT NULL");
    expect(migration).not.toMatch(/CREATE\s+(?:FUNCTION|ROLE)\b/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+circles_app\./i);
  });

  it("keeps schema/table private, owner-postgres, FORCE RLS, and only runtime SELECT/INSERT policies", () => {
    expect(migration).toContain(
      "ALTER TABLE circles_identity.provider_links OWNER TO postgres;",
    );
    expect(migration).toContain("REVOKE ALL ON SCHEMA circles_identity");
    expect(migration).toContain(
      "FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;",
    );
    expect(migration).toContain(
      "GRANT USAGE ON SCHEMA circles_identity TO circles_app_runtime;",
    );
    expect(migration).toContain(
      "GRANT SELECT, INSERT ON TABLE circles_identity.provider_links",
    );
    expect(migration).toContain(
      "REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER",
    );
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("FOR SELECT\n  TO circles_app_runtime");
    expect(migration).toContain("FOR INSERT\n  TO circles_app_runtime");
    expect(migration).not.toContain("FOR ALL");
    expect(migration).not.toContain("GRANT UPDATE");
    expect(migration).not.toContain("GRANT DELETE");
  });
});
