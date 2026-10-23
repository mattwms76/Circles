import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runRecovery,
  validateRefreshConfiguration,
  validateVerificationConfiguration,
} from "../scripts/recover-api.mjs";
import {
  exportContinuityPackage,
  fetchAppMedia,
  isAllowedMediaOrigin,
} from "../scripts/recovery-continuity.mjs";

const temporaryDirectories: string[] = [];
const previewOrigin = "https://current-preview.manus.computer";
const trustedApiOrigin = "https://trusted-api.example.test:3000";

function temporaryDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "circles-origin-binding-"),
  );
  fs.chmodSync(directory, 0o700);
  temporaryDirectories.push(directory);
  return directory;
}

function privateFile(
  directory: string,
  name: string,
  content: string,
  mode = 0o600,
) {
  const filename = path.join(directory, name);
  fs.writeFileSync(filename, content, { mode });
  fs.chmodSync(filename, mode);
  return filename;
}

function refreshConfiguration(apiOrigin = trustedApiOrigin) {
  return {
    MANUS_PROJECT_ID: "synthetic-project",
    MANUS_OAUTH_PORTAL_URL: "https://oauth.example.test",
    MANUS_OAUTH_API_URL: "https://oauth-api.example.test",
    MANUS_JWT_SECRET: "s".repeat(32),
    SUPABASE_DATABASE_URL: "postgresql://synthetic.example.test/postgres",
    BUILT_IN_FORGE_API_URL: "https://storage.example.test",
    BUILT_IN_FORGE_API_KEY: "synthetic-storage-key",
    EXPO_PUBLIC_API_BASE_URL: apiOrigin,
    EXPO_PACKAGER_PROXY_URL: "http://127.0.0.1:8081",
  };
}

