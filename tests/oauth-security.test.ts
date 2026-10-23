import { describe, expect, it } from "vitest";
import {
  decodeOAuthState,
  encodeOAuthState,
  isSafeNativeRedirectUri,
  isTrustedFrontendOrigin,
  validateOAuthState,
} from "../server/_core/oauth";
import { CIRCLES_NATIVE_OAUTH_REDIRECT_URI } from "../shared/oauth-redirect-contract";

const redirectUri =
  "https://3000-project.us1.manus.computer/api/oauth/callback";
const frontendOrigin = "https://8081-project.us1.manus.computer";
const nonce = "M4s1a7B9cD2eF5gH8jK0mN3pQ6rT9vW1yZ4_AbCdEfG";
const state = encodeOAuthState({ redirectUri, nonce });

describe("OAuth state security", () => {
  it("uses the Manus base64 JSON wire format and validates its bound nonce", () => {
    expect(decodeOAuthState(state)).toEqual({ redirectUri, nonce });
    expect(
      validateOAuthState(
        state,
        {
          state,
          redirectUri,
          nonce,
          frontendOrigin,
          expiresAt: 10_001,
        },
        10_000,
      ),
    ).toBe(true);
  });

  it("rejects a changed state, nonce, redirect, or expired pending flow", () => {
    const pending = {
      state,
      redirectUri,
      nonce,
      frontendOrigin,
      expiresAt: 10_001,
    };
    const otherState = encodeOAuthState({
      redirectUri,
      nonce: "n4s1a7B9cD2eF5gH8jK0mN3pQ6rT9vW1yZ4_AbCdEfG",
    });

    expect(validateOAuthState(otherState, pending, 10_000)).toBe(false);
    expect(
      validateOAuthState(state, { ...pending, nonce: `${nonce}x` }, 10_000),
    ).toBe(false);
    expect(
      validateOAuthState(
        state,
        { ...pending, redirectUri: "https://evil.example/callback" },
        10_000,
      ),
    ).toBe(false);
    expect(validateOAuthState(state, pending, 10_001)).toBe(false);
  });

  it("accepts only exact configured frontend origins", () => {
    const configured = [frontendOrigin, "https://circles.example.com"];
    expect(isTrustedFrontendOrigin(frontendOrigin, configured)).toBe(true);
    expect(isTrustedFrontendOrigin(`${frontendOrigin}/`, configured)).toBe(
      false,
    );
    expect(isTrustedFrontendOrigin("https://evil.example", configured)).toBe(
      false,
    );
    expect(
      isTrustedFrontendOrigin("https://circles.example.com/login", configured),
    ).toBe(false);
  });

  it("allows only the fixed Circles AuthSession native deep-link callback", () => {
    expect(isSafeNativeRedirectUri(CIRCLES_NATIVE_OAUTH_REDIRECT_URI)).toBe(
      true,
    );
    expect(
      isSafeNativeRedirectUri("manus999999999999999:///oauth/callback"),
    ).toBe(false);
    expect(
      isSafeNativeRedirectUri("manus252278368451773://oauth/callback"),
    ).toBe(false);
    expect(isSafeNativeRedirectUri("otherapp://oauth/callback")).toBe(false);
    expect(isSafeNativeRedirectUri("manus252278368451773://oauth/other")).toBe(
      false,
    );
    expect(
      isSafeNativeRedirectUri(
        "manus252278368451773:///oauth%2Fcallback?next=attacker",
      ),
    ).toBe(false);
  });
});
