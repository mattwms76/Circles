import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";

const STATIC_COLOR_SCHEME = "light";

function subscribeToColorScheme(onStoreChange: () => void) {
  const subscription = Appearance.addChangeListener(onStoreChange);

  return () => subscription.remove();
}

function getColorSchemeSnapshot() {
  return Appearance.getColorScheme() ?? STATIC_COLOR_SCHEME;
}

function getStaticColorSchemeSnapshot() {
  return STATIC_COLOR_SCHEME;
}

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  return useSyncExternalStore(
    subscribeToColorScheme,
    getColorSchemeSnapshot,
    getStaticColorSchemeSnapshot,
  );
}
