import type { AccessibilityState } from "react-native";

/** Preserve native state while exposing it to the installed React Native Web renderer. */
export function controlAccessibilityProps(
  state: AccessibilityState | undefined,
  role: "button" | "tab" | "checkbox" | "switch" | "radio" = "button",
) {
  const value = state ?? {};
  const checked =
    value.checked ?? (role === "radio" ? value.selected : undefined);
  return {
    accessibilityState:
      state && role === "radio" ? { ...state, checked } : state,
    "aria-disabled": value.disabled,
    "aria-busy": value.busy,
    "aria-checked": checked,
    "aria-expanded": value.expanded,
    "aria-selected": role === "tab" ? value.selected : undefined,
    "aria-pressed": role === "button" ? value.selected : undefined,
  };
}
