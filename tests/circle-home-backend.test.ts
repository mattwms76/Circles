import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  bookmarks,
  circles,
  comments,
  memberships,
  posts,
  profiles,
  reactions,
  users,
} from "../drizzle/schema";
import type { TrpcContext } from "../server/_core/context";
import {
  circleHomePinInput,
  circleHomeRouter,
  circleHomeUpdateInput,
} from "../server/circle-home-router";

const circleHomeDbMocks = vi.hoisted(() => ({ getDb: vi.fn() }));
const circleHomeServiceMocks = vi.hoisted(() => ({
  getCircleHome: vi.fn(),
  setCirclePinnedPost: vi.fn(),
  updateCircleHome: vi.fn(),
}));
vi.mock("../server/db", () => ({ getDb: circleHomeDbMocks.getDb }));
vi.mock("../server/social-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/social-service")>();
  circleHomeServiceMocks.getCircleHome.mockImplementation(actual.getCircleHome);
  circleHomeServiceMocks.setCirclePinnedPost.mockImplementation(
    actual.setCirclePinnedPost,
  );
  circleHomeServiceMocks.updateCircleHome.mockImplementation(
    actual.updateCircleHome,
  );
  return { ...actual, ...circleHomeServiceMocks };
});

const {
  getCircleHome,
  normalizeCircleHomePinInput,
  normalizeCircleHomeTextInput,
  setCirclePinnedPost,
  updateCircleHome,
} = await import("../server/social-service");

type Role = "owner" | "moderator" | "member" | "pending" | null;
type Privacy = "public" | "private";
type PostMode = "same" | "foreign" | "missing";

type CircleHomeFixtureOptions = {
  privacy?: Privacy;
  role?: Role;
  welcomeMessage?: string;
  rules?: string[];
  pinnedPostId?: number | null;
  postMode?: PostMode;
  onCircleLock?: () => void;
};

/** A minimal in-memory Drizzle-shaped fixture; it never connects or creates real database rows. */
function createCircleHomeFixture(options: CircleHomeFixtureOptions = {}) {
  const updatedAt = new Date("2026-10-23T12:00:00.000Z");
  let role = options.role ?? null;
  let locked = false;
  let lockCount = 0;
  const postWhereClauses: unknown[] = [];
  const updateValues: Record<string, unknown>[] = [];
  const insert = vi.fn();
  const remove = vi.fn();
  const circle = {
    id: 1,
    ownerId: 1,
    name: "Fixture circle",
    privacy: options.privacy ?? "public",
    welcomeMessage: options.welcomeMessage ?? "Welcome, friends.",
    rules: [...(options.rules ?? ["Be kind."])],
    pinnedPostId: options.pinnedPostId ?? null,
    updatedAt,
  };
  const postMode = options.postMode ?? "same";
  const post = {
    id: 101,
    authorId: 9,
    circleId: postMode === "foreign" ? 2 : 1,
    text: "A real existing post",
    media: null,
    mediaType: "text" as const,
    createdAt: updatedAt,
    updatedAt,
  };

  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === circles) return [circle];
    if (table === memberships) return role ? [{ role }] : [];
    if (table === posts) {
      if (postMode === "missing") return [];
      // A reader's joined target predicate never returns a corrupt foreign pointer. A mutation
      // deliberately reads it after locking so it can reject a foreign existing post generically.
      if (postMode === "foreign" && !locked) return [];
      return [post];
    }
    if (table === profiles) return [];
    if (table === users) return [{ name: "  Archived author  " }];
    if (table === reactions || table === comments) return [{ total: 0 }];
    if (table === bookmarks) return [];
    throw new Error("Unexpected Circle Home fixture query");
  };

  let database: object;
  const transaction = async <T>(callback: (tx: object) => Promise<T>) =>
    callback(database);
  const select = vi.fn((_selection?: Record<string, unknown>) => ({
    from: (table: unknown) => ({
      where: (condition: unknown) => {
        if (table === posts) postWhereClauses.push(condition);
        return {
          limit: () => ({
            for: async () => {
              if (table === circles) {
                locked = true;
                lockCount += 1;
                options.onCircleLock?.();
              }
              return rowsFor(table);
            },
            then: (resolve: (rows: Record<string, unknown>[]) => unknown) =>
              Promise.resolve(rowsFor(table)).then(resolve),
          }),
        };
      },
    }),
  }));
  const update = vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        if (table !== circles)
          throw new Error("Only Circle Home metadata may be updated");
        updateValues.push(values);
        if (typeof values.welcomeMessage === "string") {
          circle.welcomeMessage = values.welcomeMessage;
        }
        if (Array.isArray(values.rules))
          circle.rules = [...values.rules] as string[];
        if (Object.hasOwn(values, "pinnedPostId")) {
          circle.pinnedPostId = values.pinnedPostId as number | null;
        }
        if (values.updatedAt instanceof Date)
          circle.updatedAt = values.updatedAt;
      },
    }),
  }));
  database = { select, update, insert, delete: remove, transaction };

  return {
    database,
    circle,
    insert,
    lockCount: () => lockCount,
    postWhereClauses: () => postWhereClauses,
    remove,
    update,
    updateValues,
    setRole: (nextRole: Role) => {
      role = nextRole;
    },
  };
}

