import { describe, expect, it, vi } from "vitest";

const liv005DisplayProfileMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("../server/db", () => ({
  getDb: liv005DisplayProfileMocks.getDb,
}));

const { getDisplayProfile } = await import("../server/social-service");

function liv005ReadOnlyProfileDb(readResults: unknown[][]) {
  const insert = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();
  const limit = vi.fn(() => Promise.resolve(readResults.shift() ?? []));

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    })),
    insert,
    update,
    delete: remove,
  };
}

describe("LIV-005 display profile lookup", () => {
  it("returns a host display fallback for a missing profile without materializing it", async () => {
    const database = liv005ReadOnlyProfileDb([
      [],
      [{ name: "  Archived host  " }],
    ]);
    liv005DisplayProfileMocks.getDb.mockResolvedValue(database);

    await expect(getDisplayProfile(73)).resolves.toEqual({
      id: 73,
      name: "Archived host",
      handle: "member-73",
      bio: "",
      avatar: "",
      followers: 0,
      following: 0,
    });
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(database.delete).not.toHaveBeenCalled();
  });
});
