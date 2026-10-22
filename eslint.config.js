// https://docs.expo.dev/guides/using-eslint/
import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  expoConfig,
  {
    // This is a stored Host MCP function body, not a JavaScript module. Its top-level
    // `return` is valid only when the Host evaluates the body.
    // Expo creates router declarations under .expo; they are generated, not source.
    ignores: ["dist/*", ".expo/**", "scripts/design-audit-workflow.js"],
  },
  {
    // CORS is Node-only server code. It deliberately reads from a fixed allow-list of
    // runtime environment names, which cannot be expressed as Expo's static access.
    files: ["server/_core/cors.ts"],
    rules: {
      "expo/no-dynamic-env-var": "off",
    },
  },
]);
