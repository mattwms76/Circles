import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

export const MAX_MP4_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_MP4_DURATION_SECONDS = 5 * 60;
export const MAX_MP4_PIXELS = 16 * 1024 * 1024;

const MAX_TOP_LEVEL_BOXES = 16;
const MAX_MOOV_BYTES = 4 * 1024 * 1024;
const MAX_TRACKS = 4;
const MAX_TRACK_SAMPLES = 120_000;
const MP4_PARSE_TIMEOUT_MS = 1_500;
// The production bundle lives in dist while direct production dependencies live beside it.
// Resolve the reviewed CJS export relative to this emitted module and pass the exact result to
// the eval worker; bare worker require("mp4box") would resolve from eval's generated path.
const requireFromServerModule = createRequire(import.meta.url);
const MP4BOX_CJS_ENTRY = requireFromServerModule.resolve("mp4box");

export class Mp4ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mp4ValidationError";
  }
}

type ParsedTrack = {
  codec: unknown;
  duration: unknown;
  timescale: unknown;
  nb_samples: unknown;
  track_width: unknown;
  track_height: unknown;
  video?: { width: unknown; height: unknown };
  audio?: { sample_rate: unknown; channel_count: unknown };
};

type ParsedMp4 = {
  duration: unknown;
  timescale: unknown;
  isFragmented: unknown;
  topLevelBoxes: unknown;
  tracks: unknown;
};

type WorkerResult =
  | { ok: true; parsed: ParsedMp4 }
  | { ok: false; message: string };

/**
 * The worker receives only a detached copy of an already byte-bounded upload. It uses the
 * maintained MP4Box parser for ISO-BMFF structure and metadata, while a small preflight only
 * bounds top-level declared box sizes before handing bytes to the parser. No samples are decoded,
 * extracted, retained, or transcoded.
 */
const MP4_PARSER_WORKER = String.raw`
const { parentPort, workerData } = require("node:worker_threads");

const MAX_BYTES = ${MAX_MP4_UPLOAD_BYTES};
const MAX_TOP_LEVEL_BOXES = ${MAX_TOP_LEVEL_BOXES};
const MAX_MOOV_BYTES = ${MAX_MOOV_BYTES};

function fail(message) {
  parentPort.postMessage({ ok: false, message });
  parentPort.close();
}

function readBoxSize(bytes, offset, size32) {
  if (size32 === 0) return bytes.length - offset;
  if (size32 !== 1) return size32;
  if (offset + 16 > bytes.length) {
    throw new Error("MP4 upload has a truncated extended box header");
  }
  const high = bytes.readUInt32BE(offset + 8);
  const low = bytes.readUInt32BE(offset + 12);
  const size = high * 0x1_0000_0000 + low;
  if (!Number.isSafeInteger(size)) {
    throw new Error("MP4 upload has an unsafe box size");
  }
  return size;
}

function preflightTopLevelBoxes(bytes) {
  const boxes = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (boxes.length >= MAX_TOP_LEVEL_BOXES) {
      throw new Error("MP4 upload has too many top-level boxes");
    }
    if (bytes.length - offset < 8) {
      throw new Error("MP4 upload has a truncated top-level box");
    }
    const size32 = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const headerBytes = size32 === 1 ? 16 : 8;
    const size = readBoxSize(bytes, offset, size32);
    if (size < headerBytes || size > bytes.length - offset) {
      throw new Error("MP4 upload has a truncated or invalid top-level box");
    }
    if (type === "moov" && size > MAX_MOOV_BYTES) {
      throw new Error("MP4 upload metadata exceeds the 4 MB resource limit");
    }
    boxes.push({ type, size });
    offset += size;
  }

  if (!boxes.length || offset !== bytes.length) {
    throw new Error("MP4 upload is not a complete ISO-BMFF file");
  }
  return boxes;
}

function serializeTrack(track) {
  return {
    codec: track.codec,
    duration: track.duration,
    timescale: track.timescale,
    nb_samples: track.nb_samples,
    track_width: track.track_width,
    track_height: track.track_height,
    video: track.video
      ? { width: track.video.width, height: track.video.height }
      : undefined,
    audio: track.audio
      ? {
          sample_rate: track.audio.sample_rate,
          channel_count: track.audio.channel_count,
        }
      : undefined,
  };
}

try {
  if (
    !workerData ||
    !(workerData.bytes instanceof ArrayBuffer) ||
    workerData.bytes.byteLength < 1 ||
    workerData.bytes.byteLength > MAX_BYTES ||
    typeof workerData.mp4boxEntry !== "string"
  ) {
    throw new Error("MP4 upload must be between 1 byte and 20 MB");
  }

  const bytes = Buffer.from(workerData.bytes);
  const preflight = preflightTopLevelBoxes(bytes);
  const MP4Box = require(workerData.mp4boxEntry);
  const file = MP4Box.createFile(false, undefined, { allowInvalidBoxTypes: false });
  let parserError;
  let info;
  file.onError = (message) => {
    parserError = String(message || "invalid ISO-BMFF data");
  };
  file.onReady = (parsed) => {
    info = parsed;
  };

  workerData.bytes.fileStart = 0;
  file.appendBuffer(workerData.bytes);
  file.flush();

  if (parserError) {
    throw new Error("MP4Box rejected the ISO-BMFF structure");
  }
  if (!info) {
    throw new Error("MP4 upload is missing complete movie metadata");
  }

  const parsedTopLevelBoxes = Array.isArray(file.boxes)
    ? file.boxes.map((box) => box.type)
    : [];
  if (
    parsedTopLevelBoxes.length !== preflight.length ||
    parsedTopLevelBoxes.some((type, index) => type !== preflight[index].type)
  ) {
    throw new Error("MP4Box could not structurally parse every top-level box");
  }

  parentPort.postMessage({
    ok: true,
    parsed: {
      duration: info.duration,
      timescale: info.timescale,
      isFragmented: info.isFragmented,
      topLevelBoxes: parsedTopLevelBoxes,
      tracks: Array.isArray(info.tracks) ? info.tracks.map(serializeTrack) : [],
    },
  });
  parentPort.close();
} catch (error) {
  fail(error instanceof Error ? error.message : "MP4 upload could not be parsed");
}
`;

