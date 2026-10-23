export const UI_ACCESSIBLE_COLORS = {
  /** Normal secondary copy/icons on the app's warm paper, sage and soft surfaces. */
  secondary: "#4D5948",
  /** Accessible coral-family action fill; decorative brand coral remains separate. */
  action: "#A53728",
  actionPressed: "#7D2B21",
  actionDisabled: "#7D2B21",
  actionText: "#FFFFFF",
} as const;

export type ButtonVisualTokens = {
  backgroundColor: string;
  foregroundColor: string;
  borderColor?: string;
};

/**
 * Shared Button colors deliberately avoid group opacity: alpha compositing a loading
 * action against paper would weaken its white spinner/text contrast.
 */
export function buttonVisualTokens(input: {
  secondary: boolean;
  disabled: boolean;
  loading: boolean;
  pressed: boolean;
}): ButtonVisualTokens {
  const inactive = input.disabled || input.loading;
  if (input.secondary) {
    return {
      backgroundColor: inactive
        ? "#E9EEE5"
        : input.pressed
          ? "#E9EEE5"
          : "#FFFFFF",
      foregroundColor: UI_ACCESSIBLE_COLORS.secondary,
      borderColor: "#E8E9E2",
    };
  }
  return {
    backgroundColor: inactive
      ? UI_ACCESSIBLE_COLORS.actionDisabled
      : input.pressed
        ? UI_ACCESSIBLE_COLORS.actionPressed
        : UI_ACCESSIBLE_COLORS.action,
    foregroundColor: UI_ACCESSIBLE_COLORS.actionText,
  };
}

function channelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match)
    throw new Error(`Expected a six-digit hex color, received ${hex}`);
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return (
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue)
  );
}

/** WCAG relative-luminance ratio for deterministic source-level color checks. */
export function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
