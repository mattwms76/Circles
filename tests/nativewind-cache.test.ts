import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareNativeWindWebCache } from "../scripts/prepare-nativewind-cache.cjs";

function withTemporaryDirectory(test: (directory: string) => void) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "circles-css-cache-"),
  );
  try {
    test(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("NativeWind cold-runner web cache", () => {
  it("creates the web stylesheet before Metro's initial scan", () => {
    withTemporaryDirectory((directory) => {
      const cache = path.join(directory, ".cache");
      const stylesheet = prepareNativeWindWebCache(cache);
      expect(stylesheet).toBe(path.join(cache, "web.css"));
      expect(fs.readFileSync(stylesheet, "utf8")).toBe("");
    });
  });

  it("preserves existing compiled CSS on repeated initialization", () => {
    withTemporaryDirectory((directory) => {
      const stylesheet = prepareNativeWindWebCache(directory);
      const compiledCss = "body { scrollbar-width: none; color: #ED604A; }";
      fs.writeFileSync(stylesheet, compiledCss);
      expect(prepareNativeWindWebCache(directory)).toBe(stylesheet);
      expect(fs.readFileSync(stylesheet, "utf8")).toBe(compiledCss);
    });
  });

  it("does not hide genuine filesystem failures", () => {
    withTemporaryDirectory((directory) => {
      const file = path.join(directory, "not-a-directory");
      fs.writeFileSync(file, "fixture");
      expect(() => prepareNativeWindWebCache(file)).toThrow();
    });
  });
});
