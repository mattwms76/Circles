import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ContinuitySafetyError,
  DEFAULT_MAX_OBJECTS,
  EXPECTED_BACKUP_RECIPIENT,
  collectMediaInventory,
  exportContinuityPackage,
  fetchAppMedia,
  isAllowedMediaOrigin,
  parseCliArguments,
  validateInventoryDocument,
} from "../scripts/recovery-continuity.mjs";

const temporaryDirectories: string[] = [];
let previousMediaOrigin: string | undefined;

beforeEach(() => {
  previousMediaOrigin = process.env.EXPO_PUBLIC_API_BASE_URL;
  process.env.EXPO_PUBLIC_API_BASE_URL = "https://current-preview.manus.computer";
});

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "circles-continuity-test-"));
  fs.chmodSync(directory, 0o700);
  temporaryDirectories.push(directory);
  return directory;
}

function privateFile(directory: string, name: string, content: string) {
  const filename = path.join(directory, name);
  fs.writeFileSync(filename, content, { mode: 0o600 });
  fs.chmodSync(filename, 0o600);
  return filename;
}

function syntheticKey(number = 1) {
  return `social-encrypted/${number}/123e4567-e89b-42d3-a456-42661417400${number}.jpg.enc`;
}

function syntheticInventory() {
  const key = syntheticKey();
  return {
    format: "circles-media-inventory-v1",
    media: [
      {
        storage_key: key,
        url: `/manus-storage/${key}`,
        mime_type: "image/jpeg",
        bytes: 3,
        references: {
          profile_refs: 1,
          circle_refs: 0,
          post_refs: 1,
          message_refs: 0,
          stream_refs: 0,
        },
      },
    ],
  };
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
  if (previousMediaOrigin === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = previousMediaOrigin;
});

