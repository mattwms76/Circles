import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("email identity PG17 runner timestamp regression", () => {
  it("demonstrates why same-second Date strings cannot prove an update", () => {
    const before = new Date("2026-01-01T00:00:00.001Z");
    const after = new Date("2026-01-01T00:00:00.006Z");

    expect(String(before)).toBe(String(after));
    expect(before.toISOString()).not.toBe(after.toISOString());
  });

  it("retains exact SQL persistence checks without a wall-clock sleep (source contract)", async () => {
    const source = await readFile(
      resolve(process.cwd(), "scripts/run-email-identity-e2e.mjs"),
      "utf8",
    );

    expect(source).toContain(
      'const fixtureBeforeSignIn = "2026-01-01T00:00:00.001Z"',
    );
    expect(source).toContain('new Date("2026-01-01T00:00:00.006Z")');
    expect(
      source.match(/"lastSignedIn"::text AS "lastSignedIn"/g),
    ).toHaveLength(2);
    expect(source).toContain(
      '"lastSignedIn" = $1::timestamptz AS "matchesExpected"',
    );
    expect(source).toContain(
      "assert.equal(afterExistingSignIn.rows[0].matchesExpected, true)",
    );
    expect(source).not.toContain(
      "String(beforeExistingSignIn.rows[0].lastSignedIn)",
    );
    expect(source).not.toContain("setTimeout(resolve, 5)");
  });
});
