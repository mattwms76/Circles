import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { enqueueAfterFinalMediaAuthorization } from "../server/_core/storageProxy";
import {
  MAX_MP4_DURATION_SECONDS,
  MAX_MP4_UPLOAD_BYTES,
} from "../server/sec27-video-validation";
import { validateMediaUpload } from "../server/social-router";
import {
  configuredStorageObjectOrigins,
  resolveConfiguredStorageTarget,
  StorageOperationError,
} from "../server/storage";

const objectOrigins = new Set(["https://objects.synthetic.test"]);
const validH264AacMp4 = readFileSync(
  new URL("./fixtures/sec27-valid-h264-aac.mp4", import.meta.url),
);
const validHevcAacMp4 = readFileSync(
  new URL("./fixtures/sec27-valid-hevc-aac.mp4", import.meta.url),
);
const fragmentedH264AacMp4 = readFileSync(
  new URL("./fixtures/sec27-fragmented-h264-aac.mp4", import.meta.url),
);
const unsupportedMpeg4Mp4 = readFileSync(
  new URL("./fixtures/sec27-unsupported-mpeg4-aac.mp4", import.meta.url),
);

function boxTypeOffset(bytes: Buffer, type: string): number {
  const offset = bytes.indexOf(Buffer.from(type, "ascii"));
  if (offset < 4) throw new Error(`Synthetic fixture is missing ${type}`);
  return offset;
}

function withMovieDuration(bytes: Buffer, seconds: number): Buffer {
  const copy = Buffer.from(bytes);
  const mvhd = boxTypeOffset(copy, "mvhd");
  expect(copy[mvhd + 4]).toBe(0); // The generated fixture uses version-0 movie headers.
  const timescale = copy.readUInt32BE(mvhd + 16);
  copy.writeUInt32BE(timescale * seconds, mvhd + 20);
  return copy;
}

function withOversizedDisplayPixels(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes);
  const tkhd = boxTypeOffset(copy, "tkhd");
  expect(copy[tkhd + 4]).toBe(0); // The generated fixture uses version-0 track headers.
  // tkhd width/height are 16.16 fixed-point fields at offsets 80/84 from the type.
  copy.writeUInt32BE(0xffff0000, tkhd + 80);
  copy.writeUInt32BE(0xffff0000, tkhd + 84);
  return copy;
}

