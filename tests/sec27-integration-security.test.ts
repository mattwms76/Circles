import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateEnvironment } from "../scripts/check-env.mjs";
import {
  canonicalPublicHttpsOrigin,
  isValidTrustedProxyConfiguration,
  parseStorageObjectOrigins,
} from "../server/_core/sec27-security-configuration.mjs";
import { parseTrustedProxyPolicy } from "../server/_core/runtimeSecurity";

const root = new URL("../", import.meta.url);
afterEach(() => vi.unstubAllEnvs());

describe("SEC27 integration configuration boundaries", () => {
  it("keeps optional empty security settings unactivated and value-free", () => {
    expect(
      validateEnvironment(
        { CIRCLES_STORAGE_OBJECT_ORIGINS: "", CIRCLES_TRUSTED_PROXY_CIDRS: "" },
        "ci",
      ),
    ).toMatchObject({ ok: true });
    expect(parseStorageObjectOrigins("")).toBeNull();
    expect(parseTrustedProxyPolicy("")).toBeNull();
  });

  it("rejects unsafe provider origins and conflicting aliases without reflecting values", () => {
    for (const value of [
      "http://provider.example.test",
      "https://user:secret@provider.example.test",
      "https://provider.example.test/path",
      "https://provider.example.test/?x=1",
      "https://provider.example.test/#x",
    ]) {
      const result = validateEnvironment({ MANUS_OAUTH_API_URL: value }, "ci");
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result.errors)).not.toContain(value);
    }
    expect(
      validateEnvironment(
        {
          NODE_ENV: "production",
          OAUTH_SERVER_URL: "https://provider.example.test",
        },
        "ci",
      ).ok,
    ).toBe(false);
    expect(
      validateEnvironment(
        {
          MANUS_OAUTH_API_URL: "https://provider.example.test",
          OAUTH_SERVER_URL: "https://other.example.test",
        },
        "ci",
      ).ok,
    ).toBe(false);
    expect(
      validateEnvironment(
        {
          MANUS_OAUTH_API_URL: "https://provider.example.test/",
          OAUTH_SERVER_URL: "https://provider.example.test",
        },
        "ci",
      ).ok,
    ).toBe(true);
  });

  it("uses the same bounded storage parser for runtime and checker", () => {
    expect(canonicalPublicHttpsOrigin("https://objects.example.test/")).toBe(
      "https://objects.example.test",
    );
    for (const value of [
      "https://127.0.0.1",
      "https://[::1]",
      "https://metadata.internal",
      "https://localhost",
      "https://user:secret@objects.example.test",
      "https://objects.example.test/path",
      "https://objects.example.test,",
      "https://objects.example.test,https://objects.example.test",
    ]) {
      expect(parseStorageObjectOrigins(value)).toBeNull();
      expect(
        validateEnvironment({ CIRCLES_STORAGE_OBJECT_ORIGINS: value }, "ci").ok,
      ).toBe(false);
    }
    expect(
      parseStorageObjectOrigins(
        "https://objects.example.test,https://cdn.example.test",
      ),
    ).toEqual(
      new Set(["https://objects.example.test", "https://cdn.example.test"]),
    );
    const source = readFileSync(new URL("server/storage.ts", root), "utf8");
    expect(source).toContain("return parseStorageObjectOrigins(configured)");
  });

  it("keeps environment and runtime narrow-CIDR acceptance consistent", () => {
    for (const cidr of [
      "",
      "10.12.0.0/24",
      "192.0.2.8/32",
      "2001:db8::/64",
      "0.0.0.0/0",
      "127.0.0.0/24",
      "::1/128",
      "::ffff:127.0.0.1/128",
      "10.12.0.1/24",
      "2001:db8::1/64",
      "10.0.0.0/16",
      "proxy",
      "10.12.0.0/24,",
    ]) {
      let accepted = true;
      try {
        parseTrustedProxyPolicy(cidr);
      } catch {
        accepted = false;
      }
      expect(isValidTrustedProxyConfiguration(cidr), cidr).toBe(accepted);
      expect(
        validateEnvironment({ CIRCLES_TRUSTED_PROXY_CIDRS: cidr }, "ci").ok,
        cidr,
      ).toBe(accepted);
    }
  });

  it("calls the canonical production provider guard before opening a server", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MANUS_PROJECT_ID", "synthetic");
    vi.stubEnv("MANUS_JWT_SECRET", "x".repeat(48));
    vi.stubEnv("MANUS_OAUTH_PORTAL_URL", "https://portal.example.test");
    vi.stubEnv("SUPABASE_DATABASE_URL", "synthetic-invalid-dsn");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("MANUS_OAUTH_API_URL", "http://provider.example.test");
    const invalid = await import("../server/_core/index");
    expect(() => invalid.assertTrustedProductionRuntime()).toThrow(
      "OAuth provider configuration is unavailable",
    );
    await expect(invalid.startServer()).rejects.toThrow(
      "OAuth provider configuration is unavailable",
    );
    vi.resetModules();
    vi.stubEnv("MANUS_OAUTH_API_URL", "https://provider.example.test");
    const valid = await import("../server/_core/index");
    expect(() => valid.assertTrustedProductionRuntime()).not.toThrow();
    const source = readFileSync(new URL("server/_core/index.ts", root), "utf8");
    expect(
      source.indexOf(
        "assertTrustedProductionRuntime();",
        source.indexOf("export async function startServer"),
      ),
    ).toBeLessThan(
      source.indexOf(
        "const { server } = createApiServer();",
        source.indexOf("export async function startServer"),
      ),
    );
  });

  it("keeps the container health assertion aggregate-only", () => {
    const source = readFileSync(
      new URL(".github/workflows/container-validation.yml", root),
      "utf8",
    );
    expect(source).toContain('assert r == {"ok": False}');
    expect(source).not.toContain('r["database"]');
  });
});
