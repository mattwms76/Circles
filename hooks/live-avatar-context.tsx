import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCircles } from "@/hooks/circles-context";
import { useForegroundState } from "@/hooks/use-foreground-state";
import {
  boundedLiveAvatarUserIds,
  chunkLiveAvatarUserIds,
  isPositiveUserId,
  liveAvatarScopeKey,
  liveAvatarViewerScope,
  resolveLiveAvatarStatus,
  type LiveAvatarQueryResult,
} from "@/lib/live-avatar-status";
import { trpc } from "@/lib/trpc";

const LIVE_AVATAR_REFETCH_MS = 10_000;

type LiveAvatarContextValue = {
  isForeground: boolean;
  isLiveUser: (userId: number | null | undefined) => boolean;
  registerVisibleUserId: (userId: number | null | undefined) => () => void;
};

const noOp = () => undefined;
const defaultLiveAvatarContext: LiveAvatarContextValue = {
  isForeground: false,
  isLiveUser: () => false,
  registerVisibleUserId: () => noOp,
};

const LiveAvatarContext = createContext<LiveAvatarContextValue>(
  defaultLiveAvatarContext,
);

function LiveAvatarAccountProvider({
  children,
  viewerScope,
  queryAuthority,
}: {
  children: React.ReactNode;
  viewerScope: number | null;
  queryAuthority: boolean;
}) {
  const foreground = useForegroundState();
  const registrations = useRef(new Map<number, number>());
  const [registeredUserIds, setRegisteredUserIds] = useState<number[]>([]);
  const [clock, setClock] = useState(() => Date.now());

  const registerVisibleUserId = useCallback(
    (userId: number | null | undefined) => {
      if (!isPositiveUserId(userId)) return noOp;

      const count = registrations.current.get(userId) ?? 0;
      if (count === 0 && registrations.current.size >= 512) {
        // The current route-level collections are bounded below this ceiling.
        // Never silently add unbounded per-avatar network work if that changes.
        console.warn(
          "Live avatar status registration reached its 512-user safety limit.",
        );
        return noOp;
      }

      registrations.current.set(userId, count + 1);
      if (count === 0) {
        setRegisteredUserIds((current) =>
          current.includes(userId) ? current : [...current, userId],
        );
      }
      let released = false;

      return () => {
        if (released) return;
        released = true;
        const current = registrations.current.get(userId) ?? 0;
        if (current <= 1) {
          registrations.current.delete(userId);
          setRegisteredUserIds((ids) => ids.filter((id) => id !== userId));
          return;
        }
        registrations.current.set(userId, current - 1);
      };
    },
    [],
  );

  const boundedIds = useMemo(
    () => boundedLiveAvatarUserIds(registeredUserIds),
    [registeredUserIds],
  );
  const hostIdBatches = useMemo(
    () => chunkLiveAvatarUserIds(boundedIds.ids),
    [boundedIds.ids],
  );
  const requestEnabled =
    queryAuthority && foreground && hostIdBatches.length > 0;

  const queryResults = trpc.useQueries((queries) =>
    hostIdBatches.map((hostIds) =>
      queries.live.list(
        { hostIds, readyOnly: true, viewerScope },
        {
          enabled: requestEnabled,
          placeholderData: undefined,
          refetchInterval: requestEnabled ? LIVE_AVATAR_REFETCH_MS : false,
          refetchIntervalInBackground: false,
          refetchOnMount: "always",
          retry: false,
          staleTime: 0,
        },
      ),
    ),
  );

  const statusResults: readonly LiveAvatarQueryResult[] = queryResults;
  const status = useMemo(
    () =>
      resolveLiveAvatarStatus({
        requestedHostIds: boundedIds.ids,
        queryEnabled: queryAuthority,
        now: clock,
        results: statusResults,
      }),
    [boundedIds.ids, clock, queryAuthority, statusResults],
  );

  useEffect(() => {
    if (status.nextExpiryAt === null) return;
    const delay = Math.max(0, status.nextExpiryAt - Date.now()) + 1;
    const timer = setTimeout(() => setClock(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [status.nextExpiryAt]);

  const isLiveUser = useCallback(
    (userId: number | null | undefined) =>
      isPositiveUserId(userId) && status.liveHostIds.has(userId),
    [status.liveHostIds],
  );
  const value = useMemo<LiveAvatarContextValue>(
    () => ({ isForeground: foreground, isLiveUser, registerVisibleUserId }),
    [foreground, isLiveUser, registerVisibleUserId],
  );

  return (
    <LiveAvatarContext.Provider value={value}>
      {children}
    </LiveAvatarContext.Provider>
  );
}

/** Mount inside CirclesProvider so auth state and the cache key always agree. */
export function LiveAvatarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { authState, user } = useCircles();
  const authenticatedViewerScope = liveAvatarViewerScope(user?.id);
  const queryAuthority =
    authState === "guest" ||
    (authState === "authenticated" && authenticatedViewerScope !== null);
  const viewerScope =
    authState === "authenticated" ? authenticatedViewerScope : null;
  const scopeKey = `${authState}:${liveAvatarScopeKey(viewerScope)}`;

  return (
    <LiveAvatarAccountProvider
      key={scopeKey}
      viewerScope={viewerScope}
      queryAuthority={queryAuthority}
    >
      {children}
    </LiveAvatarAccountProvider>
  );
}

export function useLiveAvatar(userId: number | null | undefined): {
  isForeground: boolean;
  isLive: boolean;
} {
  const { isForeground, isLiveUser, registerVisibleUserId } =
    useContext(LiveAvatarContext);

  useEffect(
    () => registerVisibleUserId(userId),
    [registerVisibleUserId, userId],
  );

  return { isForeground, isLive: isLiveUser(userId) };
}
