import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPostReaction, mergeUniquePage } from "../src/lib/feedState.ts";
test("A circle-only post can update and roll back independently of the home feed", () => {
  const post = { id: "circle-only", liked: false, likes: 3 };
  const circle = [post];
  const profile = [post];
  const home = [{ id: "another", liked: true, likes: 1 }];
  assert.deepEqual(applyPostReaction(home, post.id, true, 4), home);
  assert.equal(applyPostReaction(circle, post.id, true, 4)[0].liked, true);
  assert.equal(applyPostReaction(profile, post.id, true, 4)[0].likes, 4);
  assert.deepEqual(
    applyPostReaction(
      applyPostReaction(circle, post.id, true, 4),
      post.id,
      false,
      3,
    ),
    circle,
  );
  assert.equal(
    post.likes,
    3,
    "Optimistic updates must not mutate the original rollback snapshot",
  );
});
test("Pagination de-duplicates overlap while preserving server ordering", () => {
  assert.deepEqual(
    mergeUniquePage(
      [{ id: "a" }],
      [{ id: "a" }, { id: "b" }, { id: "b" }, { id: "c" }],
    ).map((item) => item.id),
    ["a", "b", "c"],
  );
});
