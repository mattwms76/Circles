import { Buffer } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteRecordedVideo,
  prepareRecordedVideo,
  recordedVideoBase64,
} from "../lib/recorded-video-files.native";
import {
  inspectRecordedMp4,
  MAX_RECORDED_VIDEO_BYTES,
} from "../shared/recorded-video";
import { syntheticRecordedMp4, truncateFixture } from "./fixtures/recorded-mp4";

const mockedFileSystem = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  declaredSizes: new Map<string, number>(),
  createdDirectories: [] as string[],
  deletedUris: [] as string[],
  events: [] as string[],
  readLengths: [] as number[],
  failCopy: false,
}));

vi.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));

vi.mock("expo-file-system", () => {
  const fileUri = (parts: ({ uri: string } | string)[]) => {
    const [first, ...rest] = parts;
    const base = typeof first === "string" ? first : first.uri;
    if (rest.length === 0) return base;
    return `${base.replace(/\/+$/, "")}/${rest
      .map((part) => (typeof part === "string" ? part : part.uri))
      .join("/")}`;
  };

  class Directory {
    readonly uri: string;

    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri = fileUri(parts);
    }

    create() {
      mockedFileSystem.createdDirectories.push(this.uri);
    }
  }

  class File {
    readonly uri: string;

    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri = fileUri(parts);
    }

    get exists() {
      return mockedFileSystem.files.has(this.uri);
    }

    info() {
      mockedFileSystem.events.push(`info:${this.uri}`);
      const bytes = mockedFileSystem.files.get(this.uri);
      return {
        exists: !!bytes,
        size: bytes
          ? (mockedFileSystem.declaredSizes.get(this.uri) ?? bytes.byteLength)
          : undefined,
      };
    }

    open() {
      mockedFileSystem.events.push(`open:${this.uri}`);
      const bytes = mockedFileSystem.files.get(this.uri);
      if (!bytes) throw new Error("mock file is missing");
      const size =
        mockedFileSystem.declaredSizes.get(this.uri) ?? bytes.byteLength;
      const uri = this.uri;
      let offset = 0;
      return {
        size,
        readBytes(length: number) {
          mockedFileSystem.readLengths.push(length);
          const current = mockedFileSystem.files.get(uri) ?? new Uint8Array();
          const result = current.slice(
            offset,
            Math.min(offset + length, current.length),
          );
          offset += result.byteLength;
          return result;
        },
        close() {},
      };
    }

    async copy(destination: File) {
      mockedFileSystem.events.push(`copy:${this.uri}:${destination.uri}`);
      if (mockedFileSystem.failCopy) throw new Error("copy failed");
      const bytes = mockedFileSystem.files.get(this.uri);
      if (!bytes) throw new Error("mock file is missing");
      mockedFileSystem.files.set(destination.uri, bytes.slice());
    }

    delete() {
      mockedFileSystem.deletedUris.push(this.uri);
      mockedFileSystem.files.delete(this.uri);
    }
  }

  return {
    Directory,
    File,
    FileMode: { ReadOnly: "r" },
    Paths: { cache: { uri: "file:///cache" } },
  };
});

const twentyMiB = MAX_RECORDED_VIDEO_BYTES;
const cameraUri = "file:///cache/Camera/camera-output.mp4";
const ownedUri = "file:///cache/circles-recorded-videos/owned.mp4";

beforeEach(() => {
  mockedFileSystem.files.clear();
  mockedFileSystem.declaredSizes.clear();
  mockedFileSystem.createdDirectories.length = 0;
  mockedFileSystem.deletedUris.length = 0;
  mockedFileSystem.events.length = 0;
  mockedFileSystem.readLengths.length = 0;
  mockedFileSystem.failCopy = false;
});

function inspect(
  bytes = syntheticRecordedMp4(),
  maxDurationSeconds: 30 | 60 = 30,
  maxBytes = twentyMiB,
) {
  return inspectRecordedMp4(bytes, { maxDurationSeconds, maxBytes });
}

