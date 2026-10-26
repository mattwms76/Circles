export function batch3AccountResourceScope(
  accountId: number | null | undefined,
  resource: string,
): string | null {
  if (
    typeof accountId !== "number" ||
    !Number.isSafeInteger(accountId) ||
    accountId < 1 ||
    !resource
  ) {
    return null;
  }
  return `${accountId}:${resource}`;
}

export type Batch3AccountResourceOperation = {
  scope: string;
  generation: number;
};

function batch3OperationKey(operation: Batch3AccountResourceOperation): string {
  return `${operation.scope}:${operation.generation}`;
}

/**
 * Synchronously admits one desired-state action for an account/resource
 * instance. A ref-owned guard prevents back-to-back presses before disabled
 * controls receive their next render.
 */
export function createBatch3AccountResourceSingleFlight() {
  const activeOperationKeys = new Set<string>();

  return {
    start(operation: Batch3AccountResourceOperation): boolean {
      const operationKey = batch3OperationKey(operation);
      if (activeOperationKeys.has(operationKey)) return false;
      activeOperationKeys.add(operationKey);
      return true;
    },
    finish(operation: Batch3AccountResourceOperation): void {
      activeOperationKeys.delete(batch3OperationKey(operation));
    },
  };
}

/**
 * Completions are valid only for the exact mounted account/resource instance.
 * The generation rejects an A → B → A return to an earlier scope string.
 */
export function isCurrentBatch3AccountResourceOperation(
  current: Batch3AccountResourceOperation | null,
  completed: Batch3AccountResourceOperation,
): boolean {
  return (
    current !== null &&
    current.scope === completed.scope &&
    current.generation === completed.generation
  );
}

export function isCurrentBatch3AccountResourceScope(
  capturedScope: string | null,
  currentScope: string | null,
  mountedScope: string | null,
): boolean {
  return (
    capturedScope !== null &&
    capturedScope === currentScope &&
    capturedScope === mountedScope
  );
}
