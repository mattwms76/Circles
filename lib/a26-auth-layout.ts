import { appShellLayout } from "./app-shell-layout";

const NARROW_TAB_TOP_PADDING = 10;
const NARROW_TAB_MIN_CONTROL_HEIGHT = 44;
const NARROW_TAB_MIN_BOTTOM_PADDING = 10;
const ROOT_NOTICE_CLEARANCE = 16;
const DEFAULT_ROOT_NOTICE_BOTTOM = 90;

function normalizedPathname(pathname: string | null | undefined): string {
  const path = pathname?.trim().split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : withLeadingSlash;
}

/** These are the routes rendered by the actual `(tabs)` navigator. */
export function isNarrowTabRoute(pathname: string | null | undefined): boolean {
  const path = normalizedPathname(pathname);
  return (
    path === "/" ||
    path === "/discover" ||
    path === "/circles" ||
    path === "/messages" ||
    path === "/profile"
  );
}

export function narrowTabBarOccupiedHeight(bottomInset: number): number {
  const safeBottom = Number.isFinite(bottomInset)
    ? Math.max(0, bottomInset)
    : 0;
  return (
    NARROW_TAB_TOP_PADDING +
    NARROW_TAB_MIN_CONTROL_HEIGHT +
    Math.max(NARROW_TAB_MIN_BOTTOM_PADDING, safeBottom)
  );
}

/**
 * Mirrors app/(tabs)/_layout.tsx: the root notice clears the visible narrow
 * tab bar plus a readable gap, but keeps the historical 90pt fallback outside
 * tab routes or on the wide layout where the bar is not rendered.
 */
export function rootFeedbackNoticeBottom({
  pathname,
  windowWidth,
  insets,
}: {
  pathname: string | null | undefined;
  windowWidth: number;
  insets: { top: number; left: number; right: number; bottom: number };
}): number {
  if (!isNarrowTabRoute(pathname) || appShellLayout(windowWidth, insets).wide) {
    return DEFAULT_ROOT_NOTICE_BOTTOM;
  }

  return narrowTabBarOccupiedHeight(insets.bottom) + ROOT_NOTICE_CLEARANCE;
}
