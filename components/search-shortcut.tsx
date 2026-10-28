import { useEffect } from "react";
import { usePathname, useRouter } from "expo-router";
import {
  FOCUS_DISCOVER_SEARCH_EVENT,
  isSearchShortcut,
} from "@/lib/search-shortcut";

export function SearchShortcut() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof Element &&
        !!target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        );
      if (
        !isSearchShortcut({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          defaultPrevented: event.defaultPrevented,
          editable,
        })
      )
        return;
      event.preventDefault();
      if (pathname === "/discover") {
        window.dispatchEvent(new Event(FOCUS_DISCOVER_SEARCH_EVENT));
      } else {
        router.push("/discover?focus=search");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pathname, router]);
  return null;
}
