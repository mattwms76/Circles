import { describe, expect, it } from "vitest";
import {
  CIRCLES_NATIVE_BUNDLE_ID,
  CIRCLES_NATIVE_OAUTH_CALLBACK_PATH,
  CIRCLES_NATIVE_OAUTH_REDIRECT_URI,
  CIRCLES_NATIVE_OAUTH_SCHEME,
  isCirclesNativeOAuthRedirectUri,
} from "../shared/oauth-redirect-contract";

describe("Circles native OAuth redirect contract", () => {
  it("keeps the immutable bundle-derived scheme and AuthSession callback aligned", () => {
    expect(CIRCLES_NATIVE_BUNDLE_ID).toBe(
      "space.manus.circles.t252278368451773",
    );
    expect(CIRCLES_NATIVE_OAUTH_SCHEME).toBe("manus252278368451773");
    expect(CIRCLES_NATIVE_OAUTH_CALLBACK_PATH).toBe("/oauth/callback");
    expect(CIRCLES_NATIVE_OAUTH_REDIRECT_URI).toBe(
      "manus252278368451773:///oauth/callback",
    );
    expect(
      isCirclesNativeOAuthRedirectUri(CIRCLES_NATIVE_OAUTH_REDIRECT_URI),
    ).toBe(true);
  });

  it("rejects scheme, authority, path, encoding, and URL-component aliases", () => {
    for (const candidate of [
      "manus999999999999999:///oauth/callback",
      "manus252278368451773://oauth/callback",
      "manus252278368451773:///oauth/other",
      "manus252278368451773:///oauth%2Fcallback",
      "manus252278368451773:///oauth%2ecallback",
      "manus252278368451773:///oauth/./callback",
      "manus252278368451773:///oauth/callback?next=attacker",
      "manus252278368451773:///oauth/callback#fragment",
      "manus252278368451773://user@oauth/callback",
      "manus252278368451773://oauth:443/callback",
      "otherapp:///oauth/callback",
    ]) {
      expect(isCirclesNativeOAuthRedirectUri(candidate)).toBe(false);
    }
  });
});
