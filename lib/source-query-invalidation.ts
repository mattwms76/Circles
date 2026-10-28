import type {
  InvalidateOptions,
  InvalidateQueryFilters,
} from "@tanstack/react-query";

export const SOURCE_REVALIDATION_INTERVAL_MS = 15_000;

type InvalidationProcedure = {
  invalidate: () => Promise<unknown>;
};

/**
 * Deliberately structural rather than router-derived so the return value of
 * `trpc.useUtils()` can be supplied without coupling this shared policy to the
 * generated application-router type.
 */
export type SourceQueryUtils = {
  social: {
    feed: InvalidationProcedure;
    feedPage: InvalidationProcedure;
    circles: InvalidationProcedure;
    circlesPage: InvalidationProcedure;
    profile: InvalidationProcedure;
    profiles: InvalidationProcedure;
    profilesPage: InvalidationProcedure;
    conversations: InvalidationProcedure;
  };
  moderation: {
    list: InvalidationProcedure;
    detail: InvalidationProcedure;
  };
};

async function invalidateAll(
  procedures: readonly InvalidationProcedure[],
): Promise<void> {
  // Mutation completion should not fail because a background observer's
  // refetch did. Each invalidation still gets an independent chance to run.
  await Promise.allSettled(
    procedures.map((procedure) =>
      Promise.resolve().then(() => procedure.invalidate()),
    ),
  );
}

/** Invalidates both the legacy and paged post-feed readers. */
export async function invalidatePostFeeds(
  utils: SourceQueryUtils,
): Promise<void> {
  await invalidateAll([utils.social.feed, utils.social.feedPage]);
}

/** Invalidates both the legacy and paged circle-directory readers. */
export async function invalidateCircleDirectories(
  utils: SourceQueryUtils,
): Promise<void> {
  await invalidateAll([utils.social.circles, utils.social.circlesPage]);
}

/**
 * Invalidates every ordinary profile view affected by profile/follow changes,
 * including the legacy and paged lists and both feed generations.
 */
export async function invalidateProfileViews(
  utils: SourceQueryUtils,
): Promise<void> {
  await invalidateAll([
    utils.social.profile,
    utils.social.profiles,
    utils.social.profilesPage,
    utils.social.feed,
    utils.social.feedPage,
    utils.social.conversations,
  ]);
}

/** Invalidates the scoped moderation queue and its selected-case reader. */
export async function invalidateModerationViews(
  utils: SourceQueryUtils,
): Promise<void> {
  await invalidateAll([utils.moderation.list, utils.moderation.detail]);
}

const SOCIAL_SOURCE_PROCEDURES = new Set([
  "profile",
  "profiles",
  "profilesPage",
  "circle",
  "circles",
  "circlesPage",
  "members",
  "membersPage",
  "feed",
  "feedPage",
  "comments",
  "conversations",
]);
const CIRCLE_HOME_SOURCE_PROCEDURES = new Set(["get"]);
const MODERATION_SOURCE_PROCEDURES = new Set(["list", "detail"]);
const ACTIVITY_SOURCE_PROCEDURES = new Set([
  "list",
  "unreadCount",
  "resolveTarget",
]);
const PLATFORM_SOURCE_PROCEDURES = new Set(["status"]);

export type SourceQueryRouter =
  | "social"
  | "circleHome"
  | "moderation"
  | "activity"
  | "platform";

export type SourceQueryDescriptor = {
  router: SourceQueryRouter;
  procedure: string;
  input: Readonly<Record<string, unknown>> | undefined;
};

type SourceRoute =
  | { kind: "home" }
  | { kind: "discover" }
  | { kind: "circles" }
  | { kind: "circle"; circleId: number }
  | { kind: "profile"; profileId: number | null }
  | { kind: "messages" }
  | { kind: "updates"; activityId: number | null }
  | { kind: "moderation"; circleId: number }
  | { kind: "other" };

export type SourceRevalidationQueryClient = {
  invalidateQueries: (
    filters: InvalidateQueryFilters,
    options?: InvalidateOptions,
  ) => Promise<void>;
};

