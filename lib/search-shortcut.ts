export function isSearchShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  editable: boolean;
}) {
  return (
    !event.defaultPrevented &&
    !event.editable &&
    !event.altKey &&
    !event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "k"
  );
}

export function searchShortcutLabel(platform: string) {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘ K" : "Ctrl K";
}

export const FOCUS_DISCOVER_SEARCH_EVENT = "circles:focus-discover-search";