describe("inspectRecordedMp4", () => {
  it("reads actual AVC/AAC timing, dimensions, and byte size from a nonfragmented MP4", () => {
    const bytes = syntheticRecordedMp4({
      durationMs: 29_999,
      width: 720,
      height: 1280,
    });

    expect(inspect(bytes)).toEqual({
      mimeType: "video/mp4",
      fileSize: bytes.byteLength,
      durationMs: 29_999,
      width: 720,
      height: 1280,
    });
  });

  it("permits a complete 60-second recording only when that duration was selected", () => {
    const bytes = syntheticRecordedMp4({ durationMs: 60_000 });

    expect(inspect(bytes, 60)).toMatchObject({ durationMs: 60_000 });
    expect(() => inspect(bytes, 30)).toThrow(
      "This recording is longer than the selected time limit.",
    );
  });

  it("uses the longest movie, video, or audio timing and does not round a clip down under its limit", () => {
    const bytes = syntheticRecordedMp4({
      durationMs: 30_000,
      movieDurationMs: 30_000,
      audioDurationMs: 30_001,
    });

    expect(() => inspect(bytes)).toThrow(
      "This recording is longer than the selected time limit.",
    );
  });

  it("does not trust forged short movie or media headers when sample timing is longer", () => {
    const bytes = syntheticRecordedMp4({
      durationMs: 1,
      movieDurationMs: 1,
      audioDurationMs: 1,
      videoSampleDurationMs: 30_001,
      audioSampleDurationMs: 30_001,
    });

    expect(() => inspect(bytes)).toThrow(
      "This recording is longer than the selected time limit.",
    );
  });

  it("enforces the caller's effective cap and never permits a cap over 20 MiB", () => {
    const smallFixture = syntheticRecordedMp4();
    expect(() =>
      inspect(smallFixture, 30, smallFixture.byteLength - 1),
    ).toThrow("Keep your recorded video under the allowed size.");

    expect(() =>
      inspectRecordedMp4(new Uint8Array(MAX_RECORDED_VIDEO_BYTES + 1), {
        maxDurationSeconds: 30,
        maxBytes: MAX_RECORDED_VIDEO_BYTES + 1_024,
      }),
    ).toThrow("Keep your recorded video under the allowed size.");
  });

  it("rejects QuickTime brands, HEVC sample entries, and absent AAC audio", () => {
    expect(() => inspect(syntheticRecordedMp4({ majorBrand: "qt  " }))).toThrow(
      "Choose a standard MP4 video.",
    );
    expect(() =>
      inspect(syntheticRecordedMp4({ videoEntryType: "hvc1" })),
    ).toThrow("This video must use H.264 video with AAC audio.");
    expect(() =>
      inspect(syntheticRecordedMp4({ includeAudio: false })),
    ).toThrow("This video must use H.264 video with AAC audio.");
  });

  it("rejects fragmented, malformed, truncated, and invalid-chunk MP4 structures", () => {
    expect(() => inspect(syntheticRecordedMp4({ fragmented: true }))).toThrow(
      "This fragmented MP4 recording is not supported.",
    );
    expect(() => inspect(truncateFixture(4))).toThrow(
      "This MP4 file is incomplete or damaged.",
    );
    expect(() =>
      inspect(syntheticRecordedMp4({ invalidChunkOffset: true })),
    ).toThrow("This MP4 file is incomplete or damaged.");

    const valid = syntheticRecordedMp4();
    const withTrailingByte = new Uint8Array(valid.byteLength + 1);
    withTrailingByte.set(valid);
    expect(() => inspect(withTrailingByte)).toThrow(
      "This MP4 file is incomplete or damaged.",
    );
  });

  it("rejects invalid recording duration contracts rather than inferring a duration", () => {
    expect(() =>
      inspectRecordedMp4(syntheticRecordedMp4(), {
        maxDurationSeconds: 45 as 30,
        maxBytes: twentyMiB,
      }),
    ).toThrow("Choose a 30- or 60-second recording length.");
  });
});

