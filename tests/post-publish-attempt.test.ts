import { describe, expect, it, vi } from "vitest";
import {
  createPostPublishAttemptTracker,
  isDefinitivePostPublishError,
} from "../lib/post-publish-attempt";
const payload = {
  text: " caption ",
  media: "/manus-storage/exact.mp4.enc",
  mediaType: "video" as const,
  circleId: 7,
};
describe("composer post publication attempts", () => {
  it("retries canonical payload with the exact operation ID after ambiguous delivery", () => {
    const tracker = createPostPublishAttemptTracker();
    const id = vi.fn(() => "123e4567-e89b-42d3-a456-426614174000");
    const first = tracker.prepare(payload, id);
    tracker.markSubmitted();
    expect(tracker.prepare({ ...payload, text: "caption" }, id)).toBe(first);
    expect(id).toHaveBeenCalledTimes(1);
    expect(tracker.isUnsettled()).toBe(true);
  });
  it.each([
    { text: "different" },
    { circleId: 8 },
    { media: "another" },
    { mediaType: "photo" as const },
  ])("blocks modified unsettled payload %j", (change) => {
    const tracker = createPostPublishAttemptTracker();
    tracker.prepare(payload, () => "id");
    tracker.markSubmitted();
    expect(() =>
      tracker.prepare({ ...payload, ...change }, () => "next"),
    ).toThrow("Retry");
  });
  it("permits a fresh ID after definitive settlement and keeps account instances independent", () => {
    const first = createPostPublishAttemptTracker();
    const second = createPostPublishAttemptTracker();
    first.prepare(payload, () => "first");
    first.markSubmitted();
    first.clear();
    expect(
      first.prepare({ ...payload, text: "new" }, () => "next").clientPublishId,
    ).toBe("next");
    expect(second.prepare(payload, () => "account-two").clientPublishId).toBe(
      "account-two",
    );
  });
  it("retains the same ID on unchanged Retry after definitive rejection, including a deletion tombstone", () => {
    const tracker = createPostPublishAttemptTracker();
    const id = vi.fn(() => "original");
    const original = tracker.prepare(payload, id);
    tracker.markSubmitted();
    tracker.reject();
    expect(tracker.isUnsettled()).toBe(false);
    expect(tracker.prepare(payload, id)).toBe(original);
    expect(id).toHaveBeenCalledTimes(1);
    expect(
      tracker.prepare(
        { ...payload, text: "deliberate new content" },
        () => "new",
      ).clientPublishId,
    ).toBe("new");
  });
  it("fails closed when secure ID generation fails, without manufacturing an ID", () => {
    const tracker = createPostPublishAttemptTracker();
    expect(() =>
      tracker.prepare(payload, () => {
        throw new Error("crypto unavailable");
      }),
    ).toThrow();
    expect(tracker.isUnsettled()).toBe(false);
  });
  it("distinguishes definitive API rejection from unknown/transport/server outcomes", () => {
    expect(isDefinitivePostPublishError({ data: { code: "FORBIDDEN" } })).toBe(
      true,
    );
    expect(
      isDefinitivePostPublishError({ data: { code: "PRECONDITION_FAILED" } }),
    ).toBe(true);
    expect(
      isDefinitivePostPublishError({ data: { code: "INTERNAL_SERVER_ERROR" } }),
    ).toBe(false);
    expect(isDefinitivePostPublishError(new Error("network timeout"))).toBe(
      false,
    );
  });
});
