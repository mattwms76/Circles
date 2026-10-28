import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { socialRouter } from "../server/social-router";
import { syntheticRecordedMp4 } from "./fixtures/recorded-mp4";

const socialUploadMocks = vi.hoisted(() => ({
  storagePut: vi.fn(),
  encryptSocialMedia: vi.fn((bytes: Buffer) => bytes),
  recordUpload: vi.fn(),
}));

vi.mock("../server/storage", () => ({
  storagePut: socialUploadMocks.storagePut,
}));
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
    socialUploadMocks.storagePut.mockImplementation(
      async (
        _key: string,
        _bytes: Buffer,
        _contentType: string,
        options: { signal?: AbortSignal },
      ) => {
        receivedSignal = options.signal;
        return {
          key: "social-encrypted/7/synthetic.mp4.enc",
          url: "/manus-storage/social-encrypted/7/synthetic.mp4.enc",
        };
      },
    );
    socialUploadMocks.recordUpload.mockResolvedValue({
      url: "/manus-storage/social-encrypted/7/synthetic.mp4.enc",
    });

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
    ).resolves.toEqual({
      url: "/manus-storage/social-encrypted/7/synthetic.mp4.enc",
    });

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  });
});
