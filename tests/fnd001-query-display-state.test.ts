import { describe, expect, it } from "vitest";
import { resolveFnd001QueryDisplayState } from "../lib/fnd001-query-display-state";

const rejectedQueryFixture = {
  isLoading: false,
  isError: true,
  hasContent: false,
};

const successfulEmptyQueryFixture = {
  isLoading: false,
  isError: false,
  hasContent: false,
};

describe("FND-001 query display states", () => {
  it("keeps a rejected no-result fixture out of successful empty and ended UI", () => {
    expect(resolveFnd001QueryDisplayState(rejectedQueryFixture)).toBe("error");
  });

  it("reserves the empty state for a successful no-result fixture", () => {
    expect(resolveFnd001QueryDisplayState(successfulEmptyQueryFixture)).toBe(
      "empty",
    );
  });

  it("preserves loading and populated query fixtures", () => {
    expect(
      resolveFnd001QueryDisplayState({
        isLoading: true,
        isError: false,
        hasContent: false,
      }),
    ).toBe("loading");
    expect(
      resolveFnd001QueryDisplayState({
        isLoading: false,
        isError: false,
        hasContent: true,
      }),
    ).toBe("content");
  });
});
