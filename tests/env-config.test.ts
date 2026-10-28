import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_CONTRACT,
  extractEnvironmentNames,
  loadLocalEnvironment,
  readEnvironmentReferenceSources,
  validateEnvironment,
  validateTemplateCoverage,
} from "../scripts/check-env.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

function canonicalRuntimeEnvironment(): Record<string, string> {
  return {
    MANUS_PROJECT_ID: "test-project-id",
    MANUS_OAUTH_PORTAL_URL: "https://oauth.example.test",
    MANUS_OAUTH_API_URL: "https://oauth-api.example.test",
    MANUS_JWT_SECRET: "x".repeat(32),
    SUPABASE_DATABASE_URL:
      "postgresql://postgres.vvclcsqletcxzoaayqzq:synthetic-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    DATABASE_URL: "mysql://local.example.test/circles",
    BUILT_IN_FORGE_API_URL: "https://storage.example.test",
    BUILT_IN_FORGE_API_KEY: "test-only-key",
    EXPO_PUBLIC_API_BASE_URL: "http://localhost:3000",
  };
}

describe("environment configuration contract", () => {
  it("loads the local runtime file without overriding injected values", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "circles-env-"));
    try {
      fs.writeFileSync(
        path.join(directory, ".env"),
        "MANUS_PROJECT_ID=file-project\nEXPO_PUBLIC_API_BASE_URL=http://localhost:3000\n",
      );
      const target: Record<string, string> = {
        MANUS_PROJECT_ID: "injected-project",
      };
      loadLocalEnvironment(directory, target);
      expect(target).toEqual({
        MANUS_PROJECT_ID: "injected-project",
        EXPO_PUBLIC_API_BASE_URL: "http://localhost:3000",
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not require a local runtime file in a platform-managed environment", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "circles-env-"));
    try {
      const target = {};
      expect(() => loadLocalEnvironment(directory, target)).not.toThrow();
      expect(target).toEqual({});
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows CI validation with no production credentials or database", () => {
    const result = validateEnvironment({}, "ci");
    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  it("requires canonical runtime variables and never includes supplied values in errors", () => {
    const result = validateEnvironment(
      { MANUS_JWT_SECRET: "value-that-must-not-be-logged" },
      "runtime",
    );

    expect(result.ok).toBe(false);
    expect(result.errors.map((entry) => entry.name)).toContain(
      "MANUS_PROJECT_ID",
    );
    expect(result.errors.map((entry) => entry.name)).toContain(
      "MANUS_JWT_SECRET",
    );
    expect(JSON.stringify(result.errors)).not.toContain(
      "value-that-must-not-be-logged",
    );
  });

  it("accepts the complete canonical OAuth, Supabase, and media runtime contract", () => {
    const result = validateEnvironment(
      canonicalRuntimeEnvironment(),
      "runtime",
    );
    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  it("accepts dedicated mode only with the separate application credential", () => {
    const environment = canonicalRuntimeEnvironment();
    delete environment.SUPABASE_DATABASE_URL;
    environment.CIRCLES_DB_LOGIN_MODE = "dedicated";
    environment.CIRCLES_APP_DATABASE_URL =
      "postgresql://dedicated-synthetic-credential";
    expect(validateEnvironment(environment, "runtime")).toMatchObject({
      ok: true,
      errors: [],
    });
  });

  it("rejects mixed dedicated and operational credentials without echoing them", () => {
    const environment: Record<string, string> = {
      ...canonicalRuntimeEnvironment(),
      CIRCLES_DB_LOGIN_MODE: "dedicated",
      CIRCLES_APP_DATABASE_URL: "must-not-echo-dedicated-credential",
    };
    const result = validateEnvironment(environment, "runtime");
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ name: "SUPABASE_DATABASE_URL" }),
    );
    expect(JSON.stringify(result)).not.toContain(
      environment.CIRCLES_APP_DATABASE_URL,
    );
    expect(JSON.stringify(result)).not.toContain(
      environment.SUPABASE_DATABASE_URL,
    );
  });

  it("rejects dedicated inputs in legacy mode and unknown login modes", () => {
    expect(
      validateEnvironment(
        {
          ...canonicalRuntimeEnvironment(),
          CIRCLES_APP_DATABASE_URL: "synthetic",
        },
        "runtime",
      ).ok,
    ).toBe(false);
    expect(
      validateEnvironment(
        {
          ...canonicalRuntimeEnvironment(),
          CIRCLES_DB_LOGIN_MODE: "arbitrary",
        },
        "runtime",
      ).ok,
    ).toBe(false);
  });

  it("requires server-only Supabase PostgreSQL and rejects DATABASE_URL as a runtime substitute", () => {
    const environment = canonicalRuntimeEnvironment();
    delete environment.SUPABASE_DATABASE_URL;
    const result = validateEnvironment(environment, "runtime");
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ name: "SUPABASE_DATABASE_URL" }),
    );
  });

  it("only accepts a MySQL URL when the optional managed source is retained", () => {
    const secret =
      "postgresql://private-secret-must-not-appear@example.test/postgres";
    const result = validateEnvironment(
      { ...canonicalRuntimeEnvironment(), DATABASE_URL: secret },
      "runtime",
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ name: "DATABASE_URL" }),
    );
    expect(JSON.stringify(result.errors)).not.toContain(secret);
  });

  it("rejects credential-bearing browser-safe endpoints without echoing values", () => {
    const result = validateEnvironment(
      { EXPO_PUBLIC_API_BASE_URL: "https://user:password@example.test" },
      "ci",
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ name: "EXPO_PUBLIC_API_BASE_URL" }),
    ]);
    expect(JSON.stringify(result.errors)).not.toContain("password");
  });

  it("extracts literal names used through a dynamic origin parameter", () => {
    const names = extractEnvironmentNames(`
      function readOrigin(name: "EXPO_PACKAGER_PROXY_URL" | "EXPO_WEB_PREVIEW_URL") {
        return process.env[name];
      }
    `);
    expect([...names].sort()).toEqual([
      "EXPO_PACKAGER_PROXY_URL",
      "EXPO_WEB_PREVIEW_URL",
    ]);
  });

  it("keeps the checked-in template synchronized with all owned process.env consumers", () => {
    const result = validateTemplateCoverage({
      templateText: fs.readFileSync(
        path.join(projectRoot, ".env.example"),
        "utf8",
      ),
      sourceTexts: readEnvironmentReferenceSources(projectRoot).map(
        ({ text }) => text,
      ),
    });

    expect(
      result.ok,
      result.errors.map((entry) => `${entry.name}: ${entry.reason}`).join("\n"),
    ).toBe(true);
    expect(new Set(ENVIRONMENT_CONTRACT.templateKeys)).toEqual(
      result.templateKeys,
    );
  });
});
