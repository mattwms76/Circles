const liveOperationScopeInstance: unique symbol = Symbol(
  "live-operation-scope-instance",
);

export type LiveOperationScope = Readonly<{
  accountId: number | null;
  routeId: string;
  generation: number;
  /** This private token makes an otherwise equal account/route scope distinct. */
  [liveOperationScopeInstance]: symbol;
}>;

export type LiveOperationScopeInput = Readonly<{
  accountId: number | null;
  routeId: string;
  generation: number;
}>;

/**
 * Captures one committed live-route lifecycle. Account and route values make the
 * source inspectable, while the private token and object identity make the
 * generation opaque: A → B → A never revives the first A instance.
 */
export function createLiveOperationScope({
  accountId,
  routeId,
  generation,
}: LiveOperationScopeInput): LiveOperationScope {
  const scope: LiveOperationScope = {
    accountId,
    routeId,
    generation,
    [liveOperationScopeInstance]: Symbol("live-operation-scope"),
  };
  return Object.freeze(scope);
}

/** Completion work belongs only to the exact mounted lifecycle that started it. */
export function isCurrentLiveOperationScope(
  capturedScope: LiveOperationScope | null,
  currentScope: LiveOperationScope | null,
): boolean {
  return capturedScope !== null && capturedScope === currentScope;
}
