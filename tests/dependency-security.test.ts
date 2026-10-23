import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const rootRequire = createRequire(`${process.cwd()}/package.json`);

function requireFromPackage(fromPackage: string) {
  let directory = dirname(rootRequire.resolve(fromPackage));
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not locate package root for ${fromPackage}`);
    }
    directory = parent;
  }
  return createRequire(join(directory, "package.json"));
}

function packageVersion(fromPackage: string, packageName: string): string {
  const parentRequire = requireFromPackage(fromPackage);
  return parentRequire(`${packageName}/package.json`).version as string;
}

function atLeast(version: string, floor: [number, number, number]): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  return (
    parts[0] > floor[0] ||
    (parts[0] === floor[0] && parts[1] > floor[1]) ||
    (parts[0] === floor[0] && parts[1] === floor[1] && parts[2] >= floor[2])
  );
}

function sourceMapSources(map: string | { sources: string[] }): string[] {
  return (typeof map === "string" ? JSON.parse(map) : map).sources;
}

describe("dependency security resolutions", () => {
  it("keeps the distinct ws major lines at their supported patched floors", () => {
    expect(packageVersion("@expo/cli", "ws")).toBe("8.21.0");
    expect(packageVersion("react-native", "ws")).toBe("7.5.11");
  });

  it("uses the patched esbuild API through the deprecated core-utils consumer", async () => {
    const coreUtilsRequire = requireFromPackage("@esbuild-kit/core-utils");
    const coreUtils = coreUtilsRequire("@esbuild-kit/core-utils") as {
      transform(
        source: string,
        sourcefile: string,
      ): Promise<{ code: string; map: string | { sources: string[] } }>;
      transformSync(
        source: string,
        sourcefile: string,
      ): { code: string; map: string | { sources: string[] } };
    };

    expect(packageVersion("@esbuild-kit/core-utils", "esbuild")).toBe(
      "0.25.12",
    );

    const source = "export const answer: number = 42;";
    const sync = coreUtils.transformSync(source, "synthetic.ts");
    const async = await coreUtils.transform(source, "synthetic.ts");
    expect(sync.code).toContain("answer");
    expect(async.code).toContain("answer");
    expect(sourceMapSources(sync.map)).toContain("synthetic.ts");
    expect(sourceMapSources(async.map)).toContain("synthetic.ts");
  });

  it("loads patched uuid 13 through the Node 22 CommonJS Expo and xcode consumers", () => {
    for (const consumer of ["@expo/ngrok", "xcode"]) {
      const consumerRequire = requireFromPackage(consumer);
      const uuid = consumerRequire("uuid") as {
        v4(): string;
        validate(value: string): boolean;
      };
      const value = uuid.v4();
      expect(packageVersion(consumer, "uuid")).toBe("13.0.1");
      expect(uuid.validate(value)).toBe(true);
    }

    expect(() => rootRequire("@expo/ngrok")).not.toThrow();
    expect(() => rootRequire("xcode")).not.toThrow();
  });

  it("uses selector-parser 7 in the NativeWind stylesheet build consumers", async () => {
    const postcss = rootRequire("postcss") as any;
    const nestedRequire = requireFromPackage("postcss-nested");
    const nested = nestedRequire("postcss-nested") as () => unknown;
    const nestedResult = await postcss([nested()]).process(
      ".parent { & .child, &:hover { color: red; } }",
      { from: undefined },
    );
    expect(packageVersion("postcss-nested", "postcss-selector-parser")).toBe(
      "7.1.6",
    );
    expect(packageVersion("tailwindcss", "postcss-selector-parser")).toBe(
      "7.1.6",
    );
    expect(nestedResult.css).toContain(".parent .child");

    const tailwindcss = rootRequire("tailwindcss") as (
      config: object,
    ) => unknown;
    const nativewindPreset = rootRequire("nativewind/preset");
    const build = await postcss([
      tailwindcss({
        content: [{ raw: '<View className="p-2" />', extension: "tsx" }],
        presets: [nativewindPreset],
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    expect(build.css).toContain(".p-2");
  });

  it("keeps the unsupported decode parent on its known malformed-URL behavior", () => {
    const queryString = rootRequire("query-string") as {
      parse(value: string): Record<string, string>;
    };
    expect(packageVersion("query-string", "decode-uri-component")).toBe(
      "0.2.2",
    );
    expect(queryString.parse("url=%E0%A4%A&ok=yes")).toEqual({
      ok: "yes",
      url: "%E0%A4%A",
    });
  });

  it("uses the supported Expo plist and signing-toolchain backports", () => {
    expect(packageVersion("@expo/plist", "@xmldom/xmldom")).toBe("0.8.15");
    expect(packageVersion("@expo/cli", "node-forge")).toBe("1.4.0");
    expect(
      atLeast(rootRequire("mysql2/package.json").version, [3, 23, 1]),
    ).toBe(true);
  });

  it("round-trips a synthetic plist and handles malformed synthetic input deterministically", () => {
    const plist = rootRequire("@expo/plist").default as {
      build(value: Record<string, unknown>): string;
      parse(value: string): unknown;
    };
    const xml = plist.build({ enabled: true, label: "synthetic" });
    expect(plist.parse(xml)).toEqual({ enabled: true, label: "synthetic" });
    expect(
      plist.parse(
        "<plist><dict><key>label</key><string>unterminated</dict></plist>",
      ),
    ).toEqual({ label: "" });
  });

  it("uses ephemeral synthetic certificates and rejects a corrupted signature", () => {
    const expoCliRequire = createRequire(
      rootRequire.resolve("@expo/cli/package.json"),
    );
    const forge = expoCliRequire("node-forge") as any;
    // This short key exists only in memory for a consumer compatibility check.
    const keyPair = forge.pki.rsa.generateKeyPair({ bits: 512, e: 0x10001 });
    const certificate = forge.pki.createCertificate();
    certificate.publicKey = keyPair.publicKey;
    certificate.serialNumber = "01";
    certificate.validity.notBefore = new Date(0);
    certificate.validity.notAfter = new Date(86_400_000);
    certificate.setSubject([
      { name: "commonName", value: "synthetic.invalid" },
    ]);
    certificate.setIssuer(certificate.subject.attributes);
    certificate.sign(keyPair.privateKey, forge.md.sha256.create());

    const pem = forge.pki.certificateToPem(certificate);
    const parsed = forge.pki.certificateFromPem(pem);
    expect(parsed.verify(parsed)).toBe(true);

    const corrupted = forge.pki.certificateFromPem(pem);
    const signature = corrupted.signature;
    corrupted.signature = `${signature.slice(0, -1)}${
      signature.endsWith("A") ? "B" : "A"
    }`;
    let accepted = false;
    try {
      accepted = corrupted.verify(corrupted) === true;
    } catch {
      accepted = false;
    }
    expect(accepted).toBe(false);
  });
});
