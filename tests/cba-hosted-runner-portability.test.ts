import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runners = [
  { suite: "CBA-02", path: "e2e/cba02-upload-claim-race.runner.mjs" },
  { suite: "CBA-04", path: "e2e/cba04-live-chat-bounds.runner.mjs" },
  { suite: "CBA-06", path: "e2e/cba06-media-upload-budget.runner.mjs" },
] as const;

describe("hosted CBA runner portability", () => {
  it.each(runners)(
    "$suite uses the invoking Node 22.23.4 executable with a bounded fixture PATH",
    async ({ suite, path }) => {
      const source = await readFile(resolve(process.cwd(), path), "utf8");

      expect(source).toContain("const NODE = process.execPath;");
      expect(source).toContain("const NODE_BIN = dirname(NODE);");
      expect(source).toContain("PATH: `${NODE_BIN}:${PG_BIN}:/usr/bin:/bin`,");
      expect(source).toContain(
        `if (process.versions.node !== "22.23.4")\n      fail("${suite} requires Node 22.23.4");`,
      );
      expect(source).not.toContain("/home/ubuntu/.nvm/versions/node/");
    },
  );
});
