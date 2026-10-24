import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { socialRouter } from "../server/social-router";

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
  it("passes the request-scoped signal to storage and disposes listeners after completion", async () => {
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
          key: "social-encrypted/7/synthetic.jpg.enc",
          url: "/manus-storage/social-encrypted/7/synthetic.jpg.enc",
        };
      },
    );
    socialUploadMocks.recordUpload.mockResolvedValue({
      url: "/manus-storage/social-encrypted/7/synthetic.jpg.enc",
    });

    const caller = socialRouter.createCaller({
      user: { id: 7 } as never,
      req: request as never,
      res: response as never,
    });
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    await expect(
      caller.upload({
        base64: bytes.toString("base64"),
        mimeType: "image/jpeg",
      }),
    ).resolves.toEqual({
      url: "/manus-storage/social-encrypted/7/synthetic.jpg.enc",
    });

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  });
});
