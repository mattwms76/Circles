export type Batch1OperationIdentity = {
  accountId: number | null;
  resourceId: string;
  /**
   * Stable for one rendered account/resource identity, but different after an
   * account/resource keyed remount or a caller-declared resource revision.
   */
  identityKey: string;
};

export type Batch1OperationScope = Batch1OperationIdentity & {
  /** Monotonically allocated for each effect setup that activates an identity. */
  instanceId: number;
};

let nextBatch1MountId = 0;
let nextBatch1ActivationId = 0;

/**
 * Tracks an account/resource identity outside render. Components activate it
 * from effect setup, capture the returned scope in an event handler, and only
 * perform completion work while that exact activation is still current.
 */
export function createBatch1OperationInstance() {
  const mountId = ++nextBatch1MountId;
  let currentScope: Batch1OperationScope | null = null;
  const isCurrent = (scope: Batch1OperationScope): boolean =>
    currentScope !== null &&
    batch1OperationScopeMatches(
      scope,
      currentScope.accountId,
      currentScope.resourceId,
      currentScope.instanceId,
    ) &&
    currentScope.identityKey === scope.identityKey;

  return {
    createIdentity(
      accountId: number | null,
      resourceId: string,
      revision = 0,
    ): Batch1OperationIdentity {
      return {
        accountId,
        resourceId,
        identityKey: `${mountId}:${revision}`,
      };
    },
    activate(identity: Batch1OperationIdentity): Batch1OperationScope | null {
      if (identity.accountId === null) {
        currentScope = null;
        return null;
      }

      currentScope = {
        ...identity,
        instanceId: ++nextBatch1ActivationId,
      };
      return currentScope;
    },
    deactivate(scope: Batch1OperationScope | null): void {
      if (scope && isCurrent(scope)) currentScope = null;
    },
    isCurrent,
  };
}

/**
 * A scope is captured when the user starts an operation. Completion work must
 * only affect the exact authenticated account, visible resource, and effect
 * activation that started it.
 */
export function batch1OperationScopeMatches(
  scope: Batch1OperationScope,
  accountId: number | null | undefined,
  resourceId: string | null | undefined,
  instanceId: number | null | undefined,
): boolean {
  return (
    scope.accountId === accountId &&
    scope.resourceId === resourceId &&
    scope.instanceId === instanceId
  );
}

/**
 * Render-only feedback is derived from immutable identity data, not refs.
 * The activation id intentionally is not needed here: a keyed remount or
 * revision creates a new identity key, while completion checks use the full
 * activation scope above.
 */
export function batch1OperationIdentityMatches(
  scope: Batch1OperationScope,
  identity: Batch1OperationIdentity,
): boolean {
  return (
    scope.accountId === identity.accountId &&
    scope.resourceId === identity.resourceId &&
    scope.identityKey === identity.identityKey
  );
}

export function batch1OperationKey(scope: Batch1OperationScope): string {
  return `${scope.accountId}\u0000${scope.resourceId}\u0000${scope.identityKey}\u0000${scope.instanceId}`;
}

/**
 * Blocks a duplicate press synchronously, before React can render a disabled
 * control. Different operation activations remain independently scoped.
 */
export function createBatch1OperationGuard() {
  const activeOperations = new Map<string, Batch1OperationScope>();

  return {
    isActive(scope: Batch1OperationScope): boolean {
      return activeOperations.has(batch1OperationKey(scope));
    },
    isActiveForAccount(accountId: number | null | undefined): boolean {
      return Array.from(activeOperations.values()).some(
        (scope) => scope.accountId === accountId,
      );
    },
    async run<T>(
      scope: Batch1OperationScope,
      operation: () => Promise<T>,
    ): Promise<{ started: boolean; value?: T }> {
      const key = batch1OperationKey(scope);
      if (activeOperations.has(key)) return { started: false };

      activeOperations.set(key, scope);
      try {
        return { started: true, value: await operation() };
      } finally {
        activeOperations.delete(key);
      }
    },
  };
}
