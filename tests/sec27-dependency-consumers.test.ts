import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const rootRequire = createRequire(`${process.cwd()}/package.json`);

function packageRoot(packageName: string): string {
  let directory = dirname(rootRequire.resolve(packageName));
  while (true) {
    const manifest = join(directory, "package.json");
    if (
      existsSync(manifest) &&
      JSON.parse(readFileSync(manifest, "utf8")).name === packageName
    ) {
      return directory;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not locate package root for ${packageName}`);
    }
    directory = parent;
  }
}

function packageVersion(packageName: string): string {
  return JSON.parse(
    readFileSync(join(packageRoot(packageName), "package.json"), "utf8"),
  ).version as string;
}

function requireFromPackage(packageName: string) {
  return createRequire(join(packageRoot(packageName), "package.json"));
}

describe("SEC-027 dependency consumers", () => {
  it("SEC-001 resolves the direct Zod runtime at or above the vendor fixed floor", () => {
    const zod = rootRequire("zod") as {
      z: { array(schema: unknown): { max(size: number): unknown } };
      string(): unknown;
    };

    expect(packageVersion("zod")).toMatch(/^4\.6\.[6-9]\d*$/);
    expect(zod.z.array(zod.string()).max(1)).toBeDefined();
  });

  it("SEC-029 keeps Expo 57's structured-clone consumer importable at the maintained 1.4 line", () => {
    const expoRequire = requireFromPackage("expo");
    const structuredClone = expoRequire("@ungap/structured-clone") as {
      default(value: unknown): unknown;
    };

    expect(packageVersion("@ungap/structured-clone")).toBe("1.4.0");
    expect(structuredClone.default({ nested: [1, 2] })).toEqual({
      nested: [1, 2],
    });
  });

  it("SEC-030 keeps the Expo flat configuration executable on the final ESLint 9 patch", async () => {
    const { ESLint } = rootRequire("eslint") as {
      ESLint: new (options: { cwd: string; overrideConfigFile: string }) => {
        lintText(
          code: string,
          options: { filePath: string },
        ): Promise<{ fatalErrorCount: number }[]>;
      };
    };
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: "eslint.config.mjs",
    });

    expect(packageVersion("eslint")).toBe("9.39.5");
    await expect(
      eslint.lintText("export const sec27 = true;\n", {
        filePath: "tests/sec27-eslint-fixture.ts",
      }),
    ).resolves.toMatchObject([{ fatalErrorCount: 0 }]);
  });

  it("SEC-007's server-only sharp dependency imports and structurally decodes a bounded PNG", async () => {
    const sharp = (await import("sharp")).default;
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1nQAAAABJRU5ErkJggg==",
      "base64",
    );

    expect(packageVersion("sharp")).toBe("0.35.5");
    await expect(
      sharp(onePixelPng, { limitInputPixels: 4 }).metadata(),
    ).resolves.toMatchObject({
      format: "png",
      width: 1,
      height: 1,
    });
  });
});
