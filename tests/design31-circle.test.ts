import { describe, expect, it } from "vitest";
import {
  circleManageActionTarget,
  createCircleManageActionSingleFlight,
  getCurrentCircleManagePendingAction,
  resolveCircleMemberDisplayStates,
  type CircleManagePendingAction,
} from "../lib/design31-circle";

const currentOperation = { scope: "7:circle:42", generation: 3 };

function pendingAction(
  action: CircleManagePendingAction["action"],
  target: string,
): CircleManagePendingAction {
  return { action, operation: currentOperation, target };
}

describe("D26-22 Circle list states", () => {
  it("keeps initial loading, retryable error, settled empty, and content distinct", () => {
    expect(
      resolveCircleMemberDisplayStates({
        members: [],
        isLoading: true,
        isError: false,
        hasNextPage: false,
      }),
    ).toEqual({
      membersDisplayState: "loading",
      manageMembersDisplayState: "loading",
    });
    expect(
      resolveCircleMemberDisplayStates({
        members: [],
        isLoading: false,
        isError: true,
        hasNextPage: false,
      }),
    ).toEqual({
      membersDisplayState: "error",
      manageMembersDisplayState: "error",
    });
    expect(
      resolveCircleMemberDisplayStates({
        members: [],
        isLoading: false,
        isError: false,
        hasNextPage: false,
      }),
    ).toEqual({
      membersDisplayState: "empty",
      manageMembersDisplayState: "empty",
    });
  });

  it("keeps pending requests actionable in Manage without presenting an empty Members tab as content", () => {
    expect(
      resolveCircleMemberDisplayStates({
        members: [{ role: "pending" }],
        isLoading: false,
        isError: false,
        hasNextPage: false,
      }),
    ).toEqual({
      membersDisplayState: "empty",
      manageMembersDisplayState: "content",
    });
    expect(
      resolveCircleMemberDisplayStates({
        members: [{ role: "member" }],
        isLoading: false,
        isError: false,
        hasNextPage: false,
      }),
    ).toEqual({
      membersDisplayState: "content",
      manageMembersDisplayState: "content",
    });
  });
});

describe("D26-23 Circle management target guards", () => {
  it("blocks conflicting synchronous operations for one member while permitting another target", () => {
    const flight = createCircleManageActionSingleFlight();
    const aria = pendingAction("set-member-role", "member:13");
    const ariaRemoval = pendingAction("remove-member", "member:13");
    const ben = pendingAction("approve-member", "member:14");

    expect(flight.start(aria)).toBe(true);
    expect(flight.start(ariaRemoval)).toBe(false);
    expect(flight.start(ben)).toBe(true);

    flight.finish(aria);
    expect(flight.start(ariaRemoval)).toBe(true);
  });

  it("keeps pending affordances scoped to the exact account, circle, generation, and valid target", () => {
    const pending = [pendingAction("delete-post", "post:91")];

    expect(circleManageActionTarget("member", 13)).toBe("member:13");
    expect(circleManageActionTarget("post", 91)).toBe("post:91");
    expect(circleManageActionTarget("post", 0)).toBeNull();

    expect(
      getCurrentCircleManagePendingAction(pending, currentOperation, "post:91")
        ?.action,
    ).toBe("delete-post");
    expect(
      getCurrentCircleManagePendingAction(
        pending,
        { scope: "8:circle:42", generation: 3 },
        "post:91",
      ),
    ).toBeUndefined();
    expect(
      getCurrentCircleManagePendingAction(
        pending,
        { scope: "7:circle:42", generation: 4 },
        "post:91",
      ),
    ).toBeUndefined();
    expect(
      getCurrentCircleManagePendingAction(
        pending,
        currentOperation,
        "member:13",
      ),
    ).toBeUndefined();
  });
});
