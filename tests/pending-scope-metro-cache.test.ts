import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const metroSource = readFileSync("metro.config.js", "utf8");
const helperSource = readFileSync(
  "lib/batch3-account-resource-scope.ts",
  "utf8",
);

type Middleware = (
  request: unknown,
  response: unknown,
  next: () => void,
) => void;
type FixtureConfig = {
  cacheVersion?: string;
  server: {
    enhanceMiddleware?: (middleware: Middleware, server: unknown) => Middleware;
  };
};

// Executes the actual config file. Expo/NativeWind/proxy/filesystem adapters are
// deliberately mocked; this does not claim a Metro restart or browser recovery.
function evaluateConfig(source: string, baseVersion?: string) {
  const middleware = vi.fn<Middleware>();
  const enhanced = vi.fn<Middleware>();
  const previousEnhance = vi.fn(() => enhanced);
  const config: FixtureConfig = {
    cacheVersion: baseVersion,
    server: { enhanceMiddleware: previousEnhance },
  };
  const prepareCache = vi.fn();
  const proxy = vi.fn<Middleware>((_request, _response, next) => next());
  const readHelper = vi.fn((filename: string) => {
    expect(filename).toBe(
      join("/fixture/circles", "lib", "batch3-account-resource-scope.ts"),
    );
    return Buffer.from(source);
  });
  const nativeWind = vi.fn((input: FixtureConfig) => input);
  const exported: { exports: FixtureConfig | null } = { exports: null };

  runInNewContext(
    metroSource,
    {
      __dirname: "/fixture/circles",
      Buffer,
      module: exported,
      require(specifier: string) {
        switch (specifier) {
          case "node:crypto":
            return { createHash };
          case "node:fs":
            return { readFileSync: readHelper };
          case "node:path":
            return { join };
          case "expo/metro-config":
            return { getDefaultConfig: () => config };
          case "nativewind/metro":
            return { withNativeWind: nativeWind };
          case "./scripts/preview-api-proxy.cjs":
            return { createPreviewApiProxy: () => proxy };
          case "./scripts/prepare-nativewind-cache.cjs":
            return { prepareNativeWindWebCache: prepareCache };
          default:
            throw new Error("Unexpected config dependency");
        }
      },
    },
    { timeout: 1000 },
  );

  expect(exported.exports).toBe(config);
  return {
    config,
    prepareCache,
    readHelper,
    nativeWind,
    middleware,
    enhanced,
    previousEnhance,
    proxy,
  };
}

describe("pending-scope helper Metro cache namespace", () => {
  it("keys the namespace to the actual helper source and retains Expo's version", () => {
    const { config, readHelper } = evaluateConfig(helperSource, "expo-base");
    const digest = createHash("sha256").update(helperSource).digest("hex");
    expect(config.cacheVersion).toBe(
      `expo-base:account-resource-scope:${digest}`,
    );
    expect(readHelper).toHaveBeenCalledOnce();
  });

  it("changes the key when the helper export API changes", () => {
    const oldHelper = "export function batch3AccountResourceScope() {}";
    const before = evaluateConfig(oldHelper).config.cacheVersion;
    const after = evaluateConfig(helperSource).config.cacheVersion;
    expect(after).not.toBe(before);
  });

  it("is stable for identical source and does not include an undefined prefix", () => {
    const first = evaluateConfig(helperSource).config.cacheVersion;
    expect(first).toBe(evaluateConfig(helperSource).config.cacheVersion);
    expect(first).toMatch(/^:account-resource-scope:[a-f0-9]{64}$/);
  });

  it("preserves disk-backed NativeWind setup and its web stylesheet", () => {
    const { config, prepareCache, nativeWind } = evaluateConfig(helperSource);
    expect(prepareCache).toHaveBeenCalledOnce();
    expect(nativeWind).toHaveBeenCalledWith(config, {
      input: "./global.css",
      forceWriteFileSystem: true,
    });
  });

  it("keeps API proxy dispatch ahead of Expo's enhanced middleware", () => {
    const { config, middleware, enhanced, previousEnhance, proxy } =
      evaluateConfig(helperSource);
    const server = {};
    const handle = config.server.enhanceMiddleware!(middleware, server);
    const request = {};
    const response = {};
    const next = vi.fn();
    handle(request, response, next);
    expect(previousEnhance).toHaveBeenCalledWith(middleware, server);
    expect(proxy).toHaveBeenCalledOnce();
    expect(enhanced).toHaveBeenCalledWith(request, response, next);
    expect(middleware).not.toHaveBeenCalled();
  });
});
