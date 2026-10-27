type VideoEntryType = "avc1" | "avc3" | "hvc1";

export type SyntheticMp4Options = {
  durationMs?: number;
  movieDurationMs?: number;
  audioDurationMs?: number;
  videoSampleDurationMs?: number;
  audioSampleDurationMs?: number;
  width?: number;
  height?: number;
  majorBrand?: string;
  videoEntryType?: VideoEntryType;
  includeAudio?: boolean;
  fragmented?: boolean;
  invalidChunkOffset?: boolean;
};

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(value: string): Uint8Array {
  if (value.length !== 4)
    throw new Error("Synthetic MP4 four-character codes must be four bytes.");
  return bytes(...[...value].map((character) => character.charCodeAt(0)));
}

function u16(value: number): Uint8Array {
  return bytes((value >>> 8) & 0xff, value & 0xff);
}

function u32(value: number): Uint8Array {
  return bytes(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function join(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function writeU16(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 8) & 0xff;
  target[offset + 1] = value & 0xff;
}

function writeU32(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = join(...payload);
  return join(u32(body.length + 8), ascii(type), body);
}

function fullBox(
  type: string,
  version: number,
  flags: number,
  ...payload: Uint8Array[]
): Uint8Array {
  return box(
    type,
    bytes(version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff),
    ...payload,
  );
}

function descriptor(tag: number, payload: Uint8Array): Uint8Array {
  if (payload.length >= 0x80) {
    throw new Error(
      "Synthetic descriptor payload unexpectedly needs a multibyte length.",
    );
  }
  return join(bytes(tag, payload.length), payload);
}

function movieHeader(durationMs: number): Uint8Array {
  // FullBox + MVHD v0 fields, including matrix/predefined/next-track fields.
  const body = new Uint8Array(96);
  writeU32(body, 8, 1000);
  writeU32(body, 12, durationMs);
  writeU32(body, 16, 0x00010000); // rate = 1.0
  writeU16(body, 20, 0x0100); // volume = 1.0
  writeU32(body, 40, 0x00010000); // identity matrix
  writeU32(body, 56, 0x00010000);
  writeU32(body, 72, 0x40000000);
  writeU32(body, 92, 3);
  return fullBox("mvhd", 0, 0, body);
}

function trackHeader(
  trackId: number,
  width: number,
  height: number,
): Uint8Array {
  // FullBox + TKHD v0 fields through width/height.
  const body = new Uint8Array(80);
  writeU32(body, 8, trackId);
  writeU32(body, 36, 0x00010000);
  writeU32(body, 52, 0x00010000);
  writeU32(body, 68, 0x40000000);
  writeU32(body, 72, width * 0x10000);
  writeU32(body, 76, height * 0x10000);
  return fullBox("tkhd", 0, 7, body);
}

function mediaHeader(durationMs: number): Uint8Array {
  const body = new Uint8Array(20);
  writeU32(body, 8, 1000);
  writeU32(body, 12, durationMs);
  return fullBox("mdhd", 0, 0, body);
}

function handler(type: string): Uint8Array {
  return fullBox("hdlr", 0, 0, join(u32(0), ascii(type), new Uint8Array(12)));
}

function avcConfiguration(): Uint8Array {
  return box(
    "avcC",
    bytes(1, 66, 0, 30, 0xff, 0xe1, 0, 2, 0x67, 0x42, 1, 0, 2, 0x68, 0),
  );
}

function videoSampleEntry(
  type: VideoEntryType,
  width: number,
  height: number,
): Uint8Array {
  const visualSampleEntry = new Uint8Array(78);
  writeU16(visualSampleEntry, 6, 1);
  writeU16(visualSampleEntry, 24, width);
  writeU16(visualSampleEntry, 26, height);
  writeU32(visualSampleEntry, 28, 0x00480000);
  writeU32(visualSampleEntry, 32, 0x00480000);
  writeU16(visualSampleEntry, 40, 1);
  writeU16(visualSampleEntry, 74, 24);
  return box(type, visualSampleEntry, avcConfiguration());
}

function esds(): Uint8Array {
  const audioSpecificConfig = descriptor(0x05, bytes(0x12, 0x10)); // AAC LC, 44.1 kHz, stereo
  const decoderConfig = descriptor(
    0x04,
    join(
      bytes(0x40, 0x15),
      bytes(0, 0, 0),
      u32(128_000),
      u32(128_000),
      audioSpecificConfig,
    ),
  );
  const esDescriptor = descriptor(0x03, join(u16(1), bytes(0), decoderConfig));
  return fullBox("esds", 0, 0, esDescriptor);
}

function audioSampleEntry(): Uint8Array {
  const audioSampleEntry = new Uint8Array(28);
  writeU16(audioSampleEntry, 6, 1);
  writeU16(audioSampleEntry, 16, 2);
  writeU16(audioSampleEntry, 18, 16);
  writeU32(audioSampleEntry, 24, 44_100 * 0x10000);
  return box("mp4a", audioSampleEntry, esds());
}

function sampleTable(
  entry: Uint8Array,
  durationMs: number,
  chunkOffset: number,
): Uint8Array {
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), entry),
    fullBox("stts", 0, 0, u32(1), u32(1), u32(durationMs)),
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)),
    fullBox("stsz", 0, 0, u32(8), u32(1)),
    fullBox("stco", 0, 0, u32(1), u32(chunkOffset)),
  );
}

