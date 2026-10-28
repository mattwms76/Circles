import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { activityInternals, listActivity } from "../server/activity-service";
import { socialRouter } from "../server/social-router";
import { getCircleHome, listMembersPage } from "../server/social-service";
import { activityItems } from "../drizzle/activity-schema";
import { circles, follows, memberships, profiles } from "../drizzle/schema";

const dbMocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: dbMocks.getDb }));

function thenableRows<T>(
  rows: T[],
  onFor?: (mode: string) => void,
): {
  for: (mode: string) => Promise<T[]>;
  then: <Output>(
    resolve: (value: T[]) => Output | PromiseLike<Output>,
    reject?: (reason: unknown) => Output | PromiseLike<Output>,
  ) => Promise<Output>;
} {
  return {
    for: async (mode) => {
      onFor?.(mode);
      return rows;
    },
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };
}

function privateHomeRevocationFixture() {
  let role: "member" | null = "member";
  const sharedLocks: string[] = [];
  const circle = {
    id: 1,
    privacy: "private" as const,
    welcomeMessage: "Private welcome",
    rules: ["Private rule"],
    pinnedPostId: null,
    updatedAt: new Date("2026-10-27T08:00:00.000Z"),
  };
  const db: any = {};
  db.transaction = async <Value>(callback: (tx: typeof db) => Promise<Value>) =>
    callback(db);
  db.select = (_selection?: Record<string, unknown>) => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: () => {
          if (table === circles) {
            return thenableRows([circle], (mode) => {
              sharedLocks.push(mode);
              // Models removal winning immediately after the reader acquires the shared lock.
              role = null;
            });
          }
          if (table === memberships)
            return thenableRows(role ? [{ role }] : []);
          throw new Error("Unexpected private-home fixture query");
        },
      }),
    }),
  });
  return { db, sharedLocks };
}

function memberCursorFixture() {
  const createdAt = new Date("2026-10-27T08:00:00.123Z");
  const exact = "2026-10-27T08:00:00.123456Z";
  const pageRows = [
    {
      id: 101,
      userId: 9,
      role: "member",
      createdAt,
      preciseCreatedAt: exact,
    },
    {
      id: 102,
      userId: 10,
      role: "member",
      createdAt,
      preciseCreatedAt: exact,
    },
  ];
  const db: any = {};
  db.transaction = async <Value>(callback: (tx: typeof db) => Promise<Value>) =>
    callback(db);
  db.select = (selection?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      if (table === circles) {
        return {
          where: () => ({
            limit: () => thenableRows([{ id: 1, privacy: "public" as const }]),
          }),
        };
      }
      if (table === memberships) {
        if (selection && "role" in selection && !("id" in selection)) {
          return { where: () => ({ limit: () => thenableRows([]) }) };
        }
        return {
          where: () => ({
            orderBy: () => ({ limit: () => thenableRows(pageRows) }),
          }),
        };
      }
      if (table === profiles) {
        return {
          where: () => ({
            limit: () =>
              thenableRows([
                {
                  userId: 9,
                  name: "Member nine",
                  handle: "member-nine",
                  bio: "",
                  avatar: "",
                  cover: null,
                },
              ]),
          }),
        };
      }
      if (table === follows) {
        return {
          where: () => thenableRows([{ total: 0 }]),
        };
      }
      throw new Error("Unexpected member-page fixture query");
    },
  });
  return { createdAt, db, exact };
}

function activityRevocationFixture() {
  let role: "member" | null = "member";
  const sharedLocks: string[] = [];
  const item = {
    id: 15,
    recipientId: 7,
    actorId: 9,
    kind: "membership_approved",
    sourceId: 51,
    circleId: 3,
    postId: null,
    createdAt: new Date("2026-10-27T08:00:00.000Z"),
    readAt: null,
  };
  const db: any = {};
  db.transaction = async <Value>(callback: (tx: typeof db) => Promise<Value>) =>
    callback(db);
  db.select = (_selection?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      if (table === activityItems) {
        return {
          where: () => ({
            orderBy: () => ({ limit: () => thenableRows([item]) }),
          }),
        };
      }
      if (table === circles) {
        return {
          where: () => ({
            limit: () =>
              thenableRows([{ name: "Private circle" }], (mode) => {
                sharedLocks.push(mode);
                role = null;
              }),
          }),
        };
      }
      if (table === memberships) {
        return {
          where: () => ({ limit: () => thenableRows(role ? [{ role }] : []) }),
        };
      }
      throw new Error("Unexpected activity fixture query");
    },
  });
  return { db, sharedLocks };
}

describe("parity27 private-read serialization", () => {
  it("does not project private Circle Home after a revocation that commits at the shared lock boundary", async () => {
    const fixture = privateHomeRevocationFixture();
    dbMocks.getDb.mockResolvedValue(fixture.db);

    await expect(getCircleHome(7, 1)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.sharedLocks).toEqual(["share"]);
  });

  it("maps an Activity item as unavailable rather than exposing private circle or actor metadata after revocation", async () => {
    const fixture = activityRevocationFixture();
    dbMocks.getDb.mockResolvedValue(fixture.db);

    await expect(listActivity(7, { limit: 1 })).resolves.toMatchObject({
      viewerId: 7,
      items: [
        {
          id: 15,
          available: false,
          actorName: null,
          circleName: null,
        },
      ],
    });
    expect(fixture.sharedLocks).toEqual(["share"]);
  });

  it("round-trips a six-digit member continuation and rejects a mismatched exact timestamp before datastore access", async () => {
    const fixture = memberCursorFixture();
    dbMocks.getDb.mockResolvedValue(fixture.db);

    const page = await listMembersPage(null, 1, { limit: 1 });
    expect(page.nextCursor).toEqual({
      createdAt: fixture.createdAt,
      id: 101,
      createdAtExact: fixture.exact,
    });

    dbMocks.getDb.mockClear();
    const caller = socialRouter.createCaller({
      user: null,
      req: {} as never,
      res: {} as never,
    });
    await expect(
      caller.membersPage({
        circleId: 1,
        limit: 1,
        cursor: {
          createdAt: "2026-10-27T08:00:00.123Z",
          createdAtExact: "2026-10-27T08:00:00.124456Z",
          id: 101,
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbMocks.getDb).not.toHaveBeenCalled();
  });

  it("keeps every named private DTO mapper behind a parent-lock projection helper", () => {
    const social = readFileSync("server/social-service.ts", "utf8");
    const activity = readFileSync("server/activity-service.ts", "utf8");
    for (const name of ["feed", "feedPage", "listComments"]) {
      const start = social.indexOf(`export async function ${name}`);
      const end = social.indexOf("\nexport ", start + 1);
      expect(social.slice(start, end === -1 ? undefined : end)).toContain(
        name.startsWith("feed")
          ? "postOutputForProtectedRead"
          : "assertPostAccessForProtectedRead",
      );
    }
    expect(social).toContain("lockCircleForProtectedRead");
    expect(activity).toContain("lockMemberCircleForReadOrNull");
    expect(activityInternals.activityDisplayName("  public label  ")).toBe(
      "public label",
    );
  });
});
