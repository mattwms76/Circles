const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const { createPreviewApiProxy } = require("./scripts/preview-api-proxy.cjs");
const {
  prepareNativeWindWebCache,
} = require("./scripts/prepare-nativewind-cache.cjs");

// Ensure a cold, non-watching CI file map includes NativeWind's generated web stylesheet.
prepareNativeWindWebCache();

const config = getDefaultConfig(__dirname);

// A new Metro start must not reuse transforms from an older scope-helper API.
// This is read at startup; a stale running file map still needs a --clear restart.
const scopeHelperSource = readFileSync(
  join(__dirname, "lib", "batch3-account-resource-scope.ts"),
);
const scopeHelperHash = createHash("sha256")
  .update(scopeHelperSource)
  .digest("hex");
config.cacheVersion = `${config.cacheVersion ?? ""}:account-resource-scope:${scopeHelperHash}`;

const previousEnhanceMiddleware = config.server.enhanceMiddleware;
const proxyApi = createPreviewApiProxy();

config.server.enhanceMiddleware = (middleware, server) => {
  const next = previousEnhanceMiddleware
    ? previousEnhanceMiddleware(middleware, server)
    : middleware;
  return (req, res, nextHandler) => {
    proxyApi(req, res, () => next(req, res, nextHandler));
  };
};

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Expo's current Metro expects file-map change metadata that NativeWind's
  // virtual-module emitter does not supply. Use its supported disk output.
  forceWriteFileSystem: true,
});
