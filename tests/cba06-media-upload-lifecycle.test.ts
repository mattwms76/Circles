import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticRecordedMp4 } from "./fixtures/recorded-mp4";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  assertPlatformUploadSizeWithLimit: vi.fn(),
  encryptSocialMedia: vi.fn((bytes: Buffer) => bytes),
  reserveSocialUploadBudget: vi.fn(),
  confirmSocialUploadPut: vi.fn(),
  recordUpload: vi.fn(),
  storagePut: vi.fn(),
}));

vi.mock("../server/db", () => ({ getDb: mocks.getDb }));
vi.mock("../server/platform-settings", () => ({
  assertPlatformUploadSize: vi.fn(),
  assertPlatformUploadSizeWithLimit: mocks.assertPlatformUploadSizeWithLimit,
}));
vi.mock("../server/storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("../server/media-upload-budget", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/media-upload-budget")>();
  return {
    ...actual,
    reserveSocialUploadBudget: mocks.reserveSocialUploadBudget,
    confirmSocialUploadPut: mocks.confirmSocialUploadPut,
  };
});
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
const VALID_VIDEO = Buffer.from(syntheticRecordedMp4());

function caller() {
  return socialRouter.createCaller({
    user: { id: 7 } as never,
    req: Object.assign(new EventEmitter(), { aborted: false }) as never,
    res: Object.assign(new EventEmitter(), { writableEnded: true }) as never,
  });
}

function validUploadInput() {
  return {
    base64: VALID_VIDEO.toString("base64"),
    mimeType: "video/mp4" as const,
    recording: { maxDurationSeconds: 30 as const },
  };
}

afterEach(() => vi.clearAllMocks());

describe("CBA-06 reserve-before-PUT lifecycle", () => {
  it("fails closed before storage PUT when the private budget schema is unavailable", async () => {
    mocks.getDb.mockResolvedValue({});
    mocks.assertPlatformUploadSizeWithLimit.mockResolvedValue(1024);
    mocks.reserveSocialUploadBudget.mockRejectedValue(
      new (
        await import("../server/media-upload-budget")
      ).MediaUploadBudgetUnavailableError(),
    );

    await expect(caller().upload(validUploadInput())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Media upload lifecycle is unavailable",
    });

    expect(mocks.reserveSocialUploadBudget).toHaveBeenCalledTimes(1);
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.recordUpload).not.toHaveBeenCalled();
  });

  it("keeps a confirmed provider object charged when metadata recording fails", async () => {
    const reservation = {
      reservationId: "11111111-1111-4111-8111-111111111111",
      userId: 7,
      storageKey:
        "social-encrypted/7/11111111-1111-4111-8111-111111111111.mp4.enc",
      url: "/manus-storage/social-encrypted/7/11111111-1111-4111-8111-111111111111.mp4.enc",
      objectBytes: VALID_VIDEO.length,
    };
    mocks.getDb.mockResolvedValue({});
    mocks.assertPlatformUploadSizeWithLimit.mockResolvedValue(1024);
    mocks.reserveSocialUploadBudget.mockResolvedValue(reservation);
    mocks.storagePut.mockResolvedValue({
      key: reservation.storageKey,
      url: reservation.url,
    });
    mocks.confirmSocialUploadPut.mockResolvedValue(undefined);
    mocks.recordUpload.mockRejectedValue(
      new Error("synthetic metadata failure"),
    );

    await expect(caller().upload(validUploadInput())).rejects.toThrow(
      "synthetic metadata failure",
    );

    expect(mocks.reserveSocialUploadBudget).toHaveBeenCalledBefore(
      mocks.storagePut,
    );
    expect(mocks.confirmSocialUploadPut).toHaveBeenCalledWith(
      expect.any(Object),
      reservation,
    );
    expect(mocks.recordUpload).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ reservation }),
      expect.any(Object),
    );
  });
});