describe("recovery continuity", () => {
  it("accepts only canonical managed-upload metadata and reports aggregate references", () => {
    const inventory = validateInventoryDocument(syntheticInventory());
    expect(inventory.summary).toEqual({
      objects: 1,
      bytes: 3,
      referenced_objects: 1,
      unreferenced_objects: 0,
    });

    const malformed = syntheticInventory();
    malformed.media[0].url = "https://untrusted.example.test/manus-storage/not-allowed";
    expect(() => validateInventoryDocument(malformed)).toThrow("inventory_invalid");
  });

  it("uses a bounded read-only transaction and only fixed application metadata queries", async () => {
    const commands: string[] = [];
    let ended = false;
    const key = syntheticKey();
    const client = {
      connect: async () => undefined,
      end: async () => {
        ended = true;
      },
      query: async (request: string | { text: string; values: unknown[] }) => {
        const text = typeof request === "string" ? request : request.text;
        commands.push(text);
        if (text.includes('FROM "circles_app"."socialUploads"')) {
          return {
            rows: [
              {
                storage_key: key,
                url: `/manus-storage/${key}`,
                mime_type: "image/jpeg",
                bytes: 3,
              },
            ],
          };
        }
        if (text.includes("WITH selected AS")) {
          return {
            rows: [
              {
                storage_key: key,
                profile_refs: "1",
                circle_refs: "0",
                post_refs: "1",
                message_refs: "0",
                stream_refs: "0",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const inventory = await collectMediaInventory({ client, maxObjects: DEFAULT_MAX_OBJECTS, maxTotalBytes: 100 });
    expect(inventory.summary).toMatchObject({ objects: 1, bytes: 3, referenced_objects: 1 });
    expect(ended).toBe(true);
    expect(commands).toContain("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(commands).toContain("SET LOCAL lock_timeout = '5s'");
    expect(commands).toContain("SET LOCAL statement_timeout = '30s'");
    expect(commands.some((command) => /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i.test(command))).toBe(false);
  });

  it("rejects non-app media origins before a request and fetches only the exact media proxy route", async () => {
    let requested = "";
    await expect(
      fetchAppMedia({
        origin: "https://untrusted.example.test",
        storageKey: syntheticKey(),
        bytes: 3,
        bearerToken: "synthetic-bearer",
        fetchImpl: async () => {
          throw new Error("must not fetch");
        },
      }),
    ).rejects.toThrow("media_source_not_allowlisted");

    const bytes = await fetchAppMedia({
      origin: "https://current-preview.manus.computer",
      storageKey: syntheticKey(),
      bytes: 3,
      bearerToken: "synthetic-bearer",
      fetchImpl: async (input, init) => {
        requested = `${String(input)} ${init?.method} ${init?.redirect}`;
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "3" },
        });
      },
    });
    expect(bytes).toEqual(Buffer.from([1, 2, 3]));
    expect(requested).toContain(`/api/media/${syntheticKey()} GET error`);
    expect(isAllowedMediaOrigin("https://current-preview.manus.computer")).toBeInstanceOf(URL);
    expect(isAllowedMediaOrigin("https://current-preview.manus.computer/not-an-origin")).toBeNull();
  });

  it("requires explicit signing-material opt-in and never accepts it as an automatic export input", () => {
    const exportArgs = [
      "--export",
      "--inventory-file",
      "/private/inventory.json",
      "--media-origin",
      "https://current-preview.manus.computer",
      "--media-auth-file",
      "/private/auth.json",
      "--recipient-file",
      "/private/recipient.txt",
      "--output-file",
      "/private/continuity.age",
    ];
    expect(parseCliArguments(exportArgs).includeSigningMaterial).toBe(false);
    expect(() => parseCliArguments([...exportArgs, "--signing-material-file", "/private/key"])).toThrow(
      "signing_material_not_opted_in",
    );
    expect(() => parseCliArguments([...exportArgs, "--include-signing-material"])).toThrow(
      "signing_material_file_required",
    );
  });

  it("encrypts a complete synthetic package to the approved public recipient and leaves no plaintext output", async () => {
    const directory = temporaryDirectory();
    const inventoryFile = privateFile(directory, "inventory.json", JSON.stringify(syntheticInventory()));
    const authFile = privateFile(directory, "auth.json", JSON.stringify({ bearerToken: "synthetic-bearer" }));
    const recipientFile = privateFile(directory, "recipient.txt", `${EXPECTED_BACKUP_RECIPIENT}\n`);
    const outputFile = path.join(directory, "circles-media-continuity.age");

    const result = await exportContinuityPackage({
      inventoryFile,
      mediaOrigin: "https://current-preview.manus.computer",
      mediaAuthFile: authFile,
      recipientFile,
      outputFile,
      fetchImpl: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "3" },
        }),
    });

    expect(result).toMatchObject({ objects: 1, bytes: 3, signing_material_included: false });
    expect(fs.readFileSync(outputFile).subarray(0, 21).toString("utf8")).toBe("age-encryption.org/v1");
    expect(fs.statSync(outputFile).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(directory)).toEqual(["auth.json", "circles-media-continuity.age", "inventory.json", "recipient.txt"]);
  });

  it("fails closed when a database inventory exceeds its object cap", async () => {
    const client = {
      connect: async () => undefined,
      end: async () => undefined,
      query: async (request: string | { text: string; values: unknown[] }) => {
        const text = typeof request === "string" ? request : request.text;
        return text.includes('FROM "circles_app"."socialUploads"') ? { rows: [{}, {}] } : { rows: [] };
      },
    };
    await expect(collectMediaInventory({ client, maxObjects: 1, maxTotalBytes: 100 })).rejects.toThrow(
      "inventory_object_limit_exceeded",
    );
  });

  it("uses stable non-sensitive errors rather than echoing invalid inputs", () => {
    try {
      validateInventoryDocument({ format: "circles-media-inventory-v1", media: [{ storage_key: "not-a-key" }] });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ContinuitySafetyError);
      expect((error as Error).message).toBe("inventory_invalid");
    }
  });
});
