import { describe, expect, it } from "vitest";
const { evaluateRuntimePrivileges } = await import(
  new URL("../scripts/circles-supabase-security-audit.mjs", import.meta.url)
    .href
);
function evidence() {
  return ["moderationCases", "moderationActions", "_dataMigrations"].map(
    (table_name) => ({
      table_name,
      can_select: true,
      can_insert: table_name !== "_dataMigrations",
      can_update: table_name === "moderationCases",
      can_delete: table_name === "moderationCases",
      can_truncate: false,
      can_references: false,
      can_trigger: false,
      can_maintain: false,
    }),
  );
}
describe("moderation action least-privilege evidence", () => {
  it("requires history SELECT/INSERT while preserving ordinary case CRUD and read-only markers", () => {
    expect(
      evaluateRuntimePrivileges(
        ["moderationCases", "moderationActions"],
        "_dataMigrations",
        evidence(),
      ).status,
    ).toBe("pass");
  });
  it.each([
    "can_update",
    "can_delete",
    "can_truncate",
    "can_references",
    "can_trigger",
    "can_maintain",
  ])("rejects excess %s on moderation actions", (privilege) => {
    const rows = evidence();
    Object.assign(rows[1], { [privilege]: true });
    expect(
      evaluateRuntimePrivileges(
        ["moderationCases", "moderationActions"],
        "_dataMigrations",
        rows,
      ).status,
    ).toBe("fail");
  });
  it("rejects missing action insert or ordinary case update", () => {
    for (const [index, privilege] of [
      [1, "can_insert"],
      [0, "can_update"],
    ] as const) {
      const rows = evidence();
      Object.assign(rows[index], { [privilege]: false });
      expect(
        evaluateRuntimePrivileges(
          ["moderationCases", "moderationActions"],
          "_dataMigrations",
          rows,
        ).status,
      ).toBe("fail");
    }
  });
});
