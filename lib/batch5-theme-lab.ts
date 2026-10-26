export const themeLabPreviewSchemes = ["light", "dark"] as const;

export type ThemeLabPreviewScheme = (typeof themeLabPreviewSchemes)[number];

export type ThemeLabPreviewTokenName =
  | "primary"
  | "background"
  | "surface"
  | "foreground"
  | "muted"
  | "border"
  | "success"
  | "warning"
  | "error"
  | "actionForeground";

export type ThemeLabPreviewPalette = Record<ThemeLabPreviewTokenName, string>;

/**
 * Theme Lab previews these values only within its route. They deliberately do
 * not call the app-wide ThemeProvider, so selecting a palette cannot change a
 * member's production theme preference.
 */
export const themeLabPreviewPalettes = {
  light: {
    primary: "#A53728",
    background: "#F9F8F5",
    surface: "#FFFFFF",
    foreground: "#242825",
    muted: "#4D5948",
    border: "#D0D3C8",
    success: "#3F6541",
    warning: "#6C5100",
    error: "#A53728",
    actionForeground: "#FFFFFF",
  },
  dark: {
    primary: "#FFB4A6",
    background: "#1A1C1A",
    surface: "#252825",
    foreground: "#F2F3EE",
    muted: "#C2C8BD",
    border: "#4B5148",
    success: "#B9D6AE",
    warning: "#F1CC77",
    error: "#FFB4A6",
    actionForeground: "#1A1C1A",
  },
} as const satisfies Record<ThemeLabPreviewScheme, ThemeLabPreviewPalette>;

export const themeLabPreviewTokenNames = [
  "primary",
  "background",
  "surface",
  "foreground",
  "muted",
  "border",
  "success",
  "warning",
  "error",
  "actionForeground",
] as const satisfies readonly ThemeLabPreviewTokenName[];

export const themeLabPreviewActions = [
  { label: "Primary", background: "primary", foreground: "actionForeground" },
  { label: "Surface", background: "surface", foreground: "foreground" },
  { label: "Success", background: "success", foreground: "actionForeground" },
  { label: "Warning", background: "warning", foreground: "actionForeground" },
  { label: "Error", background: "error", foreground: "actionForeground" },
] as const satisfies readonly {
  label: string;
  background: ThemeLabPreviewTokenName;
  foreground: ThemeLabPreviewTokenName;
}[];

export function formatThemeLabPreviewTokenName(
  name: ThemeLabPreviewTokenName,
): string {
  return name.replace(/([A-Z])/g, " $1");
}
