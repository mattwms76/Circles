import {
  isCurrentBatch3AccountResourceOperation,
  type Batch3AccountResourceOperation,
} from "./batch3-account-resource-scope";
import {
  resolveFnd001QueryDisplayState,
  type Fnd001QueryDisplayState,
} from "./fnd001-query-display-state";

export type CircleManageAction =
  | "approve-member"
  | "remove-member"
  | "set-member-role"
  | "delete-post";

export type CircleManageTargetKind = "member" | "post";

type CircleMemberDisplayItem = { role: string };

export type CircleManagePendingAction = {
  action: CircleManageAction;
  operation: Batch3AccountResourceOperation;
  target: string;
};

/** A stable target key lets one person’s conflicting actions share a flight. */
export function circleManageActionTarget(
  kind: CircleManageTargetKind,
  id: number,
): string | null {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return `${kind}:${id}`;
}

/**
 * Members intentionally hides pending requests, while Manage retains them for
 * an authorized decision. Their successful-empty states must remain distinct.
 */
export function resolveCircleMemberDisplayStates({
  members,
  isError,
  isLoading,
  hasNextPage,
}: {
  members: readonly CircleMemberDisplayItem[];
  isError: boolean;
  isLoading: boolean;
  hasNextPage: boolean;
}): {
  manageMembersDisplayState: Fnd001QueryDisplayState;
  membersDisplayState: Fnd001QueryDisplayState;
} {
  return {
    membersDisplayState: resolveFnd001QueryDisplayState({
      isLoading,
      isError,
      hasContent:
        members.some((member) => member.role !== "pending") || hasNextPage,
    }),
    manageMembersDisplayState: resolveFnd001QueryDisplayState({
      isLoading,
      isError,
      hasContent: members.length > 0 || hasNextPage,
    }),
  };
}

function circleManageActionKey(action: CircleManagePendingAction): string {
  return `${action.operation.scope}:${action.operation.generation}:${action.target}`;
}

/**
 * Synchronously reserves one member or post target for the current mounted
 * account/circle operation. Separate targets may settle independently.
 */
export function createCircleManageActionSingleFlight() {
  const activeTargets = new Set<string>();

  return {
    start(action: CircleManagePendingAction): boolean {
      const key = circleManageActionKey(action);
      if (activeTargets.has(key)) return false;
      activeTargets.add(key);
      return true;
    },
    finish(action: CircleManagePendingAction): void {
      activeTargets.delete(circleManageActionKey(action));
    },
  };
}

/** Returns a pending action only when it still belongs to this exact UI instance. */
export function getCurrentCircleManagePendingAction(
  actions: readonly CircleManagePendingAction[],
  currentOperation: Batch3AccountResourceOperation | null,
  target: string | null,
): CircleManagePendingAction | undefined {
  if (!target) return undefined;
  return actions.find(
    (action) =>
      action.target === target &&
      isCurrentBatch3AccountResourceOperation(
        currentOperation,
        action.operation,
      ),
  );
}
