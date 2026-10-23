import { createContext, useContext } from "react";
import type { AuthGateState } from "@/lib/feed-ui-helpers";

export type CirclesState = {
  user: { id: number; name: string | null } | null;
  authLoading: boolean;
  authState: AuthGateState;
  requireAuth: (action?: () => void) => boolean;
  notify: (message: string) => void;
  refresh: () => void;
  showLogin: () => void;
  logout: () => Promise<void>;
  completeNativeLogin: () => Promise<boolean>;
};

export const CirclesContext = createContext<CirclesState | null>(null);

export function useCircles() {
  const state = useContext(CirclesContext);
  if (!state) throw new Error("CirclesProvider missing");
  return state;
}
