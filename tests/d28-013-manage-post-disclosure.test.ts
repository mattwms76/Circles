import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createD28013ManagePostDisclosure,
  isCurrentD28013ManagePostDisclosure,
} from "../lib/d28-013-manage-post-disclosure";

describe("D28-013 Manage post disclosure", () => {
  it("expands only the selected valid post in its captured account and Circle scope", () => {
    const disclosure = createD28013ManagePostDisclosure("7:circle:42", 91);

    expect(disclosure).toEqual({ scope: "7:circle:42", postId: 91 });
    expect(
      isCurrentD28013ManagePostDisclosure({
        disclosure,
        currentScope: "7:circle:42",
        postId: 91,
        canManage: true,
      }),
    ).toBe(true);
  });

  it("fails closed for invalid IDs, a changed account or Circle, another post, or lost moderation authority", () => {
    const disclosure = createD28013ManagePostDisclosure("7:circle:42", 91);

    expect(createD28013ManagePostDisclosure(null, 91)).toBeNull();
    expect(createD28013ManagePostDisclosure("7:circle:42", 0)).toBeNull();
    expect(
      isCurrentD28013ManagePostDisclosure({
        disclosure,
        currentScope: "8:circle:42",
        postId: 91,
        canManage: true,
      }),
    ).toBe(false);
    expect(
      isCurrentD28013ManagePostDisclosure({
        disclosure,
        currentScope: "7:circle:43",
        postId: 91,
        canManage: true,
      }),
    ).toBe(false);
    expect(
      isCurrentD28013ManagePostDisclosure({
        disclosure,
        currentScope: "7:circle:42",
        postId: 92,
        canManage: true,
      }),
    ).toBe(false);
    expect(
      isCurrentD28013ManagePostDisclosure({
        disclosure,
        currentScope: "7:circle:42",
        postId: 91,
        canManage: false,
      }),
    ).toBe(false);
  });

  it("wires a named compact-to-full review control before the unchanged target-scoped removal action", () => {
    const source = readFileSync(
      new URL("../app/circle/[id].tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('from "@/lib/d28-013-manage-post-disclosure"');
    expect(source).toContain("createD28013ManagePostDisclosure(");
    expect(source).toContain("isCurrentD28013ManagePostDisclosure({");
    expect(source).toContain("disclosure: expandedManagePostDisclosure");
    expect(source).toContain("currentScope: circleActionScope");
    expect(source).toContain("canManage: canManageCircleContents");
    expect(source).toContain("isManagePostExpanded");
    expect(source).toContain('"Read full moment"');
    expect(source).toContain('"Show less"');
    expect(source).toContain("isManagePostExpanded ? undefined : 2");
    expect(source).toContain(
      "disabled={!!pendingAction || !canManageCircleContents}",
    );
  });
});