function validationFailure(message: string): never {
  throw new Mp4ValidationError(message);
}

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function durationSeconds(duration: unknown, timescale: unknown): number {
  if (
    !isFinitePositiveInteger(duration) ||
    !isFinitePositiveInteger(timescale)
  ) {
    return validationFailure("MP4 upload has invalid duration metadata");
  }
  const seconds = duration / timescale;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return validationFailure("MP4 upload has invalid duration metadata");
  }
  return seconds;
}

function rejectInvalidWorkerResult(result: WorkerResult): ParsedMp4 {
  if (!result.ok) {
    return validationFailure(
      result.message.startsWith("MP4")
        ? result.message
        : "MP4 upload could not be structurally parsed",
    );
  }
  return result.parsed;
}

async function parseInBoundedWorker(bytes: Buffer): Promise<ParsedMp4> {
  // Keep the caller-owned upload intact for encryption/storage. Transfer a distinct exact-size
  // ArrayBuffer so the parser worker cannot retain a shared view of application memory.
  const transferred = Uint8Array.from(bytes).buffer;

  return new Promise<ParsedMp4>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(MP4_PARSER_WORKER, {
      eval: true,
      workerData: { bytes: transferred, mp4boxEntry: MP4BOX_CJS_ENTRY },
      transferList: [transferred],
      env: {},
      // The worker source is deliberately CommonJS so it can require the resolved CJS parser
      // entry. Do not inherit parent flags such as --input-type=module into this eval worker.
      execArgv: [],
      name: "sec27-mp4",
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
        codeRangeSizeMb: 4,
        stackSizeMb: 2,
      },
    });

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      callback();
    };
    const timeout = setTimeout(() => {
      settle(() =>
        reject(
          new Mp4ValidationError(
            "MP4 validation exceeded the 1.5 second resource limit",
          ),
        ),
      );
    }, MP4_PARSE_TIMEOUT_MS);

    worker.once("message", (result: WorkerResult) => {
      settle(() => {
        try {
          resolve(rejectInvalidWorkerResult(result));
        } catch (error) {
          reject(error);
        }
      });
    });
    worker.once("error", () => {
      settle(() =>
        reject(
          new Mp4ValidationError("MP4 upload could not be structurally parsed"),
        ),
      );
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        settle(() =>
          reject(
            new Mp4ValidationError("MP4 validation worker exited unexpectedly"),
          ),
        );
      }
    });
  });
}

