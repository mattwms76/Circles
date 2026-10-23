import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_CONTRACT,
  validateEnvironment,
} from "../scripts/check-env.mjs";

import { loadTurnConfiguration } from "../server/turn-config";

describe("production relay environment contract", () => {
  it("documents relay server names without making CI need credentials", () => {
    expect(ENVIRONMENT_CONTRACT.sourceNames).toContain("TURN_SERVER_URLS");
    expect(ENVIRONMENT_CONTRACT.templateKeys).toContain("TURN_SHARED_SECRET");
    expect(validateEnvironment({}, "ci").ok).toBe(true);
  });
  it("requires relay setup only for the production runtime gate", () => {
    const result = validateEnvironment({ NODE_ENV: "production" }, "runtime");
    expect(result.errors).toContainEqual(
      expect.objectContaining({ name: "TURN_SERVER_URLS" }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ name: "TURN_SHARED_SECRET" }),
    );
    expect(
      validateEnvironment({ NODE_ENV: "development" }, "runtime").errors.some(
        (item) => item.name.startsWith("TURN_"),
      ),
    ).toBe(false);
  });
  it("never returns actual relay secret values in diagnostics", () => {
    const marker = "synthetic-short-test-value";
    const result = validateEnvironment(
      { NODE_ENV: "production", TURN_SHARED_SECRET: marker },
      "runtime",
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ name: "TURN_SHARED_SECRET" }),
    );
    expect(JSON.stringify(result)).not.toContain(marker);
  });
});

describe("blank optional relay placeholders", () => {
  it("allows direct/STUN development only when both settings are blank", () => {
    expect(
      loadTurnConfiguration({
        NODE_ENV: "development",
        TURN_SERVER_URLS: "",
        TURN_SHARED_SECRET: "",
      }),
    ).toBeNull();
  });
  it("still rejects blank production and partial relay setup", () => {
    expect(() =>
      loadTurnConfiguration({
        NODE_ENV: "production",
        TURN_SERVER_URLS: "",
        TURN_SHARED_SECRET: "",
      }),
    ).toThrow();
    expect(() =>
      loadTurnConfiguration({
        NODE_ENV: "development",
        TURN_SERVER_URLS: "turn:relay.example.invalid:3478",
        TURN_SHARED_SECRET: "",
      }),
    ).toThrow();
  });
});
