import { afterEach, describe, expect, it } from "vitest";
import { normalizeCirclePrompt } from "../server/circle-prompt";
import { isExpoPushToken } from "../server/device-push";
import { isPrivateMediaKey } from "../server/private-media-store";
import {
  forgeStorageIsConfigured,
  privateMediaStoreActive,
} from "../server/storage";

const priorPrivateStore = process.env.CIRCLES_PRIVATE_MEDIA_STORE;

afterEach(() => {
  if (priorPrivateStore === undefined) {
    delete process.env.CIRCLES_PRIVATE_MEDIA_STORE;
  } else {
    process.env.CIRCLES_PRIVATE_MEDIA_STORE = priorPrivateStore;
  }
});

describe("member feature guards", () => {
  it("normalizes one circle prompt and rejects an overlong body", () => {
    expect(normalizeCirclePrompt("  hello \n circle  ")).toBe("hello circle");
    expect(normalizeCirclePrompt("   ")).toBe("");
    expect(() => normalizeCirclePrompt("a".repeat(181))).toThrow(
      /too long/,
    );
  });

  it("accepts only Expo push tokens", () => {
    expect(isExpoPushToken("ExponentPushToken[abc_def-1234]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc_def-1234]")).toBe(true);
    expect(isExpoPushToken("ExponentPushToken[short]")).toBe(false);
    expect(isExpoPushToken("https://exp.host/token")).toBe(false);
  });

  it("accepts a private media key and rejects traversal", () => {
    expect(
      isPrivateMediaKey(
        "social-encrypted/7/123e4567-e89b-42d3-a456-426614174000.jpg.enc",
      ),
    ).toBe(true);
    expect(isPrivateMediaKey("../secret")).toBe(false);
    expect(isPrivateMediaKey("")).toBe(false);
  });

  it("uses the private media table only when Forge is absent and the store is selected", () => {
    process.env.CIRCLES_PRIVATE_MEDIA_STORE = "database";
    expect(privateMediaStoreActive()).toBe(!forgeStorageIsConfigured());
    process.env.CIRCLES_PRIVATE_MEDIA_STORE = "";
    expect(privateMediaStoreActive()).toBe(false);
  });
});
