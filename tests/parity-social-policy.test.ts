import { EventEmitter } from "node:events";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { circles, memberships, posts, reports } from "../drizzle/schema";
import {
  excessiveTableEntriesMp4,
  syntheticRecordedMp4,
} from "./fixtures/recorded-mp4";

const mocks = vi.hoisted(() => ({
  assertPlatformFeature: vi.fn(),
  assertPlatformUploadSize: vi.fn(),
  assertPlatformUploadSizeWithLimit: vi.fn(),
  encryptSocialMedia: vi.fn((bytes: Buffer) => bytes),
  getDb: vi.fn(),
  recordModerationReport: vi.fn(),
  recordUpload: vi.fn(),
  storagePut: vi.fn(),
  validateMp4Upload: vi.fn(),
}));

vi.mock("../server/db", () => ({ getDb: mocks.getDb }));
vi.mock("../server/platform-settings", () => ({
  assertPlatformFeature: mocks.assertPlatformFeature,
  assertPlatformUploadSize: mocks.assertPlatformUploadSize,
  assertPlatformUploadSizeWithLimit: mocks.assertPlatformUploadSizeWithLimit,
}));
vi.mock("../server/storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("../server/sec27-video-validation", () => ({
  Mp4ValidationError: class Mp4ValidationError extends Error {},
  validateMp4Upload: mocks.validateMp4Upload,
}));
vi.mock("../server/moderation-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/moderation-events")>()),
  recordModerationReport: mocks.recordModerationReport,
}));
vi.mock("../server/social-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/social-service")>();
  return {
    ...actual,
    encryptSocialMedia: mocks.encryptSocialMedia,
    recordUpload: mocks.recordUpload,
  };
});

const { socialRouter } = await import("../server/social-router");
const { createCircle, reportPost } = await import("../server/social-service");

function rows<T>(value: T[]) {
  return {
    for: async () => value,
    limit: () => rows(value),
    orderBy: () => rows(value),
    then: <Output>(
      resolve: (result: T[]) => Output | PromiseLike<Output>,
      reject?: (reason: unknown) => Output | PromiseLike<Output>,
    ) => Promise.resolve(value).then(resolve, reject),
  };
}

function reportFixture(post: {
  id: number;
  authorId: number;
  circleId: number | null;
}) {
  const reportWrites: unknown[] = [];
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        if (table === posts)
          return { where: () => ({ limit: () => rows([post]) }) };
        if (table === circles) {
          return {
            where: () => ({
              limit: () => rows([{ id: post.circleId, privacy: "public" }]),
            }),
          };
        }
        if (table === memberships)
          return { where: () => ({ limit: () => rows([]) }) };
        throw new Error("Unexpected policy fixture read");
      },
    }),
    insert: vi.fn((table: unknown) => {
      if (table !== reports) throw new Error("Unexpected policy fixture write");
      return {
        values: (value: unknown) => {
          reportWrites.push(value);
          return { onConflictDoUpdate: async () => undefined };
        },
      };
    }),
  };
  const db = {
    ...tx,
    transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) =>
      callback(tx),
  };
  return { db, reportWrites, insert: tx.insert };
}

function uploadCaller() {
  const req = Object.assign(new EventEmitter(), { aborted: false });
  const res = Object.assign(new EventEmitter(), { writableEnded: true });
  return socialRouter.createCaller({
    user: { id: 12 } as never,
    req: req as never,
    res: res as never,
  });
}

