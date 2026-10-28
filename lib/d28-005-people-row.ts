export const D28_005_COMPACT_ROW_MAX_WIDTH = 320;

/**
 * Moves the People-row action below the profile target before a compact card
 * can starve its identity column. A measured 320-point card, or a narrower
 * card after safe-area and route gutters, uses the full-width action layout.
 */
export function d28005PeopleRowActionLayout(
  availableWidth: number | null | undefined,
): "inline" | "full-width" {
  const hasCompactWidth =
    typeof availableWidth === "number" &&
    Number.isFinite(availableWidth) &&
    availableWidth <= D28_005_COMPACT_ROW_MAX_WIDTH;

  return hasCompactWidth ? "full-width" : "inline";
}
