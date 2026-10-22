import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import { socialRouter } from "../server/social-router";
import {
  isAllowedMediaAttachmentReference,
  managedSocialMediaKeyFromUrl,
  managedSocialMediaUrlForKey,
  requiresNativeMediaAuthorization,
  resolveMediaUrlForRenderer,
} from "../shared/media";

const canonicalKey =
  "social-encrypted/17/123e4567-e89b-42d3-a456-426614174000.jpg.enc";
const canonicalUrl = `/manus-storage/${canonicalKey}`;
const hostileOriginUrl = `https://attacker.example/manus-storage/${canonicalKey}`;

function authenticatedMediaFixtureContext(): TrpcContext {
  const now = new Date("2026-10-22T00:00:00.000Z");
  return {
    user: {
      id: 17,
      openId: "synthetic-media-owner",
      name: "Synthetic media owner",
      email: null,
      loginMethod: "test",
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("MED-001 canonical managed-media references", () => {
  it("accepts only the exact relative encrypted upload path shape", () => {
    expect(managedSocialMediaKeyFromUrl(canonicalUrl)).toBe(canonicalKey);
    expect(managedSocialMediaUrlForKey(canonicalKey)).toBe(canonicalUrl);
    expect(isAllowedMediaAttachmentReference(canonicalUrl)).toBe(true);

    expect(managedSocialMediaKeyFromUrl(hostileOriginUrl)).toBeNull();
    expect(
      managedSocialMediaKeyFromUrl(
        `//attacker.example/manus-storage/${canonicalKey}`,
      ),
    ).toBeNull();
    expect(
      managedSocialMediaKeyFromUrl(
        "/manus-storage/social-encrypted/17/%2e%2e/123e4567-e89b-42d3-a456-426614174000.jpg.enc",
      ),
    ).toBeNull();
    expect(
      managedSocialMediaKeyFromUrl(`${canonicalUrl}?redirect=attacker`),
    ).toBeNull();
  });

  it("rejects a hostile absolute origin at the attachment-bearing post mutation boundary", async () => {
    const caller = socialRouter.createCaller(
      authenticatedMediaFixtureContext(),
    );

    await expect(
      caller.createPost({
        text: "Synthetic hostile-origin regression",
        media: hostileOriginUrl,
        mediaType: "photo",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not proxy hostile origins or attach native authorization while rendering", () => {
    const rendererOptions = {
      isWeb: false,
      apiBaseUrl: "https://api.example",
      apiRequestUrl: (path: string) => `https://api.example${path}`,
    };

    expect(resolveMediaUrlForRenderer(hostileOriginUrl, rendererOptions)).toBe(
      "",
    );
    expect(requiresNativeMediaAuthorization(hostileOriginUrl, false)).toBe(
      false,
    );

    expect(resolveMediaUrlForRenderer(canonicalUrl, rendererOptions)).toBe(
      `https://api.example/api/media/${canonicalKey}`,
    );
    expect(requiresNativeMediaAuthorization(canonicalUrl, false)).toBe(true);
  });
});