export type SourceRevalidationControllerOptions = {
  queryClient: SourceRevalidationQueryClient;
  pathname: string;
  accountId: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sourceProcedureIsAllowed(router: string, procedure: string): boolean {
  if (router === "social") return SOCIAL_SOURCE_PROCEDURES.has(procedure);
  if (router === "circleHome")
    return CIRCLE_HOME_SOURCE_PROCEDURES.has(procedure);
  if (router === "moderation")
    return MODERATION_SOURCE_PROCEDURES.has(procedure);
  if (router === "activity") return ACTIVITY_SOURCE_PROCEDURES.has(procedure);
  if (router === "platform") return PLATFORM_SOURCE_PROCEDURES.has(procedure);
  return false;
}

/**
 * Parses only a concrete tRPC v11 procedure key: [[router, procedure],
 * { input, type }]. Router-level keys, unknown routers, and non-query metadata
 * cannot select normal-app source data.
 */
export function describeSourceQueryKey(
  queryKey: readonly unknown[],
): SourceQueryDescriptor | null {
  const path = queryKey[0];
  if (
    !Array.isArray(path) ||
    path.length !== 2 ||
    typeof path[0] !== "string" ||
    typeof path[1] !== "string" ||
    !sourceProcedureIsAllowed(path[0], path[1])
  ) {
    return null;
  }

  const metadata = queryKey[1];
  if (metadata !== undefined && !isRecord(metadata)) return null;

  const queryType = metadata?.type;
  if (
    queryType !== undefined &&
    queryType !== "query" &&
    queryType !== "infinite"
  ) {
    return null;
  }

  const rawInput = metadata?.input;
  if (rawInput !== undefined && !isRecord(rawInput)) return null;

  return {
    router: path[0] as SourceQueryRouter,
    procedure: path[1],
    input: rawInput,
  };
}

function pathnameForMatch(pathname: string): string {
  const pathnameWithoutSearch = pathname.split(/[?#]/, 1)[0] ?? "";
  const normalized = pathnameWithoutSearch.replace(/\/+$/, "");
  return normalized || "/";
}

function pathId(segment: string | undefined): number | null {
  if (!segment || !/^[1-9]\d*$/.test(segment)) return null;
  const parsed = Number(segment);
  return isPositiveSafeId(parsed) ? parsed : null;
}

function sourceRouteForPath(pathname: string): SourceRoute {
  const segments = pathnameForMatch(pathname).split("/").filter(Boolean);
  if (segments.length === 0) return { kind: "home" };
  if (segments.length === 1 && segments[0] === "discover") {
    return { kind: "discover" };
  }
  if (segments.length === 1 && segments[0] === "circles") {
    return { kind: "circles" };
  }
  if (segments.length === 2 && segments[0] === "circle") {
    const circleId = pathId(segments[1]);
    return circleId ? { kind: "circle", circleId } : { kind: "other" };
  }
  if (segments.length === 1 && segments[0] === "profile") {
    return { kind: "profile", profileId: null };
  }
  if (segments.length === 2 && segments[0] === "person") {
    const profileId = pathId(segments[1]);
    return profileId ? { kind: "profile", profileId } : { kind: "other" };
  }
  if (segments.length === 1 && segments[0] === "messages") {
    return { kind: "messages" };
  }
  if (segments[0] === "updates" && segments.length <= 2) {
    if (segments.length === 1) return { kind: "updates", activityId: null };
    const activityId = pathId(segments[1]);
    return activityId ? { kind: "updates", activityId } : { kind: "other" };
  }
  if (segments.length === 2 && segments[0] === "moderation") {
    const circleId = pathId(segments[1]);
    return circleId ? { kind: "moderation", circleId } : { kind: "other" };
  }
  return { kind: "other" };
}

function inputIdMatches(
  input: Readonly<Record<string, unknown>> | undefined,
  field: string,
  expected: number,
): boolean {
  return input?.[field] === expected;
}

function hasNoInputId(
  input: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return input?.id === undefined;
}

function hasCurrentViewerScope(
  input: Readonly<Record<string, unknown>> | undefined,
  accountId: number,
): boolean {
  return input?.viewerScope === accountId;
}

function hasNoCircleScope(
  input: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return input?.circleId === undefined;
}

function isCommonShellQuery(
  descriptor: SourceQueryDescriptor,
  accountId: number,
): boolean {
  // AppShell's avatar and circles sidebar are signed-in caller projections.
  // The activity badge is protected by its explicit viewer-affinity input.
  return (
    (descriptor.router === "social" &&
      descriptor.procedure === "profile" &&
      hasNoInputId(descriptor.input)) ||
    (descriptor.router === "social" &&
      descriptor.procedure === "circles" &&
      hasNoCircleScope(descriptor.input)) ||
    (descriptor.router === "activity" &&
      descriptor.procedure === "unreadCount" &&
      hasCurrentViewerScope(descriptor.input, accountId))
  );
}

function isPlatformStatusQuery(descriptor: SourceQueryDescriptor): boolean {
  return (
    descriptor.router === "platform" &&
    descriptor.procedure === "status" &&
    descriptor.input === undefined
  );
}

function isCircleContentProcedure(procedure: string): boolean {
  return ["feed", "feedPage", "comments"].includes(procedure);
}

function matchesProfileRoute(
  descriptor: SourceQueryDescriptor,
  profileId: number | null,
  accountId: number,
): boolean {
  if (descriptor.router !== "social") return false;
  if (descriptor.procedure === "profile") {
    return profileId === null
      ? hasNoInputId(descriptor.input)
      : inputIdMatches(descriptor.input, "id", profileId);
  }
  if (!["feed", "feedPage", "comments"].includes(descriptor.procedure)) {
    return false;
  }
  if (descriptor.procedure === "comments") return true;
  if (!hasNoCircleScope(descriptor.input)) return false;
  if (profileId !== null) {
    return inputIdMatches(descriptor.input, "authorId", profileId);
  }
  return (
    inputIdMatches(descriptor.input, "authorId", accountId) ||
    descriptor.input?.filter === "saved"
  );
}

/**
 * Returns true only for a current, ordinary-app query that is relevant to the
 * visible route. The predicate intentionally recognizes no admin router,
 * claims, URLs, onboarding, preference, live, message-body, or draft keys.
 */
export function isCurrentSourceQueryForPath(
  queryKey: readonly unknown[],
  pathname: string,
  accountId: number | null,
): boolean {
  const descriptor = describeSourceQueryKey(queryKey);
  if (!descriptor) return false;

  // This public, bounded status DTO is deliberately the only non-account
  // query in the bridge. It exposes feature/readiness flags only and lets
  // maintenance and creation UI react without a second polling hook.
  if (isPlatformStatusQuery(descriptor)) return true;
  if (!isPositiveSafeId(accountId)) return false;

  const route = sourceRouteForPath(pathname);
  if (route.kind === "other") return false;
  if (isCommonShellQuery(descriptor, accountId)) return true;

  switch (route.kind) {
    case "home":
      return (
        descriptor.router === "social" &&
        ((["profiles", "profilesPage"].includes(descriptor.procedure) &&
          hasNoCircleScope(descriptor.input)) ||
          (isCircleContentProcedure(descriptor.procedure) &&
            hasNoCircleScope(descriptor.input)))
      );
    case "discover":
      return (
        descriptor.router === "social" &&
        [
          "profiles",
          "profilesPage",
          "circles",
          "circlesPage",
          "feed",
          "feedPage",
          "comments",
        ].includes(descriptor.procedure) &&
        hasNoCircleScope(descriptor.input)
      );
    case "circles":
      return (
        descriptor.router === "social" &&
        ["circles", "circlesPage"].includes(descriptor.procedure)
      );
    case "circle":
      if (descriptor.router === "circleHome") {
        return (
          descriptor.procedure === "get" &&
          inputIdMatches(descriptor.input, "circleId", route.circleId) &&
          hasCurrentViewerScope(descriptor.input, accountId)
        );
      }
      if (descriptor.router !== "social") return false;
      if (descriptor.procedure === "circle") {
        return inputIdMatches(descriptor.input, "id", route.circleId);
      }
      if (["members", "membersPage"].includes(descriptor.procedure)) {
        return inputIdMatches(descriptor.input, "circleId", route.circleId);
      }
      if (isCircleContentProcedure(descriptor.procedure)) {
        return descriptor.procedure === "comments"
          ? true
          : inputIdMatches(descriptor.input, "circleId", route.circleId);
      }
      return false;
    case "profile":
      return matchesProfileRoute(descriptor, route.profileId, accountId);
    case "messages":
      return (
        descriptor.router === "social" &&
        descriptor.procedure === "conversations"
      );
    case "updates":
      if (
        descriptor.router !== "activity" ||
        !hasCurrentViewerScope(descriptor.input, accountId)
      ) {
        return false;
      }
      return route.activityId === null
        ? descriptor.procedure === "list"
        : descriptor.procedure === "resolveTarget" &&
            inputIdMatches(descriptor.input, "id", route.activityId);
    case "moderation":
      return (
        descriptor.router === "moderation" &&
        hasCurrentViewerScope(descriptor.input, accountId) &&
        inputIdMatches(descriptor.input, "circleId", route.circleId)
      );
  }
}

/**
 * Owns only a foreground timer and a single filtered TanStack invalidation.
 * It never refetches a whole query cache, and disposal makes later interval
 * callbacks inert when a route or authenticated account changes.
 */
export class SourceRevalidationController {
  private readonly accountId: number | null;
  private readonly pathname: string;
  private readonly queryClient: SourceRevalidationQueryClient;
  private disposed = false;
  private foreground = false;
  private refreshing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor({
    queryClient,
    pathname,
    accountId,
  }: SourceRevalidationControllerOptions) {
    this.queryClient = queryClient;
    this.pathname = pathname;
    this.accountId = accountId;
  }

  setForeground(foreground: boolean): void {
    if (this.disposed) return;
    this.foreground = foreground;
    if (foreground) this.startInterval();
    else this.stopInterval();
  }

  async refresh(): Promise<void> {
    if (this.disposed || !this.foreground || this.refreshing) {
      return;
    }

    this.refreshing = true;
    try {
      await this.queryClient.invalidateQueries({
        type: "active",
        refetchType: "active",
        predicate: (query) =>
          !this.disposed &&
          isCurrentSourceQueryForPath(
            query.queryKey,
            this.pathname,
            this.accountId,
          ),
      });
    } catch {
      // A lifecycle refresh is best effort. Visible query UI retains its own
      // error/retry behavior and must not surface an unhandled rejection.
    } finally {
      this.refreshing = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopInterval();
  }

  private startInterval(): void {
    if (this.timer || !this.foreground || this.disposed) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, SOURCE_REVALIDATION_INTERVAL_MS);
  }

  private stopInterval(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export function createSourceRevalidationController(
  options: SourceRevalidationControllerOptions,
): SourceRevalidationController {
  return new SourceRevalidationController(options);
}
