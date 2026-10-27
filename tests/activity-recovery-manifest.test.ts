import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

describe("current Activity Inbox recovery manifests", () => {
  it("loads the actual example and packaged template against the reviewed 31-query inventory", async () => {
    const root = process.cwd();
    const recovery = await import(
      pathToFileURL(path.join(root, "scripts/recover-api.mjs")).href
    );
    const inventory = recovery.deriveEndpointInventory(root);
    expect(inventory.endpoints).toHaveLength(31);
    expect(
      inventory.endpoints.every(
        (endpoint: { supported: boolean }) => endpoint.supported,
      ),
    ).toBe(true);
    for (const relative of [
      "examples/recover-api.manifest.json",
      "skills/expo-trpc-recovery-security/templates/recover-api.manifest.json",
    ]) {
      const overrides = recovery.loadEndpointManifest(
        path.join(root, relative),
        inventory,
      );
      for (const name of [
        "activity.list",
        "activity.unreadCount",
        "activity.preferences",
        "activity.resolveTarget",
      ]) {
        expect(overrides[name]).toEqual({ input: {} });
      }
      expect(overrides["social.publicationStatus"]).toEqual({ input: {} });
    }
  });
});
