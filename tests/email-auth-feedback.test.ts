import { describe, expect, it } from "vitest";
import {
  emailAuthFormFailure,
  emailAuthInputError,
} from "../lib/email-auth-feedback";

describe("account creation feedback", () => {
  it("validates registration input without rejecting existing shorter sign-in passwords", () => {
    expect(emailAuthInputError("", "", true)).toContain("Enter your email");
    expect(emailAuthInputError("not-an-email", "password", true)).toBe(
      "Enter a valid email address.",
    );
    expect(emailAuthInputError("person@example.test", "short", true)).toContain(
      "8 characters",
    );
    expect(
      emailAuthInputError("person@example.test", "short", false),
    ).toBeNull();
    expect(
      emailAuthInputError(" person@example.test ", " long password ", true),
    ).toBeNull();
    expect(
      emailAuthInputError("person@example.test", "x".repeat(1025), true),
    ).toContain("too long");
  });

  it("shows bounded delivery and rate errors without exposing upstream details", () => {
    expect(
      emailAuthFormFailure(
        { code: "email_auth_delivery_unavailable", message: "secret" },
        true,
      ),
    ).toContain("Account emails are unavailable");
    expect(
      emailAuthFormFailure({ code: "email_auth_rate_limited" }, true),
    ).toContain("Please wait");
    expect(
      emailAuthFormFailure(new Error("secret provider response"), true),
    ).toBe("We couldn't create that account. Please try again.");
    expect(
      emailAuthFormFailure({ code: "toString", message: "secret" }, true),
    ).not.toContain("secret");
  });
});
