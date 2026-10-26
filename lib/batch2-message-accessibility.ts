export type MessageCompositionOperation = {
  scope: string;
  generation: number;
};

function messageCompositionOperationKey(
  operation: MessageCompositionOperation,
): string {
  return `${operation.scope}:${operation.generation}`;
}

/**
 * Synchronously admits one send for a composition instance. Its holder belongs
 * in a ref so a second native press cannot slip in before React disables UI.
 */
export function createMessageCompositionSingleFlight() {
  let activeOperationKey: string | null = null;

  return {
    get isActive(): boolean {
      return activeOperationKey !== null;
    },
    start(operation: MessageCompositionOperation): boolean {
      if (activeOperationKey !== null) return false;
      activeOperationKey = messageCompositionOperationKey(operation);
      return true;
    },
    finish(operation: MessageCompositionOperation): void {
      const operationKey = messageCompositionOperationKey(operation);
      if (activeOperationKey === operationKey) activeOperationKey = null;
    },
  };
}

function normalizedUnreadCount(unread: number): number {
  return Number.isSafeInteger(unread) && unread > 0 ? unread : 0;
}

/**
 * Keeps a conversation's available name and unread count together in the
 * programmatic description without inventing a preview for empty threads.
 */
export function conversationAccessibility(
  name: string,
  unread: number,
): {
  label: string;
  value: string;
} {
  const displayName = name.trim() || "conversation";
  const unreadCount = normalizedUnreadCount(unread);
  const value =
    unreadCount === 0
      ? "No unread messages"
      : `${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}`;
  return {
    label: `Open conversation with ${displayName}`,
    value,
  };
}

/** Whitespace alone is not a message; an explicitly selected attachment is. */
export function canSendMessage(text: string, hasAttachment: boolean): boolean {
  return hasAttachment || text.trim().length > 0;
}

/**
 * Completion handlers must only affect the exact account/conversation
 * operation that began the work. A generation prevents an old completion from
 * affecting an account that briefly changed and then changed back.
 */
export function isCurrentMessageCompositionOperation(
  current: MessageCompositionOperation | null,
  completed: MessageCompositionOperation,
): boolean {
  return (
    current !== null &&
    current.scope === completed.scope &&
    current.generation === completed.generation
  );
}
