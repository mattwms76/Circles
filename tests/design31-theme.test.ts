import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contrastRatio } from "../lib/ui-accessibility";
import {
  getThemeLabPreviewSchemeToggleColors,
  themeLabPreviewActions,
  themeLabPreviewPalettes,
  themeLabPreviewSchemes,
} from "../lib/batch5-theme-lab";
vi.mock("@/components/screen-metadata", () => ({
  ScreenMetadata: "ScreenMetadata",
}));
vi.mock("../components/screen-metadata", () => ({
  ScreenMetadata: "ScreenMetadata",
}));

const reactState = vi.hoisted(() => ({
  setters: [] as ReturnType<typeof vi.fn>[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initialValue: unknown) => {
      const setState = vi.fn();
      reactState.setters.push(setState);
      return [
        typeof initialValue === "function" ? initialValue() : initialValue,
        setState,
      ];
    },
  };
});

vi.mock("react-native", () => ({
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: {
    OS: "web",
    select: ({
      ios,
      default: fallback,
    }: {
      ios?: unknown;
      default?: unknown;
    }) => fallback ?? ios,
  },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: {
    create: <T>(value: T) => value,
  },
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-status-bar", () => ({ StatusBar: "StatusBar" }));
vi.mock(
  "@/lib/batch5-theme-lab",
  async () => import("../lib/batch5-theme-lab"),
);

const ThemeLabScreen = (await import("../app/dev/theme-lab")).default;

function findElements(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>>[] {
  const elements: ReactElement<Record<string, unknown>>[] = [];

  function visit(candidate: ReactNode): void {
    for (const child of Children.toArray(candidate)) {
      if (!isValidElement<Record<string, unknown>>(child)) continue;
      if (predicate(child)) elements.push(child);
      visit(child.props.children as ReactNode);
    }
  }

  visit(node);
  return elements;
}

function findRadio(
  radios: ReactElement<Record<string, unknown>>[],
  label: string,
): ReactElement<Record<string, unknown>> {
  const radio = radios.find(
    (element) => element.props.accessibilityLabel === label,
  );
  if (!radio) throw new Error(`Expected radio labeled ${label}.`);
  return radio;
}

function flattenStyle(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return Object.assign({}, ...value.map(flattenStyle));
  }
  return value && typeof value === "object" ? { ...value } : {};
}

function getRestingStyle(
  element: ReactElement<Record<string, unknown>>,
): Record<string, unknown> {
  const style = element.props.style;
  if (typeof style !== "function") {
    throw new Error("Expected the radio style to respond to press state.");
  }
  return flattenStyle(style({ pressed: false }));
}

function press(element: ReactElement<Record<string, unknown>>): void {
  const onPress = element.props.onPress;
  if (typeof onPress !== "function") {
    throw new Error("Expected the radio to handle selection.");
  }
  onPress();
}

describe("D26-18 Theme Lab palette radio boundaries", () => {
  beforeEach(() => {
    reactState.setters.length = 0;
  });

  it("keeps each final unselected radio boundary at or above 3:1 against both adjacent surfaces", () => {
    const lightUnselected = getThemeLabPreviewSchemeToggleColors(
      "light",
      "dark",
    );
    const darkUnselected = getThemeLabPreviewSchemeToggleColors(
      "dark",
      "light",
    );

    const boundaryPairs = [
      {
        name: "light preview control border against unselected card fill",
        first: lightUnselected.borderColor,
        second: themeLabPreviewPalettes.light.surface,
      },
      {
        name: "light preview control border against page background",
        first: lightUnselected.borderColor,
        second: themeLabPreviewPalettes.light.background,
      },
      {
        name: "dark preview control border against unselected card fill",
        first: darkUnselected.borderColor,
        second: themeLabPreviewPalettes.dark.surface,
      },
      {
        name: "dark preview control border against page background",
        first: darkUnselected.borderColor,
        second: themeLabPreviewPalettes.dark.background,
      },
    ];

    for (const pair of boundaryPairs) {
      expect(
        contrastRatio(pair.first, pair.second),
        pair.name,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps selected and unselected radio text, fills, and preview actions at their applicable contrast targets", () => {
    for (const previewScheme of themeLabPreviewSchemes) {
      const palette = themeLabPreviewPalettes[previewScheme];
      const selected = getThemeLabPreviewSchemeToggleColors(
        previewScheme,
        previewScheme,
      );
      const unselected = getThemeLabPreviewSchemeToggleColors(
        previewScheme,
        previewScheme === "light" ? "dark" : "light",
      );

      expect(selected.isSelected).toBe(true);
      expect(unselected.isSelected).toBe(false);
      expect(
        contrastRatio(selected.backgroundColor, palette.background),
        `${previewScheme} selected fill against page background`,
      ).toBeGreaterThanOrEqual(3);

      for (const [stateName, colors] of [
        ["selected", selected],
        ["unselected", unselected],
      ] as const) {
        expect(
          contrastRatio(colors.titleColor, colors.backgroundColor),
          `${previewScheme} ${stateName} title`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(colors.subtitleColor, colors.backgroundColor),
          `${previewScheme} ${stateName} subtitle`,
        ).toBeGreaterThanOrEqual(4.5);
      }

      for (const action of themeLabPreviewActions) {
        expect(
          contrastRatio(palette[action.foreground], palette[action.background]),
          `${previewScheme} ${action.label} action`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("renders the named local-only palette radios with their existing state and hit dimensions", () => {
    const radios = findElements(
      ThemeLabScreen(),
      (element) =>
        element.type === "Pressable" &&
        element.props.accessibilityRole === "radio",
    );
    const lightRadio = findRadio(radios, "Light preview palette");
    const darkRadio = findRadio(radios, "Dark preview palette");
    const lightStyle = getRestingStyle(lightRadio);
    const darkStyle = getRestingStyle(darkRadio);

    expect(radios).toHaveLength(2);
    expect(lightRadio.props).toMatchObject({
      accessibilityHint:
        "Changes the preview in Theme Lab only; it does not change the app theme.",
      accessibilityRole: "radio",
      "aria-checked": true,
      accessibilityState: { checked: true, selected: true },
    });
    expect(darkRadio.props).toMatchObject({
      accessibilityRole: "radio",
      "aria-checked": false,
      accessibilityState: { checked: false, selected: false },
    });
    expect(lightStyle).toMatchObject({
      minHeight: 96,
      backgroundColor: themeLabPreviewPalettes.light.primary,
      borderColor: themeLabPreviewPalettes.light.primary,
    });
    expect(darkStyle).toMatchObject({
      minHeight: 96,
      backgroundColor: themeLabPreviewPalettes.light.surface,
      borderColor: themeLabPreviewPalettes.light.controlBorder,
    });

    press(darkRadio);
    expect(reactState.setters).toHaveLength(3);
    expect(reactState.setters[1]).toHaveBeenCalledWith(
      "Selected Dark preview palette",
    );
    expect(reactState.setters[2]).toHaveBeenCalledWith("dark");
  });
});
