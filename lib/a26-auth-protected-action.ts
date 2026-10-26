import type { AuthGateState } from "./feed-ui-helpers";

export type ProtectedActionResolution =
  | { kind: "run" }
  | { kind: "checking"; message: string }
  | { kind: "authError"; message: string }
  | { kind: "guest" };

/**
 * A callback captured while identity is unknown can contain an old account or
 * resource scope. Do not queue it for automatic replay: callers retain the
 * semantic target in their current keyed instance and the person explicitly
 * re-taps after the identity check settles.
 */
export function resolveProtectedActionRequest(
  authState: AuthGateState,
): ProtectedActionResolution {
  switch (authState) {
    case "authenticated":
      return { kind: "run" };
    case "checking":
      return {
        kind: "checking",
        message:
          "We’re checking your sign-in. Please try that again when it finishes.",
      };
    case "error":
      return {
        kind: "authError",
        message:
          "We couldn’t confirm your sign-in. Check your connection and try again.",
      };
    default:
      return { kind: "guest" };
  }
}
