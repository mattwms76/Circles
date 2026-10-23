import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("pins one validated address family while retaining signer-host TLS verification", () => {
  const source = readFileSync(
    new URL("../server/_core/voiceTranscription.ts", import.meta.url),
    "utf8",
  );
  expect(source).toContain("lookup: createPinnedManagedStorageLookup(target)");
  expect(source).toContain("family: target.family");
  expect(source).toContain("servername: target.hostname");
  expect(source).toContain("rejectUnauthorized: true");
});
