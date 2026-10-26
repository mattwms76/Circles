export type AppNavigationSection =
  | "home"
  | "discover"
  | "circles"
  | "updates"
  | "messages"
  | "profile"
  | "live";

function normalizedPathname(pathname: string | null | undefined): string {
  const withoutQueryOrHash = pathname?.trim().split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = withoutQueryOrHash.startsWith("/")
    ? withoutQueryOrHash
    : `/${withoutQueryOrHash}`;

  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : withLeadingSlash;
}

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * Resolves paths that belong to a visible AppShell navigation section. Routes
 * without a matching wide-rail destination intentionally return null.
 */
export function resolveAppNavigationSection(
  pathname: string | null | undefined,
): AppNavigationSection | null {
  const path = normalizedPathname(pathname);

  if (path === "/") return "home";
  if (matchesRoute(path, "/discover")) return "discover";
  if (matchesRoute(path, "/circles") || matchesRoute(path, "/circle")) {
    return "circles";
  }
  if (matchesRoute(path, "/updates")) return "updates";
  if (matchesRoute(path, "/messages") || matchesRoute(path, "/chat")) {
    return "messages";
  }
  if (
    matchesRoute(path, "/profile") ||
    matchesRoute(path, "/person") ||
    matchesRoute(path, "/account/email")
  ) {
    return "profile";
  }
  if (matchesRoute(path, "/live")) return "live";

  return null;
}
