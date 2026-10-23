import { describe, expect, it } from "vitest";
const { currentAuditInventory } = await import(
  new URL("../scripts/circles-supabase-security-audit.mjs", import.meta.url)
    .href
);
const { REQUIRED_APPLICATION_COLUMNS } = await import(
  new URL("../scripts/recover-api.mjs", import.meta.url).href
);
const { LEGACY_TABLE_NAMES } = await import(
  new URL("../scripts/supabase-data-manifest.mjs", import.meta.url).href
);

describe("active Activity Inbox schema inventory", () => {
  it("adds PostgreSQL-only tables without rewriting the historical source inventory", () => {
    const current = currentAuditInventory(
      REQUIRED_APPLICATION_COLUMNS,
      LEGACY_TABLE_NAMES,
    );
    expect(LEGACY_TABLE_NAMES).toHaveLength(21);
    expect(LEGACY_TABLE_NAMES).not.toContain("activityItems");
    expect(current).toHaveLength(24);
    expect(current).toEqual(
      expect.arrayContaining([
        "activityItems",
        "activityPreferences",
        "activityCirclePreferences",
      ]),
    );
    expect(current).not.toContain("_dataMigrations");
  });
  it("fails closed if the current contract loses legacy objects or the import marker", () => {
    expect(() => currentAuditInventory({ users: ["id"] }, ["users"])).toThrow();
    expect(() =>
      currentAuditInventory({ _dataMigrations: ["key"] }, ["users"]),
    ).toThrow();
    expect(() => currentAuditInventory({ _dataMigrations: [] }, [])).toThrow();
  });
});
