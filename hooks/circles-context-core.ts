import { createContext, useContext } from "react";
import type { AuthGateState } from "@/lib/feed-ui-helpers";
import type { StatusTone } from "@/lib/status-announcement";

export type NativeLoginCompletionResult = {
  authenticated: boolean;
  cleanup: {
    localCleanupFailed: boolean;
    remoteRevocationFailed: boolean;
  } | null;
};

export type CirclesState = {
  user: { id: number; name: string | null } | null;
  authLoading: boolean;
  authState: AuthGateState;
  requireAuth: (action?: () => void) => boolean;
  notify: (message: string, tone?: StatusTone) => void;
  refresh: () => void;
  showLogin: () => void;
  logout: () => Promise<void>;
  completeNativeLogin: () => Promise<boolean>;
  completeNativeLoginWithResult: () => Promise<NativeLoginCompletionResult>;
};

export const CirclesContext = createContext<CirclesState | null>(null);

export function useCircles() {
  const state = useContext(CirclesContext);
  if (!state) throw new Error("CirclesProvider missing");
  return state;
}
