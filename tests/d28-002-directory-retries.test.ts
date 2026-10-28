import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const circlesSource = readFileSync(
  new URL("../app/(tabs)/circles.tsx", import.meta.url),
  "utf8",
);
const circlesUiSource = readFileSync(
  new URL("../components/circles-ui.tsx", import.meta.url),
  "utf8",
);

describe("D28-002 directory retry controls", () => {
  it("forwards opt-in Empty action busy and disabled state to the named Button", () => {
    expect(circlesUiSource).toContain("actionLoading = false,");
    expect(circlesUiSource).toContain("actionDisabled = false,");
    expect(circlesUiSource).toContain("loading={actionLoading}");
    expect(circlesUiSource).toContain("disabled={actionDisabled}");
    expect(circlesUiSource).toContain(
      "accessibilityLabel={accessibilityLabel ?? title}",
    );
    expect(circlesUiSource).toContain("busy: loading");
  });

  it("maps no-content, refresh, and continuation retries to their matching query flights", () => {
    expect(circlesSource).toContain("actionLoading={circles.isFetching}");
    expect(circlesSource).toContain("actionDisabled={circles.isFetching}");
    expect(circlesSource).toContain(
      'const retainedRetryLoading =\n    circlesDisplayState.retryMode === "next"\n      ? circles.isFetchingNextPage\n      : circles.isRefetching;',
    );
    expect(circlesSource).toContain("loading={retainedRetryLoading}");
    expect(circlesSource).toContain("disabled={retainedRetryLoading}");
    expect(circlesSource).toContain(
      'title={\n                  circlesDisplayState.retryMode === "next"\n                    ? "Retry loading more circles"\n                    : "Refresh circles"',
    );
  });
});