async function syntheticRaster(
  format: "jpeg" | "png" | "webp",
): Promise<Buffer> {
  return sharp({
    create: {
      width: 24,
      height: 18,
      channels: 4,
      background: { r: 18, g: 44, b: 91, alpha: 0.75 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

describe("SEC-007 structural raster admission", () => {
  it.each([
    ["image/jpeg", "jpeg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ] as const)(
    "fully decodes and normalizes verified %s bytes",
    async (mimeType, format) => {
      const verified = await validateMediaUpload(
        await syntheticRaster(format),
        mimeType,
      );

      expect(verified.mimeType).toBe(mimeType);
      expect(verified.bytes.length).toBeGreaterThan(0);
      await expect(sharp(verified.bytes).metadata()).resolves.toMatchObject({
        format,
        width: 24,
        height: 18,
      });
    },
  );

  it("rejects prefix-only, truncated, SVG, and declared-format mismatch bytes", async () => {
    await expect(
      validateMediaUpload(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      validateMediaUpload(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        "image/png",
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      validateMediaUpload(await syntheticRaster("png"), "image/jpeg"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a source whose structural dimensions exceed the bounded pixel policy", async () => {
    const oversized = await sharp({
      create: {
        width: 4097,
        height: 4097,
        channels: 3,
        background: "#224466",
      },
    })
      .png()
      .toBuffer();

    await expect(
      validateMediaUpload(oversized, "image/png"),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it.each([
    ["H.264", validH264AacMp4],
    ["HEVC", validHevcAacMp4],
  ])(
    "accepts a complete synthetic %s/AAC MP4 without transforming its bytes",
    async (_codec, bytes) => {
      const verified = await validateMediaUpload(bytes, "video/mp4");

      expect(verified).toEqual({ bytes, mimeType: "video/mp4" });
    },
  );

  it("rejects signature-only and malformed fragmented MP4 bytes", async () => {
    const shallowFtyp = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ]);

    await expect(
      validateMediaUpload(shallowFtyp, "video/mp4"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      validateMediaUpload(fragmentedH264AacMp4, "video/mp4"),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Fragmented MP4 uploads are not supported",
    });
    await expect(
      validateMediaUpload(fragmentedH264AacMp4.subarray(0, -1), "video/mp4"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects unsupported track codecs and oversized duration or display pixels", async () => {
    await expect(
      validateMediaUpload(unsupportedMpeg4Mp4, "video/mp4"),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "MP4 upload has an unsupported video codec",
    });
    await expect(
      validateMediaUpload(
        withMovieDuration(validH264AacMp4, MAX_MP4_DURATION_SECONDS + 1),
        "video/mp4",
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "MP4 upload exceeds the 5 minute duration limit",
    });
    await expect(
      validateMediaUpload(
        withOversizedDisplayPixels(validH264AacMp4),
        "video/mp4",
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "MP4 upload exceeds the 16 megapixel limit",
    });
  });

  it("rejects a resource-sized upload before creating a parser worker", async () => {
    await expect(
      validateMediaUpload(Buffer.alloc(MAX_MP4_UPLOAD_BYTES + 1), "video/mp4"),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "MP4 upload must be between 1 byte and 20 MB",
    });
  });
});

describe("SEC-015 configured signed-object target policy", () => {
  it("accepts only exact configured HTTPS origins and returns a pinned public address", async () => {
    const target = await resolveConfiguredStorageTarget(
      "https://objects.synthetic.test/download?signature=opaque",
      objectOrigins,
      async () => [{ address: "8.8.8.8", family: 4 }],
    );

    expect(target).toMatchObject({
      hostname: "objects.synthetic.test",
      address: "8.8.8.8",
      family: 4,
    });
  });

  it("rejects unconfigured origins, URL credentials, IP literals, and private or mixed DNS", async () => {
    const publicResolver = async () => [{ address: "8.8.8.8", family: 4 }];
    await expect(
      resolveConfiguredStorageTarget(
        "https://other.synthetic.test/object",
        objectOrigins,
        publicResolver,
      ),
    ).rejects.toBeInstanceOf(StorageOperationError);
    await expect(
      resolveConfiguredStorageTarget(
        "https://user:pass@objects.synthetic.test/object",
        objectOrigins,
        publicResolver,
      ),
    ).rejects.toBeInstanceOf(StorageOperationError);
    await expect(
      resolveConfiguredStorageTarget(
        "https://8.8.8.8/object",
        new Set(["https://8.8.8.8"]),
        publicResolver,
      ),
    ).rejects.toBeInstanceOf(StorageOperationError);
    await expect(
      resolveConfiguredStorageTarget(
        "https://objects.synthetic.test/object",
        objectOrigins,
        async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      ),
    ).rejects.toBeInstanceOf(StorageOperationError);
  });

  it("requires explicit root-only configured object origins instead of learning hosts from signer output", () => {
    expect(configuredStorageObjectOrigins("")).toBeNull();
    expect(
      configuredStorageObjectOrigins("https://objects.synthetic.test/base"),
    ).toBeNull();
    expect(
      configuredStorageObjectOrigins(
        "https://objects.synthetic.test, https://backup.synthetic.test",
      ),
    ).toEqual(
      new Set([
        "https://objects.synthetic.test",
        "https://backup.synthetic.test",
      ]),
    );
  });
});

describe("SEC-006 final response-release linearization", () => {
  it("does not enqueue synthetic private bytes when removal wins before the final recheck", async () => {
    let currentlyApproved = true;
    const enqueued: string[] = [];
    const recheck = async () =>
      currentlyApproved
        ? {
            mimeType: "image/png",
            bytes: 4,
            requiresFinalMembershipRecheck: true,
          }
        : null;

    // The initial read/fetch may have begun while approved. The controlled removal commits before
    // the final gate, which is the production response linearization point.
    currentlyApproved = false;
    const released = await enqueueAfterFinalMediaAuthorization(recheck, () => {
      enqueued.push("plaintext");
      return true;
    });

    expect(released).toBeNull();
    expect(enqueued).toEqual([]);
  });
});
