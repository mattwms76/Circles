import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mediaFallbackIdentity } from "../lib/media-fallback";

const mediaImage = readFileSync("components/media-image.tsx", "utf8");

describe("media fallback identity and protected-source seams", () => {
  it("keys fallback state by account and source without retaining raw signed URLs or headers", () => {
    const signedUrl =
      "https://images.example/avatar.png?signature=private-value";
    const first = mediaFallbackIdentity({
      accountId: 7,
      source: {
        uri: signedUrl,
        headers: { Authorization: "Bearer never-store-this" },
      },
      resolvedUri: signedUrl,
    });
    const secondAccount = mediaFallbackIdentity({
      accountId: 8,
      source: { uri: signedUrl },
      resolvedUri: signedUrl,
    });
    const secondSource = mediaFallbackIdentity({
      accountId: 7,
      source: { uri: "https://images.example/other.png" },
      resolvedUri: "https://images.example/other.png",
    });

    expect(first).not.toContain("private-value");
    expect(first).not.toContain("never-store-this");
    expect(first).not.toContain("Authorization");
    expect(secondAccount).not.toBe(first);
    expect(secondSource).not.toBe(first);
  });

  it("retains numeric and array source distinctions alongside scoped URI authorization", () => {
    const asset = mediaFallbackIdentity({
      accountId: 7,
      source: 12,
      resolvedUri: "",
    });
    const sources = mediaFallbackIdentity({
      accountId: 7,
      source: [12, { uri: "https://images.example/two.png" }],
      resolvedUri: "",
    });
    expect(asset).toContain("asset:12");
    expect(sources).toContain("sources:asset:12");
  });

  it("keeps protected native bearer-pending media idle, forwards caller errors, and renders a deterministic fallback after real errors", () => {
    expect(mediaImage).toContain("if (!token) return null");
    expect(mediaImage).toContain(
      "source = resolved ? { ...original, ...resolved } : null",
    );
    expect(mediaImage).toContain("if (failed && source !== null)");
    expect(mediaImage).toContain("onError?.(event);");
    expect(mediaImage).toContain("key={fallbackIdentity}");
    expect(mediaImage).toContain(
      "fallback ?? <View style={styles.neutralFallback} />",
    );
    expect(mediaImage).toContain(
      "accessibilityLabel={props.accessibilityLabel}",
    );
    expect(mediaImage).toContain(
      "style={[styles.fallback, style as unknown as ViewStyle]}",
    );
  });

  it("keeps Avatar initials as the explicit fallback instead of the generic neutral placeholder", () => {
    const ui = readFileSync("components/circles-ui.tsx", "utf8");
    expect(ui).toContain("fallback={");
    expect(ui).toContain('{name.slice(0, 1).toUpperCase() || "C"}');
    expect(ui).toContain("backgroundColor: C.sage");
  });
});
