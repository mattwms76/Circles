import { useEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import { useCircles } from "@/hooks/circles-context";
import {
  createSourceRevalidationController,
  SourceRevalidationController,
} from "@/lib/source-query-invalidation";

function isForegroundAppState(status: string | null): boolean {
  return status === "active";
}

function readWebForeground(): boolean {
  if (typeof document === "undefined") return true;
  return (
    document.visibilityState !== "hidden" &&
    (typeof document.hasFocus !== "function" || document.hasFocus())
  );
}

function useForegroundState(): boolean {
  const [nativeForeground, setNativeForeground] = useState(() =>
    isForegroundAppState(AppState.currentState),
  );
  const [webForeground, setWebForeground] = useState(readWebForeground);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      setNativeForeground(isForegroundAppState(nextState));
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const syncForeground = () => setWebForeground(readWebForeground());
    document.addEventListener("visibilitychange", syncForeground);
    window.addEventListener("focus", syncForeground);
    window.addEventListener("blur", syncForeground);
    syncForeground();
    return () => {
      document.removeEventListener("visibilitychange", syncForeground);
      window.removeEventListener("focus", syncForeground);
      window.removeEventListener("blur", syncForeground);
    };
  }, []);

  return Platform.OS === "web" ? webForeground : nativeForeground;
}

function safeAccountId(user: { id: number } | null): number | null {
  const id = user?.id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : null;
}

/**
 * Mount once inside CirclesProvider and QueryClientProvider. It deliberately
 * invalidates only current, route-relevant normal-app source keys through the
 * shared predicate; query observers retain their own error and retry UI.
 */
export function SourceRevalidation(): null {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { user } = useCircles();
  const accountId = safeAccountId(user);
  const foreground = useForegroundState();
  const controllerRef = useRef<SourceRevalidationController | null>(null);

  useEffect(() => {
    const controller = createSourceRevalidationController({
      queryClient,
      pathname,
      accountId,
    });
    controllerRef.current = controller;
    controller.setForeground(foreground);
    if (foreground) void controller.refresh();

    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [accountId, foreground, pathname, queryClient]);

  return null;
}
