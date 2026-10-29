import { describe, expect, it } from "vitest";
import {
  resolveCurrentQueryDisplayState,
  uniqueByNumericId,
  type CurrentQueryDisplayState,
  type CurrentQueryDisplayStateInput,
} from "../lib/query-display-state";

function legacyQueryDisplayState({
  queryEnabled,
  isError,
  isFetchedAfterMount,
  isFetching,
  hasCurrentValue,
  hasForeignValue,
}: CurrentQueryDisplayStateInput): CurrentQueryDisplayState {
  const mismatchSettled =
    queryEnabled && isFetchedAfterMount && hasForeignValue && !isFetching;
  const displayError = queryEnabled && (isError || mismatchSettled);
  const displayLoading =
    queryEnabled &&
    !displayError &&
    (!isFetchedAfterMount || (hasForeignValue && isFetching));

  return {
    isLoading: displayLoading,
    isError: displayError,
    isAuthorityAvailable:
      queryEnabled &&
      isFetchedAfterMount &&
      !isError &&
      hasCurrentValue &&
      !hasForeignValue &&
      !isFetching,
  };
}

const displayStateCases = [
  {
    name: "stays inert while the query is disabled",
    input: {
      queryEnabled: false,
      isError: true,
      isFetchedAfterMount: true,
      isFetching: true,
      hasCurrentValue: true,
      hasForeignValue: true,
    },
    expected: {
      isLoading: false,
      isError: false,
      isAuthorityAvailable: false,
    },
  },
  {
    name: "loads until the enabled query has fetched after mount",
    input: {
      queryEnabled: true,
      isError: false,
      isFetchedAfterMount: false,
      isFetching: false,
      hasCurrentValue: false,
      hasForeignValue: false,
    },
    expected: {
      isLoading: true,
      isError: false,
      isAuthorityAvailable: false,
    },
  },
  {
    name: "lets an enabled query error win over a cached current value",
    input: {
      queryEnabled: true,
      isError: true,
      isFetchedAfterMount: true,
      isFetching: false,
      hasCurrentValue: true,
      hasForeignValue: false,
    },
    expected: {
      isLoading: false,
      isError: true,
      isAuthorityAvailable: false,
    },
  },
  {
    name: "treats a settled foreign cache value as an error",
    input: {
      queryEnabled: true,
      isError: false,
      isFetchedAfterMount: true,
      isFetching: false,
      hasCurrentValue: false,
      hasForeignValue: true,
    },
    expected: {
      isLoading: false,
      isError: true,
      isAuthorityAvailable: false,
    },
  },
  {
    name: "keeps a foreign cache value loading while it refreshes",
    input: {
      queryEnabled: true,
      isError: false,
      isFetchedAfterMount: true,
      isFetching: true,
      hasCurrentValue: false,
      hasForeignValue: true,
    },
    expected: {
      isLoading: true,
      isError: false,
      isAuthorityAvailable: false,
    },
  },
  {
    name: "makes a settled current value authoritative",
    input: {
      queryEnabled: true,
      isError: false,
      isFetchedAfterMount: true,
      isFetching: false,
      hasCurrentValue: true,
      hasForeignValue: false,
    },
    expected: {
      isLoading: false,
      isError: false,
      isAuthorityAvailable: true,
    },
  },
  {
    name: "removes authority but not a current value's display state during refresh",
    input: {
      queryEnabled: true,
      isError: false,
      isFetchedAfterMount: true,
      isFetching: true,
      hasCurrentValue: true,
      hasForeignValue: false,
    },
    expected: {
      isLoading: false,
      isError: false,
      isAuthorityAvailable: false,
    },
  },
  {
    name: "lets a settled foreign value win when supplied alongside a current value",
    input: {
      queryEnabled: true,
      isError: false,
      isFetchedAfterMount: true,
      isFetching: false,
      hasCurrentValue: true,
      hasForeignValue: true,
    },
    expected: {
      isLoading: false,
      isError: true,
      isAuthorityAvailable: false,
    },
  },
] satisfies {
  name: string;
  input: CurrentQueryDisplayStateInput;
  expected: CurrentQueryDisplayState;
}[];

function inputForMask(mask: number): CurrentQueryDisplayStateInput {
  return {
    queryEnabled: Boolean(mask & 1),
    isError: Boolean(mask & 2),
    isFetchedAfterMount: Boolean(mask & 4),
    isFetching: Boolean(mask & 8),
    hasCurrentValue: Boolean(mask & 16),
    hasForeignValue: Boolean(mask & 32),
  };
}

describe("resolveCurrentQueryDisplayState", () => {
  for (const scenario of displayStateCases) {
    it(scenario.name, () => {
      expect(resolveCurrentQueryDisplayState(scenario.input)).toEqual(
        scenario.expected,
      );
    });
  }

  it("matches the legacy semantics for every combination of its six booleans", () => {
    for (let mask = 0; mask < 64; mask += 1) {
      const input = inputForMask(mask);
      expect(resolveCurrentQueryDisplayState(input)).toEqual(
        legacyQueryDisplayState(input),
      );
    }
  });
});

describe("uniqueByNumericId", () => {
  it("keeps first occurrences in order and preserves their object identity without mutating input", () => {
    const first = { id: 4, label: "first" };
    const duplicate = { id: 4, label: "duplicate" };
    const second = { id: 2, label: "second" };
    const trailing = { id: 9, label: "trailing" };
    const items = [first, duplicate, second, first, trailing, second];
    const before = [...items];

    const result = uniqueByNumericId(items);

    expect(result).toEqual([first, second, trailing]);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(second);
    expect(result[2]).toBe(trailing);
    expect(result).not.toBe(items);
    expect(items).toStrictEqual(before);
  });

  it("returns a new empty array for empty input", () => {
    const items: { id: number }[] = [];

    const result = uniqueByNumericId(items);

    expect(result).toEqual([]);
    expect(result).not.toBe(items);
  });
});