async function withTrustedMediaOrigin<T>(callback: () => Promise<T> | T) {
  const previous = process.env.EXPO_PUBLIC_API_BASE_URL;
  process.env.EXPO_PUBLIC_API_BASE_URL = previewOrigin;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL = previous;
  }
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("operator origin bindings", () => {
  it("permits a remote dry-run/apply target only when it exactly matches the trusted configured API origin", () => {
    const configuration = refreshConfiguration();
    expect(
      validateRefreshConfiguration(configuration, {
        operatorBaseUrl: trustedApiOrigin,
      }).ok,
    ).toBe(true);

    for (const target of [
      "https://attacker.example.test:3000",
      "https://trusted-api.example.test:03000",
      "https://operator@trusted-api.example.test:3000",
      "https://trusted-api.example.test:3000/",
    ]) {
      const validation = validateRefreshConfiguration(configuration, {
        operatorBaseUrl: target,
      });
      expect(validation.ok).toBe(false);
      expect(JSON.stringify(validation)).not.toContain(target);
    }
  });

  it("rejects an unbound credentialed Preview target before loading its private auth file or fetching", async () => {
    const directory = temporaryDirectory();
    const authFile = privateFile(
      directory,
      "unreadable-auth.json",
      JSON.stringify({ bearerToken: "synthetic-bearer", ids: {} }),
      0o640,
    );
    let fetches = 0;

    const report = await runRecovery({
      mode: "verify-only",
      projectDir: process.cwd(),
      configuration: { EXPO_PUBLIC_API_BASE_URL: previewOrigin },
      operatorBaseUrl: "https://other-preview.manus.computer",
      authFile,
      fetchImpl: (async () => {
        fetches += 1;
        throw new Error("must not fetch");
      }) as typeof fetch,
    });

    expect(report.ok).toBe(false);
    expect(report.configuration.errors).toContainEqual({
      name: "API_BASE_URL",
      reason:
        "credentialed verification must use loopback or the exact trusted configured API origin",
    });
    expect(fetches).toBe(0);
    expect(JSON.stringify(report)).not.toContain(authFile);
  });

  it("allows credentialed exact public Preview and loopback verification targets while rejecting canonicalization tricks", () => {
    expect(
      validateVerificationConfiguration(
        { EXPO_PUBLIC_API_BASE_URL: previewOrigin },
        { operatorBaseUrl: previewOrigin, credentialed: true },
      ).ok,
    ).toBe(true);
    expect(
      validateVerificationConfiguration(
        {},
        { operatorBaseUrl: "http://127.0.0.1:3000", credentialed: true },
      ).ok,
    ).toBe(true);

    for (const target of [
      "https://other-preview.manus.computer",
      "https://operator@current-preview.manus.computer",
      "https://current-preview.manus.computer:443",
      "https://current-preview.manus.computer/",
    ]) {
      expect(
        validateVerificationConfiguration(
          { EXPO_PUBLIC_API_BASE_URL: previewOrigin },
          { operatorBaseUrl: target, credentialed: true },
        ).ok,
      ).toBe(false);
    }
  });

  it("binds public continuity media export to the injected app origin and keeps loopback fixtures available", async () => {
    await withTrustedMediaOrigin(async () => {
      expect(isAllowedMediaOrigin(previewOrigin)).toBeInstanceOf(URL);
      expect(
        isAllowedMediaOrigin("https://other-preview.manus.computer"),
      ).toBeNull();
      expect(
        isAllowedMediaOrigin("https://operator@current-preview.manus.computer"),
      ).toBeNull();
      expect(isAllowedMediaOrigin(`${previewOrigin}:443`)).toBeNull();
      expect(isAllowedMediaOrigin(`${previewOrigin}/`)).toBeNull();
      expect(isAllowedMediaOrigin("http://127.0.0.1:3000")).toBeInstanceOf(URL);
      for (const target of [
        "http://127.0.0.1:39123",
        "http://localhost:39123",
        "http://[::1]:39123",
        "http://127.1:3000",
        "http://127.0.0.1:03000",
        "http://127.0.0.1:3000/",
      ]) {
        expect(isAllowedMediaOrigin(target)).toBeNull();
      }

      let fetches = 0;
      await expect(
        fetchAppMedia({
          origin: "https://other-preview.manus.computer",
          storageKey:
            "social-encrypted/1/123e4567-e89b-42d3-a456-426614174001.jpg.enc",
          bytes: 3,
          bearerToken: "synthetic-bearer",
          fetchImpl: async () => {
            fetches += 1;
            throw new Error("must not fetch");
          },
        }),
      ).rejects.toThrow("media_source_not_allowlisted");
      expect(fetches).toBe(0);
    });
  });

  it("rejects an unbound continuity export before opening the bearer file", async () => {
    const directory = temporaryDirectory();
    const key =
      "social-encrypted/1/123e4567-e89b-42d3-a456-426614174001.jpg.enc";
    const inventoryFile = privateFile(
      directory,
      "inventory.json",
      JSON.stringify({
        format: "circles-media-inventory-v1",
        media: [
          {
            storage_key: key,
            url: `/manus-storage/${key}`,
            mime_type: "image/jpeg",
            bytes: 3,
            references: {
              profile_refs: 0,
              circle_refs: 0,
              post_refs: 0,
              message_refs: 0,
              stream_refs: 0,
            },
          },
        ],
      }),
    );
    const rejectedAuthFile = privateFile(
      directory,
      "auth.json",
      JSON.stringify({ bearerToken: "synthetic-bearer" }),
      0o640,
    );

    await withTrustedMediaOrigin(() =>
      expect(
        exportContinuityPackage({
          inventoryFile,
          mediaOrigin: "https://other-preview.manus.computer",
          mediaAuthFile: rejectedAuthFile,
          recipientFile: path.join(directory, "not-read-recipient.txt"),
          outputFile: path.join(directory, "not-created.age"),
        }),
      ).rejects.toThrow("media_source_not_allowlisted"),
    );
  });
});