describe("native recorded-video file adapter", () => {
  it("stats before bounded reads, adopts a validated Camera cache file, and cleans its temp output", async () => {
    const bytes = syntheticRecordedMp4();
    mockedFileSystem.files.set(cameraUri, bytes);

    const draft = await prepareRecordedVideo(cameraUri, 30, twentyMiB);

    expect(draft.localUri).toBe(
      "file:///cache/circles-recorded-videos/recorded-11111111-1111-4111-8111-111111111111.mp4",
    );
    expect(mockedFileSystem.events.slice(0, 2)).toEqual([
      `info:${cameraUri}`,
      `open:${cameraUri}`,
    ]);
    expect(mockedFileSystem.readLengths).toEqual([
      bytes.byteLength,
      1,
      bytes.byteLength,
      1,
    ]);
    expect(mockedFileSystem.deletedUris).toEqual([cameraUri]);
    expect(mockedFileSystem.files.get(draft.localUri)).toEqual(bytes);
  });

  it("does not open a file whose stat already exceeds the capped read limit", async () => {
    mockedFileSystem.files.set(cameraUri, syntheticRecordedMp4());
    mockedFileSystem.declaredSizes.set(cameraUri, twentyMiB + 1);

    await expect(
      prepareRecordedVideo(cameraUri, 30, twentyMiB),
    ).rejects.toThrow("Keep your recorded video under the allowed size.");
    expect(mockedFileSystem.events).toEqual([`info:${cameraUri}`]);
    expect(mockedFileSystem.readLengths).toEqual([]);
    expect(mockedFileSystem.deletedUris).toEqual([cameraUri]);
  });

  it("cleans a known Camera temp file after a failed adoption without accepting raw copy errors", async () => {
    mockedFileSystem.files.set(cameraUri, syntheticRecordedMp4());
    mockedFileSystem.failCopy = true;

    await expect(
      prepareRecordedVideo(cameraUri, 30, twentyMiB),
    ).rejects.toThrow(
      "This recording could not be prepared. Record it again and try again.",
    );
    expect(mockedFileSystem.deletedUris).toEqual([cameraUri]);
  });

  it("deletes only a canonical direct child of the owned directory", async () => {
    const libraryUri = "file:///cache/Library/keep.mp4";
    const traversalUri =
      "file:///cache/circles-recorded-videos/../Library/keep.mp4";
    const encodedTraversalUri =
      "file:///cache/circles-recorded-videos/%2e%2e%2fLibrary%2fkeep.mp4";
    const dotUri = "file:///cache/circles-recorded-videos/..";
    mockedFileSystem.files.set(ownedUri, syntheticRecordedMp4());
    mockedFileSystem.files.set(libraryUri, syntheticRecordedMp4());

    await deleteRecordedVideo(libraryUri);
    await deleteRecordedVideo(traversalUri);
    await deleteRecordedVideo(encodedTraversalUri);
    await deleteRecordedVideo(dotUri);
    await deleteRecordedVideo("content://library/keep.mp4");
    await deleteRecordedVideo(ownedUri);

    expect(mockedFileSystem.deletedUris).toEqual([ownedUri]);
    expect(mockedFileSystem.files.has(libraryUri)).toBe(true);
  });

  it("revalidates and encodes only the app-owned draft at explicit publish time", async () => {
    const bytes = syntheticRecordedMp4();
    const metadata = inspect(bytes);
    mockedFileSystem.files.set(ownedUri, bytes);
    const draft = {
      ...metadata,
      localUri: ownedUri,
      maxDurationSeconds: 30 as const,
    };

    expect(mockedFileSystem.events).toEqual([]);
    await expect(recordedVideoBase64(draft, twentyMiB)).resolves.toBe(
      Buffer.from(bytes).toString("base64"),
    );
    expect(mockedFileSystem.events.slice(0, 2)).toEqual([
      `info:${ownedUri}`,
      `open:${ownedUri}`,
    ]);
    expect(mockedFileSystem.readLengths).toEqual([bytes.byteLength, 1]);
  });
});
