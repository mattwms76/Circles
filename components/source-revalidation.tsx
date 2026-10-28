import { useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCircles } from "@/hooks/circles-context";
import { useForegroundState } from "@/hooks/use-foreground-state";
import {
  createSourceRevalidationController,
  SourceRevalidationController,
} from "@/lib/source-query-invalidation";

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
