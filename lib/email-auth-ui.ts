import type { EmailAuthStatus } from "@/lib/email-auth-client";

export type EmailAuthDialogMode = "signIn" | "connect";

export type EmailAuthAsyncScope = {
  instanceId: number;
  mode: EmailAuthDialogMode;
  sequence: number;
};

export type EmailAuthAvailability =
  | "loading"
  | "retry"
  | "notReady"
  | "disabled"
  | "available";

/**
 * Each guard is local to one rendered dialog instance. A completion can update
 * UI only while its exact mode and sequence remain current; this rejects late
 * work after a close, strict-mode cleanup, or an A→B→A mode transition.
 */
export function createEmailAuthAsyncGuard(instanceId: number) {
  let active = false;
  let sequence = 0;
  let latest: EmailAuthAsyncScope | null = null;

  return {
    activate() {
      active = true;
    },
    deactivate() {
      active = false;
      latest = null;
    },
    invalidate() {
      latest = null;
    },
    begin(mode: EmailAuthDialogMode): EmailAuthAsyncScope {
      const scope = { instanceId, mode, sequence: ++sequence };
      latest = scope;
      return scope;
    },
    isCurrent(scope: EmailAuthAsyncScope, mode: EmailAuthDialogMode): boolean {
      return (
        active &&
        scope.instanceId === instanceId &&
        scope.mode === mode &&
        latest?.sequence === scope.sequence
      );
    },
    clear(scope: EmailAuthAsyncScope) {
      if (latest?.sequence === scope.sequence) latest = null;
    },
  };
}

export function resolveEmailAuthAvailability({
  checking,
  status,
  failed,
}: {
  checking: boolean;
  status: EmailAuthStatus | null;
  failed: boolean;
}): EmailAuthAvailability {
  if (checking) return "loading";
  if (failed || !status) return "retry";
  if (!status.enabled || !status.emailEnabled) return "disabled";
  if (!status.ready) return "notReady";
  return "available";
}