function deniedUploadCaller() {
  const req = Object.assign(new EventEmitter(), { aborted: false });
  const res = Object.assign(new EventEmitter(), { writableEnded: true });
  return socialRouter.createCaller({
    // createContext uses this exact null actor outcome after SDK authentication rejects a revoked
    // durable session. The protected procedure must deny before any upload admission work begins.
    user: null,
    req: req as never,
    res: res as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CIRCLES_PLATFORM_SETTINGS_ENABLED;
  mocks.assertPlatformFeature.mockResolvedValue(undefined);
  mocks.assertPlatformUploadSize.mockResolvedValue(undefined);
  mocks.assertPlatformUploadSizeWithLimit.mockResolvedValue(20 * 1024 * 1024);
  mocks.recordModerationReport.mockResolvedValue(undefined);
  mocks.validateMp4Upload.mockResolvedValue(undefined);
});

afterEach(() => mocks.getDb.mockReset());

describe("admin parity social policy", () => {
  it("rejects disabled circle creation inside the transaction before any write", async () => {
    const db = {
      insert: vi.fn(),
      transaction: async <T>(callback: (transaction: object) => Promise<T>) =>
        callback(db),
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.assertPlatformFeature.mockRejectedValue(
      new TRPCError({
        code: "FORBIDDEN",
        message: "Circle creation is disabled",
      }),
    );

    await expect(
      createCircle(12, {
        name: "Disabled circle",
        description: "This write must not occur.",
        category: "Testing",
        privacy: "private",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.assertPlatformFeature).toHaveBeenCalledWith(
      db,
      "circleCreationEnabled",
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects an over-limit decoded upload before encryption, storage, or upload-record writes", async () => {
    mocks.getDb.mockResolvedValue({});
    mocks.assertPlatformUploadSizeWithLimit.mockRejectedValue(
      new TRPCError({
        code: "FORBIDDEN",
        message: "Upload exceeds the active limit",
      }),
    );
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

    await expect(
      uploadCaller().upload({
        base64: bytes.toString("base64"),
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.assertPlatformUploadSizeWithLimit).toHaveBeenCalledWith(
      expect.any(Object),
      bytes.length,
    );
    expect(mocks.encryptSocialMedia).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.recordUpload).not.toHaveBeenCalled();
  });

  it("fails upload admission safely when a database executor cannot be obtained", async () => {
    process.env.CIRCLES_PLATFORM_SETTINGS_ENABLED = "true";
    mocks.getDb.mockResolvedValue(null);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

    await expect(
      uploadCaller().upload({
        base64: bytes.toString("base64"),
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.assertPlatformUploadSizeWithLimit).not.toHaveBeenCalled();
    expect(mocks.encryptSocialMedia).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("rejects actual unsupported recorded MP4 metadata before hardened validation, encryption, or storage", async () => {
    mocks.getDb.mockResolvedValue({});
    mocks.assertPlatformUploadSizeWithLimit.mockResolvedValue(1_024);
    const bytes = Buffer.from(syntheticRecordedMp4({ videoEntryType: "hvc1" }));

    await expect(
      uploadCaller().upload({
        base64: bytes.toString("base64"),
        mimeType: "video/mp4",
        recording: { maxDurationSeconds: 30 },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This video must use H.264 video with AAC audio.",
    });

    expect(mocks.encryptSocialMedia).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.recordUpload).not.toHaveBeenCalled();
  });

  it("rejects an excessive recorded MP4 table before retained validation, encryption, storage, or upload recording", async () => {
    mocks.getDb.mockResolvedValue({});
    const bytes = Buffer.from(excessiveTableEntriesMp4());

    await expect(
      uploadCaller().upload({
        base64: bytes.toString("base64"),
        mimeType: "video/mp4",
        recording: { maxDurationSeconds: 30 },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This MP4 file exceeds the recording metadata resource limit.",
    });

    expect(mocks.validateMp4Upload).not.toHaveBeenCalled();
    expect(mocks.encryptSocialMedia).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.recordUpload).not.toHaveBeenCalled();
  });

  it("enforces the active effective cap against an actual recorded MP4 before encryption or storage", async () => {
    mocks.getDb.mockResolvedValue({});
    const bytes = Buffer.from(syntheticRecordedMp4());
    mocks.assertPlatformUploadSizeWithLimit.mockResolvedValue(bytes.length - 1);

    await expect(
      uploadCaller().upload({
        base64: bytes.toString("base64"),
        mimeType: "video/mp4",
        recording: { maxDurationSeconds: 30 },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Keep your recorded video under the allowed size.",
    });

    expect(mocks.assertPlatformUploadSizeWithLimit).toHaveBeenCalledWith(
      expect.any(Object),
      bytes.length,
    );
    expect(mocks.encryptSocialMedia).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.recordUpload).not.toHaveBeenCalled();
  });

  it("rejects a recording when protected context has rejected its credential before upload admission", async () => {
    const bytes = Buffer.from(syntheticRecordedMp4());

    await expect(
      deniedUploadCaller().upload({
        base64: bytes.toString("base64"),
        mimeType: "video/mp4",
        recording: { maxDurationSeconds: 30 },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.assertPlatformUploadSizeWithLimit).not.toHaveBeenCalled();
    expect(mocks.encryptSocialMedia).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.recordUpload).not.toHaveBeenCalled();
  });

  it("keeps circle reports actionable while rejecting global report targets before all writes", async () => {
    const global = reportFixture({ id: 61, authorId: 8, circleId: null });
    mocks.getDb.mockResolvedValue(global.db);

    await expect(reportPost(12, 61, "Spam")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(global.reportWrites).toEqual([]);
    expect(global.insert).not.toHaveBeenCalled();
    expect(mocks.recordModerationReport).not.toHaveBeenCalled();

    const circle = reportFixture({ id: 62, authorId: 8, circleId: 9 });
    mocks.getDb.mockResolvedValue(circle.db);

    await expect(reportPost(12, 62, "Spam")).resolves.toEqual({
      success: true,
    });
    expect(circle.reportWrites).toEqual([
      expect.objectContaining({ postId: 62, reporterId: 12, reason: "Spam" }),
    ]);
    expect(mocks.recordModerationReport).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ circleId: 9, postId: 62, subjectUserId: 8 }),
    );
  });
});
