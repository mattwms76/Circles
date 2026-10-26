export type CreateRecipientCircle = Readonly<{
  id: number;
  name: string;
  joined?: boolean;
}>;

export type CreateRecipientState =
  | Readonly<{ kind: "everyone" }>
  | Readonly<{ kind: "resolving"; circleId: number }>
  | Readonly<{ kind: "selected"; circleId: number; name: string }>
  | Readonly<{ kind: "error"; circleId: number }>
  | Readonly<{ kind: "unavailable"; circleId: number }>;

type ResolveCreateRecipientInput = Readonly<{
  circleId: number | undefined;
  circles: readonly CreateRecipientCircle[] | undefined;
  isResolving: boolean;
  isError: boolean;
}>;

/**
 * Keeps a retained deep-link recipient explicit until the viewer's circle list
 * proves that it is an approved destination. A missing or failed lookup never
 * falls back to Everyone because that would change the requested audience.
 */
export function resolveCreateRecipient({
  circleId,
  circles,
  isResolving,
  isError,
}: ResolveCreateRecipientInput): CreateRecipientState {
  if (!circleId) return { kind: "everyone" };

  const matchingCircle = circles?.find((circle) => circle.id === circleId);
  if (matchingCircle?.joined) {
    return {
      kind: "selected",
      circleId,
      name: matchingCircle.name,
    };
  }

  if (isResolving) return { kind: "resolving", circleId };
  if (isError) return { kind: "error", circleId };
  return { kind: "unavailable", circleId };
}

/** Only a known approved circle or intentional Everyone selection may publish. */
export function canPublishToCreateRecipient(
  recipient: CreateRecipientState,
): boolean {
  return recipient.kind === "everyone" || recipient.kind === "selected";
}

export function canRetryCreateRecipient(
  recipient: CreateRecipientState,
): boolean {
  return recipient.kind === "error";
}

type CreateRootInsets = Readonly<{
  top: number;
  left: number;
  right: number;
}>;

/** Root ownership ensures the header and scroll content do not add insets twice. */
export function createRootSafeAreaInsets({
  top,
  left,
  right,
}: CreateRootInsets): Readonly<{
  paddingTop: number;
  paddingLeft: number;
  paddingRight: number;
}> {
  return {
    paddingTop: top,
    paddingLeft: left,
    paddingRight: right,
  };
}