function hasSupportedVideoCodec(codec: string): boolean {
  return /^(avc1|avc3|hvc1|hev1)\./.test(codec);
}

function hasSupportedAacCodec(codec: string): boolean {
  // AAC Main, LC, HE-AAC, and HE-AACv2 codec identifiers used by iOS/Android MP4 exports.
  return /^mp4a\.40\.(1|2|5|29)$/.test(codec);
}

function validateParsedMp4(parsed: ParsedMp4): void {
  if (parsed.isFragmented === true) {
    validationFailure("Fragmented MP4 uploads are not supported");
  }
  if (!Array.isArray(parsed.topLevelBoxes)) {
    validationFailure("MP4Box did not return top-level box metadata");
  }
  const topLevelBoxes = parsed.topLevelBoxes;
  if (
    topLevelBoxes.filter((box) => box === "ftyp").length !== 1 ||
    topLevelBoxes.filter((box) => box === "moov").length !== 1 ||
    !topLevelBoxes.includes("mdat")
  ) {
    validationFailure(
      "MP4 upload must contain one ftyp, one moov, and at least one mdat box",
    );
  }
  if (topLevelBoxes.includes("moof")) {
    validationFailure("Fragmented MP4 uploads are not supported");
  }

  if (
    durationSeconds(parsed.duration, parsed.timescale) >
    MAX_MP4_DURATION_SECONDS
  ) {
    validationFailure("MP4 upload exceeds the 5 minute duration limit");
  }

  if (
    !Array.isArray(parsed.tracks) ||
    !parsed.tracks.length ||
    parsed.tracks.length > MAX_TRACKS
  ) {
    validationFailure("MP4 upload has an unsupported number of tracks");
  }

  let videoTracks = 0;
  for (const track of parsed.tracks as ParsedTrack[]) {
    if (
      !isFiniteNonNegativeInteger(track.nb_samples) ||
      track.nb_samples > MAX_TRACK_SAMPLES
    ) {
      validationFailure("MP4 upload exceeds the track sample resource limit");
    }
    if (
      durationSeconds(track.duration, track.timescale) >
      MAX_MP4_DURATION_SECONDS
    ) {
      validationFailure("MP4 upload exceeds the 5 minute duration limit");
    }
    if (typeof track.codec !== "string") {
      validationFailure("MP4 upload has missing track codec metadata");
    }
    const codec = track.codec.toLowerCase();

    if (track.video) {
      if (!hasSupportedVideoCodec(codec)) {
        validationFailure("MP4 upload has an unsupported video codec");
      }
      const widths = [track.video.width, track.track_width];
      const heights = [track.video.height, track.track_height];
      if (
        !widths.every(isFinitePositiveInteger) ||
        !heights.every(isFinitePositiveInteger)
      ) {
        validationFailure("MP4 upload has invalid video dimensions");
      }
      const width = Math.max(...widths);
      const height = Math.max(...heights);
      if (width * height > MAX_MP4_PIXELS) {
        validationFailure("MP4 upload exceeds the 16 megapixel limit");
      }
      videoTracks += 1;
      continue;
    }

    if (track.audio) {
      if (!hasSupportedAacCodec(codec)) {
        validationFailure("MP4 upload has an unsupported audio codec");
      }
      continue;
    }

    validationFailure("MP4 upload has an unsupported media track");
  }

  if (videoTracks !== 1) {
    validationFailure(
      "MP4 upload must contain exactly one H.264 or HEVC video track",
    );
  }
}

/**
 * Validates a complete, unfragmented MP4 upload for native iOS/Android publication. This is an
 * admission check only: it does not decode, transcode, or otherwise process video/audio samples.
 */
export async function validateMp4Upload(bytes: Buffer): Promise<void> {
  if (!bytes.length || bytes.length > MAX_MP4_UPLOAD_BYTES) {
    validationFailure("MP4 upload must be between 1 byte and 20 MB");
  }
  const parsed = await parseInBoundedWorker(bytes);
  validateParsedMp4(parsed);
}
