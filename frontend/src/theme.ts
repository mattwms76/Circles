// Design tokens for Circles — a warm editorial community app.
// Light + dark themes. Keys match the "color" block of design_guidelines.json.
// Use makeStyles() for StyleSheets and useTheme().colors for color props.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FAF7F5",
  onSurface: "#2A2522",
  surfaceSecondary: "#F2EBE5",
  onSurfaceSecondary: "#4A423D",
  surfaceTertiary: "#E8DFD8",
  onSurfaceTertiary: "#5C534D",
  surfaceInverse: "#2A2522",
  onSurfaceInverse: "#FAF7F5",
  muted: "#8C7C75",

  brand: "#C86A4A",
  onBrand: "#FFFFFF",
  brandPrimary: "#C86A4A",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#D9876C",
  onBrandSecondary: "#2A2522",
  brandTertiary: "#F4D5CA",
  onBrandTertiary: "#A84C2F",

  success: "#4A7A59",
  onSuccess: "#FFFFFF",
  warning: "#D4A352",
  onWarning: "#2A2522",
  error: "#B84A4A",
  onError: "#FFFFFF",
  info: "#5C7685",
  onInfo: "#FFFFFF",

  border: "#E8DFD8",
  borderStrong: "#D1C2BA",
  divider: "#E8DFD8",
};

const dark: typeof light = {
  surface: "#1C1918",
  onSurface: "#EBE5E0",
  surfaceSecondary: "#262221",
  onSurfaceSecondary: "#D1C7C0",
  surfaceTertiary: "#332D2A",
  onSurfaceTertiary: "#B8AAA2",
  surfaceInverse: "#FAF7F5",
  onSurfaceInverse: "#2A2522",
  muted: "#94867D",

  brand: "#D97A54",
  onBrand: "#1C1918",
  brandPrimary: "#D97A54",
  onBrandPrimary: "#1C1918",
  brandSecondary: "#B55B3D",
  onBrandSecondary: "#FAF7F5",
  brandTertiary: "#422920",
  onBrandTertiary: "#E5A28A",

  success: "#5C966E",
  onSuccess: "#1C1918",
  warning: "#E8B966",
  onWarning: "#1C1918",
  error: "#D96666",
  onError: "#1C1918",
  info: "#7A9CA8",
  onInfo: "#1C1918",

  border: "#332D2A",
  borderStrong: "#4A423D",
  divider: "#332D2A",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

// Typography families loaded in app/_layout.tsx via expo-font.
export const fonts = {
  displayRegular: "Lora-Regular",
  displayMedium: "Lora-Medium",
  displaySemiBold: "Lora-SemiBold",
  textRegular: "DMSans-Regular",
  textMedium: "DMSans-Medium",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const radius = {
  sm: 0,
  md: 8,
  lg: 16,
  pill: 999,
} as const;

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme =
    (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
