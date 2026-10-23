import { useEffect } from "react";
import { usePathname, useRootNavigationState, useRouter } from "expo-router";
import { useCircles } from "@/hooks/circles-context-core";
import { trpc } from "@/lib/trpc";

/** Only the settled home route offers first-run onboarding; never hijack a deep link. */
export function OnboardingNavigation() {
  const { user, authState } = useCircles();
  const pathname = usePathname();
  const navigation = useRootNavigationState();
  const router = useRouter();
  const enabled = authState === "authenticated" && !!user && pathname === "/";
  const status = trpc.onboarding.status.useQuery(undefined, {
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  useEffect(() => {
    if (
      !navigation?.key ||
      !enabled ||
      status.isFetching ||
      status.isError ||
      !status.isFetchedAfterMount ||
      !status.data ||
      status.data.userId !== user?.id ||
      status.data.completedAt !== null
    )
      return;
    router.replace("/onboarding");
  }, [
    enabled,
    navigation?.key,
    router,
    status.data,
    status.isError,
    status.isFetchedAfterMount,
    status.isFetching,
    user?.id,
  ]);
  return null;
}
