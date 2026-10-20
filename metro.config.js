const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const { createPreviewApiProxy } = require("./scripts/preview-api-proxy.cjs");

const config = getDefaultConfig(__dirname);
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
});
