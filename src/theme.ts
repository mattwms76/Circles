import tokens from './design-tokens.json';
import metrics from './design-metrics.json';
import { AccessibilityInfo, Appearance, StyleSheet } from 'react-native';
import { useEffect, useState, useSyncExternalStore } from 'react';

export const lightColors = tokens.light;

export const radii = metrics.radii;
export const spacing = metrics.spacing;
export const typography = {
  ...metrics.typography,
  title: {
    ...metrics.typography.title,
    fontFamily: 'Lora-SemiBold' as string | undefined,
    fontWeight: '600' as const,
  },
  section: {
    ...metrics.typography.section,
    fontFamily: 'Lora-SemiBold' as string | undefined,
    fontWeight: '600' as const,
  },
  dialog: { ...metrics.typography.dialog, fontWeight: '700' as const },
  member: { ...metrics.typography.member, fontWeight: '600' as const },
};
let editorialFontAvailable = true;
export function configureEditorialFont(available: boolean) {
  editorialFontAvailable = available;
  typography.title.fontFamily = typography.section.fontFamily = available
    ? 'Lora-SemiBold'
    : undefined;
}

export const darkColors: typeof lightColors = tokens.dark;
export const themeMode = () => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');
const subscribe = (notify: () => void) => {
  const subscription = Appearance.addChangeListener(notify);
  return () => subscription.remove();
};
export function useThemeMode() {
  return useSyncExternalStore(subscribe, themeMode, () => 'light');
}
export const colors = new Proxy(lightColors, {
  get: (_target, key: keyof typeof lightColors) =>
    (themeMode() === 'dark' ? darkColors : lightColors)[key],
});
// Evaluate module-level styles per palette; changing appearance does not remount screens or drafts.
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: () => T): T {
  const cache: Record<string, T> = {};
  return new Proxy({} as T, {
    get: (_target, key: string) => {
      const mode = themeMode();
      const cacheKey = `${mode}:${editorialFontAvailable}`;
      const sheet = cache[cacheKey] ?? (cache[cacheKey] = StyleSheet.create(factory()));
      return sheet[key as keyof T];
    },
  });
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