function authenticatedContext(userId = 71): TrpcContext {
  const now = new Date("2026-10-23T12:00:00.000Z");
  return {
    user: {
      id: userId,
      openId: `synthetic-${userId}`,
      name: null,
      email: null,
      loginMethod: null,
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

async function errorShape(action: () => Promise<unknown>) {
  try {
    await action();
    throw new Error("Expected Circle Home action to reject");
  } catch (error) {
    const result = error as { code?: unknown; message?: unknown };
    return { code: result.code, message: result.message };
  }
}

beforeEach(() => {
  circleHomeDbMocks.getDb.mockReset();
  circleHomeServiceMocks.getCircleHome.mockClear();
  circleHomeServiceMocks.setCirclePinnedPost.mockClear();
  circleHomeServiceMocks.updateCircleHome.mockClear();
});

describe("Circle Home visibility and mapping", () => {
  it("allows a guest to read a public home, but rejects private guests and pending members", async () => {
    const publicFixture = createCircleHomeFixture({ privacy: "public" });
    circleHomeDbMocks.getDb.mockResolvedValue(publicFixture.database);
    await expect(getCircleHome(null, 1)).resolves.toMatchObject({
      circleId: 1,
      viewerId: null,
      welcomeMessage: "Welcome, friends.",
      rules: ["Be kind."],
      pinnedPost: null,
      canManage: false,
      updatedAt: "2026-10-23T12:00:00.000Z",
    });

    const privateFixture = createCircleHomeFixture({ privacy: "private" });
    circleHomeDbMocks.getDb.mockResolvedValue(privateFixture.database);
    await expect(getCircleHome(null, 1)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const pendingFixture = createCircleHomeFixture({
      privacy: "private",
      role: "pending",
    });
    circleHomeDbMocks.getDb.mockResolvedValue(pendingFixture.database);
    await expect(getCircleHome(71, 1)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows an approved private member, derives canManage from the current role, and never provisions profiles while mapping", async () => {
    const fixture = createCircleHomeFixture({
      privacy: "private",
      role: "member",
      pinnedPostId: 101,
    });
    circleHomeDbMocks.getDb.mockResolvedValue(fixture.database);

    await expect(getCircleHome(71, 1)).resolves.toMatchObject({
      circleId: 1,
      viewerId: 71,
      canManage: false,
      pinnedPost: {
        id: 101,
        circleId: 1,
        author: { id: 9, name: "Archived author", handle: "member-9" },
      },
    });
    expect(fixture.insert).not.toHaveBeenCalled();
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.remove).not.toHaveBeenCalled();

    for (const role of ["owner", "moderator"] as const) {
      const managerFixture = createCircleHomeFixture({
        privacy: "private",
        role,
      });
      circleHomeDbMocks.getDb.mockResolvedValue(managerFixture.database);
      await expect(getCircleHome(71, 1)).resolves.toMatchObject({
        canManage: true,
      });
    }
  });

  it("hides corrupt or foreign pinned metadata before invoking the post mapper", async () => {
    const fixture = createCircleHomeFixture({
      privacy: "public",
      pinnedPostId: 101,
      postMode: "foreign",
    });
    circleHomeDbMocks.getDb.mockResolvedValue(fixture.database);

    await expect(getCircleHome(null, 1)).resolves.toMatchObject({
      pinnedPost: null,
    });
    expect(fixture.insert).not.toHaveBeenCalled();
  });
});

describe("Circle Home manager mutations", () => {
  it("permits only owners and moderators to save text, and rechecks a role revoked before the parent lock", async () => {
    for (const role of ["owner", "moderator"] as const) {
      const fixture = createCircleHomeFixture({ role, pinnedPostId: 101 });
      circleHomeDbMocks.getDb.mockResolvedValue(fixture.database);
      await expect(
        updateCircleHome(71, {
          circleId: 1,
          welcomeMessage: "  Updated welcome.  ",
          rules: ["  Respect privacy.  "],
        }),
      ).resolves.toEqual({ success: true });
      expect(fixture.circle).toMatchObject({
        welcomeMessage: "Updated welcome.",
        rules: ["Respect privacy."],
        pinnedPostId: 101,
      });
      expect(fixture.updateValues[0]).not.toHaveProperty("pinnedPostId");
    }

    for (const role of ["member", "pending"] as const) {
      const fixture = createCircleHomeFixture({ role });
      circleHomeDbMocks.getDb.mockResolvedValue(fixture.database);
      await expect(
        updateCircleHome(71, {
          circleId: 1,
          welcomeMessage: "Nope",
          rules: [],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixture.update).not.toHaveBeenCalled();
    }

    let revocationFixture: ReturnType<typeof createCircleHomeFixture>;
    revocationFixture = createCircleHomeFixture({
      role: "owner",
      onCircleLock: () => revocationFixture.setRole("member"),
    });
    circleHomeDbMocks.getDb.mockResolvedValue(revocationFixture.database);
    await expect(
      updateCircleHome(71, {
        circleId: 1,
        welcomeMessage: "After revocation",
        rules: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(revocationFixture.lockCount()).toBe(1);
    expect(revocationFixture.update).not.toHaveBeenCalled();
  });

  it("hides missing and foreign pin targets behind the same scoped NOT_FOUND result, then replaces and explicitly unpins idempotently without overwriting text", async () => {
    const missing = createCircleHomeFixture({
      role: "owner",
      postMode: "missing",
    });
    circleHomeDbMocks.getDb.mockResolvedValue(missing.database);
    const missingError = await errorShape(() =>
      setCirclePinnedPost(71, { circleId: 1, postId: 101 }),
    );
    expect(missingError).toEqual({
      code: "NOT_FOUND",
      message: "Post is unavailable for this circle",
    });
    expect(missing.update).not.toHaveBeenCalled();

    const foreign = createCircleHomeFixture({
      role: "owner",
      postMode: "foreign",
    });
    circleHomeDbMocks.getDb.mockResolvedValue(foreign.database);
    // This fixture deliberately returns a foreign row even for the scoped query, proving the
    // defensive response remains non-disclosing if a non-SQL/mock adapter violates its predicate.
    const foreignError = await errorShape(() =>
      setCirclePinnedPost(71, { circleId: 1, postId: 101 }),
    );
    expect(foreignError).toEqual(missingError);
    expect(foreign.update).not.toHaveBeenCalled();
    const postTargetSql = new PgDialect().sqlToQuery(
      foreign.postWhereClauses()[0] as SQL,
    ).sql;
    expect(postTargetSql).toContain('"posts"."id"');
    expect(postTargetSql).toContain('"posts"."circleId"');

    const fixture = createCircleHomeFixture({
      role: "owner",
      welcomeMessage: "Text remains independent.",
      rules: ["Original rule."],
      pinnedPostId: 77,
    });
    circleHomeDbMocks.getDb.mockResolvedValue(fixture.database);
    await expect(
      setCirclePinnedPost(71, { circleId: 1, postId: 101 }),
    ).resolves.toEqual({
      success: true,
    });
    await expect(
      setCirclePinnedPost(71, { circleId: 1, postId: 101 }),
    ).resolves.toEqual({
      success: true,
    });
    expect(fixture.circle).toMatchObject({
      pinnedPostId: 101,
      welcomeMessage: "Text remains independent.",
      rules: ["Original rule."],
    });
    expect(fixture.updateValues).toHaveLength(1);
    expect(fixture.updateValues[0]).not.toHaveProperty("welcomeMessage");
    expect(fixture.updateValues[0]).not.toHaveProperty("rules");

    await expect(
      setCirclePinnedPost(71, { circleId: 1, postId: null }),
    ).resolves.toEqual({
      success: true,
    });
    await expect(
      setCirclePinnedPost(71, { circleId: 1, postId: null }),
    ).resolves.toEqual({
      success: true,
    });
    expect(fixture.circle.pinnedPostId).toBeNull();
    expect(fixture.updateValues).toHaveLength(2);
  });
});

describe("Circle Home router and validation boundaries", () => {
  it("uses protected procedures for writes and rejects client actor identifiers", async () => {
    const caller = circleHomeRouter.createCaller({
      user: null,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });
    await expect(
      caller.update({
        circleId: 1,
        welcomeMessage: "Allowed shape",
        rules: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.pin({ circleId: 1, postId: null }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    expect(
      circleHomeUpdateInput.safeParse({
        circleId: 1,
        welcomeMessage: "Hello",
        rules: [],
        userId: 999,
      }).success,
    ).toBe(false);
    expect(authenticatedContext(71).user?.id).toBe(71);
  });

  it("binds optional viewer scope to the actual signed or guest context before service calls", async () => {
    const signedCaller = circleHomeRouter.createCaller(
      authenticatedContext(71),
    );
    const guestCaller = circleHomeRouter.createCaller({
      user: null,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });

    await expect(
      signedCaller.get({ circleId: 1, viewerScope: 72 }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Account changed. Please try again.",
    });
    await expect(
      guestCaller.get({ circleId: 1, viewerScope: 71 }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Account changed. Please try again.",
    });
    await expect(
      signedCaller.update({
        circleId: 1,
        viewerScope: 72,
        welcomeMessage: "No service call",
        rules: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      signedCaller.pin({ circleId: 1, viewerScope: 72, postId: null }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(circleHomeServiceMocks.getCircleHome).not.toHaveBeenCalled();
    expect(circleHomeServiceMocks.updateCircleHome).not.toHaveBeenCalled();
    expect(circleHomeServiceMocks.setCirclePinnedPost).not.toHaveBeenCalled();
    expect(circleHomeDbMocks.getDb).not.toHaveBeenCalled();
  });

  it("trims valid text, permits explicit empty clears, and rejects invalid IDs, blank/duplicate/oversized rules, and oversize welcome text", () => {
    expect(
      circleHomeUpdateInput.parse({
        circleId: 1,
        welcomeMessage: "  Hello  ",
        rules: ["  Be kind.  "],
      }),
    ).toEqual({ circleId: 1, welcomeMessage: "Hello", rules: ["Be kind."] });
    expect(
      circleHomeUpdateInput.safeParse({
        circleId: 1,
        welcomeMessage: "",
        rules: [],
      }).success,
    ).toBe(true);
    expect(
      circleHomePinInput.safeParse({ circleId: 1, postId: null }).success,
    ).toBe(true);
    for (const invalid of [
      { circleId: 0, welcomeMessage: "", rules: [] },
      { circleId: 2_147_483_648, welcomeMessage: "", rules: [] },
      { circleId: 1, welcomeMessage: "x".repeat(2_001), rules: [] },
      { circleId: 1, welcomeMessage: "", rules: ["   "] },
      { circleId: 1, welcomeMessage: "", rules: ["same", " SAME "] },
      { circleId: 1, welcomeMessage: "", rules: ["x".repeat(301)] },
      {
        circleId: 1,
        welcomeMessage: "",
        rules: Array.from({ length: 11 }, (_, i) => `rule ${i}`),
      },
    ]) {
      expect(circleHomeUpdateInput.safeParse(invalid).success).toBe(false);
    }
    expect(
      normalizeCircleHomeTextInput({
        circleId: 1,
        welcomeMessage: "",
        rules: [],
      }),
    ).toEqual({
      circleId: 1,
      welcomeMessage: "",
      rules: [],
    });
    expect(() =>
      normalizeCircleHomePinInput({
        circleId: 1,
        postId: 2_147_483_648 as never,
      }),
    ).toThrow();
  });

  it("counts text as Unicode code points and rejects CR/LF and normalized duplicates at router and direct-service boundaries", () => {
    const astral = "😀";
    expect(
      circleHomeUpdateInput.safeParse({
        circleId: 1,
        welcomeMessage: astral.repeat(2_000),
        rules: [astral.repeat(300)],
      }).success,
    ).toBe(true);
    for (const invalid of [
      { circleId: 1, welcomeMessage: astral.repeat(2_001), rules: [] },
      { circleId: 1, welcomeMessage: "", rules: [astral.repeat(301)] },
      { circleId: 1, welcomeMessage: "", rules: ["first\r\nsecond"] },
      { circleId: 1, welcomeMessage: "", rules: ["same", "same"] },
      { circleId: 1, welcomeMessage: "", rules: ["same", "SAME"] },
      { circleId: 1, welcomeMessage: "", rules: ["same", " same "] },
    ]) {
      expect(circleHomeUpdateInput.safeParse(invalid).success).toBe(false);
      expect(() => normalizeCircleHomeTextInput(invalid)).toThrow();
    }
    expect(
      normalizeCircleHomeTextInput({
        circleId: 1,
        welcomeMessage: astral.repeat(2_000),
        rules: [astral.repeat(300)],
      }),
    ).toMatchObject({
      welcomeMessage: astral.repeat(2_000),
      rules: [astral.repeat(300)],
    });
  });
});

describe("Circle Home additive storage contract", () => {
  it("appends only the three Circle Home columns in Drizzle and keeps the migration field-only with future-write checks and delete-clearing FK", () => {
    const columns = getTableConfig(circles).columns.map(
      (column) => column.name,
    );
    expect(columns.slice(-3)).toEqual([
      "welcomeMessage",
      "rules",
      "pinnedPostId",
    ]);
    const migration = readFileSync(
      resolve(
        import.meta.dirname,
        "../operations/migrations/0008_circles_home.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS \"welcomeMessage\" text NOT NULL DEFAULT ''::text",
    );
    expect(migration).toContain("jsonb_path_exists");
    expect(migration).toContain('like_regex "[\\r\\n]"');
    expect(migration).toContain("pg_catalog.translate(pg_catalog.btrim");
    expect(
      migration.match(
        /AND \(rules ->> \d IS NULL OR rules ->> \d IS NULL OR/g,
      ) ?? [],
    ).toHaveLength(45);
    expect(migration).toContain('FOREIGN KEY ("pinnedPostId")');
    expect(migration).toContain("ON DELETE SET NULL");
    expect(migration).toContain("NOT VALID");
    expect(migration).not.toMatch(/CREATE\s+(?:TABLE|SCHEMA|FUNCTION)/i);
  });
});
