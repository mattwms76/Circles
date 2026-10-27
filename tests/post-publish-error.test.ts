import { describe, expect, it } from "vitest";
import { postPublishErrorMessage } from "../lib/post-publish-error";
describe("post publication safe feedback", () => {
  it("does not expose unknown database, native path, token or transport details", () => {
    const privateFailure = new Error(
      "postgres://private-password@host file:///private/account SECRET_TOKEN",
    );
    expect(postPublishErrorMessage(privateFailure)).toBe(
      "Could not share. Your draft is still here. Please try again.",
    );
  });
  it("retains fixed unsupported MP4 validation guidance", () => {
    const message = "This video must use H.264 video with AAC audio.";
    expect(postPublishErrorMessage(new Error(message))).toBe(message);
  });
  it("gives feature-safe missing-migration copy and permission recovery", () => {
    expect(
      postPublishErrorMessage({ data: { code: "PRECONDITION_FAILED" } }),
    ).toContain("Retry-safe publishing is temporarily unavailable");
    expect(postPublishErrorMessage({ data: { code: "FORBIDDEN" } })).toContain(
      "Choose another audience",
    );
  });
});
