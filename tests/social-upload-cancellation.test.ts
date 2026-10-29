import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { socialRouter } from "../server/social-router";
import { syntheticRecordedMp4 } from "./fixtures/recorded-mp4";

const socialUploadMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  storagePut: vi.fn(),
  encryptSocialMedia: vi.fn((bytes: Buffer) => bytes),
  reserveSocialUploadBudget: vi.fn(),
  confirmSocialUploadPut: vi.fn(),
  recordUpload: vi.fn(),
}));

vi.mock("../server/db", () => ({ getDb: socialUploadMocks.getDb }));
vi.mock("../server/storage", () => ({
  storagePut: socialUploadMocks.storagePut,
}));
vi.mock("../server/media-upload-budget", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/media-upload-budget")>();
  return {
    ...actual,
    reserveSocialUploadBudget: socialUploadMocks.reserveSocialUploadBudget,
    confirmSocialUploadPut: socialUploadMocks.confirmSocialUploadPut,
  };
});
vi.mock("../server/social-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/social-service")>();
  return {
    ...actual,
    encryptSocialMedia: socialUploadMocks.encryptSocialMedia,
    recordUpload: socialUploadMocks.recordUpload,
  };
});

afterEach(() => vi.clearAllMocks());

describe("social upload request cancellation", () => {
  it("passes an actual recorded MP4 through hardened validation with a request-scoped storage signal and settled listeners", async () => {
    const request = Object.assign(new EventEmitter(), { aborted: false });
    const response = Object.assign(new EventEmitter(), { writableEnded: true });
    let receivedSignal: AbortSignal | undefined;
    socialUploadMocks.getDb.mockResolvedValue({});
    socialUploadMocks.reserveSocialUploadBudget.mockImplementation(
      async (
        _db: unknown,
        input: { userId: number; storageKey: string; objectBytes: number },
      ) => ({
        reservationId: "cba06-cancellation-reservation",
        userId: input.userId,
        storageKey: input.storageKey,
        url: `/manus-storage/${input.storageKey}`,
        objectBytes: input.objectBytes,
      }),
    );
    socialUploadMocks.confirmSocialUploadPut.mockResolvedValue(undefined);
    socialUploadMocks.storagePut.mockImplementation(
      async (
        key: string,
        _bytes: Buffer,
        _contentType: string,
        options: { signal?: AbortSignal },
      ) => {
        receivedSignal = options.signal;
        return {
          key,
          url: `/manus-storage/${key}`,
        };
      },
    );
    socialUploadMocks.recordUpload.mockImplementation(
      async (_userId: number, upload: { url: string }) => ({ url: upload.url }),
    );

    const caller = socialRouter.createCaller({
      user: { id: 7 } as never,
      req: request as never,
      res: response as never,
    });
    const bytes = Buffer.from(syntheticRecordedMp4());
    await expect(
      caller.upload({
        base64: bytes.toString("base64"),
        mimeType: "video/mp4",
        recording: { maxDurationSeconds: 30 },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        url: expect.stringMatching(/^\/manus-storage\/social-encrypted\/7\//),
      }),
    );

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  });
});