function track(
  trackId: number,
  handlerType: "vide" | "soun",
  headerDurationMs: number,
  sampleDurationMs: number,
  entry: Uint8Array,
  chunkOffset: number,
  width: number,
  height: number,
): Uint8Array {
  const minf = box("minf", sampleTable(entry, sampleDurationMs, chunkOffset));
  return box(
    "trak",
    trackHeader(
      trackId,
      handlerType === "vide" ? width : 0,
      handlerType === "vide" ? height : 0,
    ),
    box("mdia", mediaHeader(headerDurationMs), handler(handlerType), minf),
  );
}

/**
 * A compact, synthetic nonfragmented AVC/AAC MP4 with complete headers and
 * one sample per media track. It is intentionally generated in memory only.
 */
export function syntheticRecordedMp4(
  options: SyntheticMp4Options = {},
): Uint8Array {
  const durationMs = options.durationMs ?? 30_000;
  const movieDurationMs = options.movieDurationMs ?? durationMs;
  const audioDurationMs = options.audioDurationMs ?? durationMs;
  const videoSampleDurationMs = options.videoSampleDurationMs ?? durationMs;
  const audioSampleDurationMs =
    options.audioSampleDurationMs ?? audioDurationMs;
  const width = options.width ?? 720;
  const height = options.height ?? 1280;
  const majorBrand = options.majorBrand ?? "isom";
  const videoEntryType = options.videoEntryType ?? "avc1";
  const ftyp = box(
    "ftyp",
    ascii(majorBrand),
    u32(0),
    ascii("isom"),
    ascii("mp42"),
  );
  const mdat = box("mdat", new Uint8Array(16).fill(1));
  const videoChunkOffset = options.invalidChunkOffset ? 0 : ftyp.length + 8;
  const audioChunkOffset = ftyp.length + 16;

  const tracks = [
    track(
      1,
      "vide",
      durationMs,
      videoSampleDurationMs,
      videoSampleEntry(videoEntryType, width, height),
      videoChunkOffset,
      width,
      height,
    ),
  ];
  if (options.includeAudio !== false) {
    tracks.push(
      track(
        2,
        "soun",
        audioDurationMs,
        audioSampleDurationMs,
        audioSampleEntry(),
        audioChunkOffset,
        width,
        height,
      ),
    );
  }

  const fragment = options.fragmented
    ? box("moof", new Uint8Array())
    : new Uint8Array();
  return join(
    ftyp,
    mdat,
    fragment,
    box("moov", movieHeader(movieDurationMs), ...tracks),
  );
}

export function truncateFixture(bytesToTruncate: number): Uint8Array {
  const fixture = syntheticRecordedMp4();
  return fixture.slice(0, Math.max(0, fixture.length - bytesToTruncate));
}
