import tokens from './design-tokens.json';
import { AccessibilityInfo, Appearance, StyleSheet } from 'react-native';
import { useEffect, useState, useSyncExternalStore } from 'react';

export const lightColors = tokens.light;

export const radii = { small: 14, medium: 22, large: 30, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, page: 20, section: 24, xl: 32 };
export const typography = {
  title: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const },
  section: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 24 },
  secondary: { fontSize: 14, lineHeight: 20 },
  caption: { fontSize: 12, lineHeight: 16 },
};

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
  const cache: Partial<Record<'light' | 'dark', T>> = {};
  return new Proxy({} as T, {
    get: (_target, key: string) => {
      const mode = themeMode();
      const sheet = cache[mode] ?? (cache[mode] = StyleSheet.create(factory()));
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
