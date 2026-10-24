import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { TrpcContext } from "../server/_core/context";
import {
  moderationActions,
  moderationCases,
} from "../drizzle/moderation-schema";

const serviceMocks = vi.hoisted(() => ({
  listModerationCases: vi.fn(),
  getModerationCaseDetail: vi.fn(),
  resolveModerationCase: vi.fn(),
}));
vi.mock("../server/moderation-service", () => serviceMocks);

const {
  moderationDetailInput,
  moderationListInput,
  moderationResolveInput,
  moderationRouter,
} = await import("../server/moderation-router");

function context(id = 71): TrpcContext {
  const now = new Date("2026-10-23T12:00:00.000Z");
  return {
    user: {
      id,
      openId: `synthetic-${id}`,
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

describe("moderation router authority and strict contract", () => {
  it("rejects an account-scope mismatch before calling a service", async () => {
    const caller = moderationRouter.createCaller(context(71));
    await expect(
      caller.list({ circleId: 8, viewerScope: 72, filter: "open" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller.detail({ circleId: 8, viewerScope: 72, caseId: 3 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller.resolve({
        circleId: 8,
        viewerScope: 72,
        caseId: 3,
        decision: "keep",
        note: "",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(serviceMocks.listModerationCases).not.toHaveBeenCalled();
    expect(serviceMocks.getModerationCaseDetail).not.toHaveBeenCalled();
    expect(serviceMocks.resolveModerationCase).not.toHaveBeenCalled();
  });

  it("accepts only the requested strict payloads and uses code-point note bounds", () => {
    expect(
      moderationListInput.safeParse({
        circleId: 8,
        viewerScope: 71,
        filter: "open",
        cursor: { id: 3 },
        limit: 50,
      }).success,
    ).toBe(true);
    expect(
      moderationListInput.safeParse({
        circleId: 8,
        viewerScope: 71,
        filter: "open",
        reporterId: 99,
      }).success,
    ).toBe(false);
    expect(
      moderationDetailInput.safeParse({
        circleId: 8,
        viewerScope: 71,
        caseId: 3,
        userId: 99,
      }).success,
    ).toBe(false);

    const astral = "😀";
    expect(
      moderationResolveInput.parse({
        circleId: 8,
        viewerScope: 71,
        caseId: 3,
        decision: "remove",
        note: `  ${astral.repeat(500)}  `,
      }).note,
    ).toBe(astral.repeat(500));
    expect(
      moderationResolveInput.safeParse({
        circleId: 8,
        viewerScope: 71,
        caseId: 3,
        decision: "remove",
        note: astral.repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe("moderation private storage contract", () => {
  it("declares only aggregate/minimal case and action columns in the required order", () => {
    expect(
      getTableConfig(moderationCases).columns.map((column) => column.name),
    ).toEqual([
      "id",
      "circleId",
      "postId",
      "sourcePostId",
      "subjectUserId",
      "status",
      "reportCount",
      "reasons",
      "createdAt",
      "lastReportedAt",
      "resolvedAt",
    ]);
    expect(
      getTableConfig(moderationActions).columns.map((column) => column.name),
    ).toEqual(["id", "caseId", "reviewerId", "decision", "note", "createdAt"]);
  });

  it("keeps the migration backend-only, idempotently maps eligible circle reports, and avoids routine exposure", () => {
    const migration = readFileSync(
      resolve(
        import.meta.dirname,
        "../operations/migrations/0012_circles_moderation.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS circles_app."moderationCases"',
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS circles_app."moderationActions"',
    );
    expect(migration).toContain(
      '"postId" integer REFERENCES circles_app.posts(id) ON DELETE SET NULL',
    );
    expect(migration).toContain(
      '"subjectUserId" integer REFERENCES circles_app.users(id) ON DELETE SET NULL',
    );
    expect(migration).toContain(
      '"reviewerId" integer REFERENCES circles_app.users(id) ON DELETE SET NULL',
    );
    expect(migration).toContain(
      'ON CONFLICT ("circleId", "sourcePostId") DO UPDATE',
    );
    expect(migration).toContain("runtime_moderation_cases_policy");
    expect(migration).toContain("runtime_moderation_actions_policy");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain(
      "FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain("FILTER (WHERE position <= 20)");
    expect(migration).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
    expect(migration).not.toMatch(/GRANT\s+EXECUTE/i);
  });
});
