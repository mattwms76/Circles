import { describe, expect, it } from "vitest";

type Candidate = {
  userId: number;
  alreadyFollowed: boolean;
  distinctInterestOverlap: number;
  distinctTwoHopIntermediaries: number;
};

/** Reference contract for the SQL-backed rank; private inputs are never a public DTO. */
function rank(candidates: readonly Candidate[]): number[] {
  return [...candidates]
    .sort((left, right) => {
      const followed =
        Number(left.alreadyFollowed) - Number(right.alreadyFollowed);
      if (followed) return followed;
      const leftScore =
        100 * left.distinctInterestOverlap +
        10 * Math.min(left.distinctTwoHopIntermediaries, 9);
      const rightScore =
        100 * right.distinctInterestOverlap +
        10 * Math.min(right.distinctTwoHopIntermediaries, 9);
      return rightScore - leftScore || left.userId - right.userId;
    })
    .map((candidate) => candidate.userId);
}

describe("People recommendation rank contract", () => {
  it("uses exact distinct-overlap and capped two-hop weighting before numeric ID ties", () => {
    expect(
      rank([
        {
          userId: 8,
          alreadyFollowed: false,
          distinctInterestOverlap: 0,
          distinctTwoHopIntermediaries: 12,
        },
        {
          userId: 9,
          alreadyFollowed: false,
          distinctInterestOverlap: 1,
          distinctTwoHopIntermediaries: 1,
        },
        {
          userId: 6,
          alreadyFollowed: false,
          distinctInterestOverlap: 1,
          distinctTwoHopIntermediaries: 0,
        },
        {
          userId: 11,
          alreadyFollowed: false,
          distinctInterestOverlap: 1,
          distinctTwoHopIntermediaries: 0,
        },
      ]),
    ).toEqual([9, 6, 11, 8]);
  });

  it("keeps already-followed people as a deterministic lower-priority fallback", () => {
    expect(
      rank([
        {
          userId: 2,
          alreadyFollowed: false,
          distinctInterestOverlap: 0,
          distinctTwoHopIntermediaries: 0,
        },
        {
          userId: 7,
          alreadyFollowed: true,
          distinctInterestOverlap: 2,
          distinctTwoHopIntermediaries: 9,
        },
      ]),
    ).toEqual([2, 7]);
  });
});
