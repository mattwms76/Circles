type VideoEntryType = "avc1" | "avc3" | "hvc1";

type TrackPadding = {
  trak?: Uint8Array[];
  mdia?: Uint8Array[];
  minf?: Uint8Array[];
  stbl?: Uint8Array[];
};

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

function esds(extraTopLevelDescriptors = 0): Uint8Array {
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
  const extraDescriptors: Uint8Array[] = [];
  for (let index = 0; index < extraTopLevelDescriptors; index += 1) {
    extraDescriptors.push(descriptor(0x06, new Uint8Array()));
  }
  return fullBox("esds", 0, 0, esDescriptor, ...extraDescriptors);
}

function audioSampleEntry(extraTopLevelDescriptors = 0): Uint8Array {
  const audioSampleEntry = new Uint8Array(28);
  writeU16(audioSampleEntry, 6, 1);
  writeU16(audioSampleEntry, 16, 2);
  writeU16(audioSampleEntry, 18, 16);
  writeU32(audioSampleEntry, 24, 44_100 * 0x10000);
  return box("mp4a", audioSampleEntry, esds(extraTopLevelDescriptors));
}

function sampleTable(
  entry: Uint8Array,
  durationMs: number,
  chunkOffset: number,
  padding: Uint8Array[] = [],
): Uint8Array {
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), entry),
    fullBox("stts", 0, 0, u32(1), u32(1), u32(durationMs)),
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)),
    fullBox("stsz", 0, 0, u32(8), u32(1)),
    fullBox("stco", 0, 0, u32(1), u32(chunkOffset)),
    ...padding,
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
  padding: TrackPadding = {},
): Uint8Array {
  const minf = box(
    "minf",
    ...(padding.minf ?? []),
    sampleTable(entry, sampleDurationMs, chunkOffset, padding.stbl),
  );
  return box(
    "trak",
    trackHeader(
      trackId,
      handlerType === "vide" ? width : 0,
      handlerType === "vide" ? height : 0,
    ),
    ...(padding.trak ?? []),
    box(
      "mdia",
      mediaHeader(headerDurationMs),
      handler(handlerType),
      ...(padding.mdia ?? []),
      minf,
    ),
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

const RESOURCE_TOP_LEVEL_BOXES = 16;
const RESOURCE_MOOV_BYTES = 4 * 1024 * 1024;
const RESOURCE_TRACKS = 4;
const RESOURCE_TABLE_ENTRIES = 120_000;
const RESOURCE_NESTED_BOXES = 64;
const RESOURCE_BRANDS = 32;
const RESOURCE_SAMPLE_DESCRIPTIONS = 16;

function standardFtyp(): Uint8Array {
  return box("ftyp", ascii("isom"), u32(0), ascii("isom"), ascii("mp42"));
}

function standardMdat(): Uint8Array {
  return box("mdat", new Uint8Array(16).fill(1));
}

function ftypWithCompatibleBrands(compatibleBrandCount: number): Uint8Array {
  const compatibleBrands: Uint8Array[] = [];
  for (let index = 0; index < compatibleBrandCount; index += 1) {
    compatibleBrands.push(ascii("isom"));
  }
  return box("ftyp", ascii("isom"), u32(0), ...compatibleBrands);
}

function freeBoxes(count: number): Uint8Array[] {
  const result: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push(box("free", new Uint8Array()));
  }
  return result;
}

function recordingWithTracks(tracks: Uint8Array[]): Uint8Array {
  const ftyp = standardFtyp();
  const mdat = standardMdat();
  return join(ftyp, mdat, box("moov", movieHeader(30_000), ...tracks));
}

function standardOffsets() {
  const ftyp = standardFtyp();
  return {
    video: ftyp.length + 8,
    audio: ftyp.length + 16,
  };
}

function trackWithSampleTable(
  trackId: number,
  handlerType: "vide" | "soun",
  table: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const minf = box("minf", table);
  return box(
    "trak",
    trackHeader(
      trackId,
      handlerType === "vide" ? width : 0,
      handlerType === "vide" ? height : 0,
    ),
    box("mdia", mediaHeader(30_000), handler(handlerType), minf),
  );
}

function stblWithSttsEntries(
  entry: Uint8Array,
  chunkOffset: number,
  entryCount: number,
): Uint8Array {
  const entries = new Uint8Array(entryCount * 8);
  for (let index = 0; index < entryCount; index += 1) {
    writeU32(entries, index * 8, 1);
    writeU32(entries, index * 8 + 4, 1);
  }
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), entry),
    fullBox("stts", 0, 0, u32(entryCount), entries),
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)),
    fullBox("stsz", 0, 0, u32(8), u32(1)),
    fullBox("stco", 0, 0, u32(1), u32(chunkOffset)),
  );
}

function stblWithChunkOffsets(
  entry: Uint8Array,
  chunkOffset: number,
  offsetCount: number,
): Uint8Array {
  const offsets = new Uint8Array(offsetCount * 4);
  for (let index = 0; index < offsetCount; index += 1) {
    writeU32(offsets, index * 4, chunkOffset);
  }
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), entry),
    fullBox("stts", 0, 0, u32(1), u32(1), u32(30_000)),
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)),
    fullBox("stsz", 0, 0, u32(8), u32(1)),
    fullBox("stco", 0, 0, u32(offsetCount), offsets),
  );
}

function stblWithSttsSampleCount(
  entry: Uint8Array,
  chunkOffset: number,
  sampleCount: number,
): Uint8Array {
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), entry),
    fullBox("stts", 0, 0, u32(1), u32(sampleCount), u32(1)),
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(sampleCount), u32(1)),
    fullBox("stsz", 0, 0, u32(8), u32(sampleCount)),
    fullBox("stco", 0, 0, u32(1), u32(chunkOffset)),
  );
}

function stblWithSampleDescriptions(
  entryCount: number,
  chunkOffset: number,
): Uint8Array {
  const entries: Uint8Array[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    entries.push(videoSampleEntry("avc1", 720, 1280));
  }
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(entryCount), ...entries),
    fullBox("stts", 0, 0, u32(1), u32(1), u32(30_000)),
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)),
    fullBox("stsz", 0, 0, u32(8), u32(1)),
    fullBox("stco", 0, 0, u32(1), u32(chunkOffset)),
  );
}

/** Top-level boxes are structurally complete but exceed the shared 16-box cap. */
export function excessiveTopLevelBoxesMp4(): Uint8Array {
  return join(
    standardFtyp(),
    ...freeBoxes(RESOURCE_TOP_LEVEL_BOXES - 2),
    standardMdat(),
    box("moov", movieHeader(30_000)),
  );
}

/** A complete ftyp with too many compatible-brand entries exceeds the brand cap. */
export function excessiveBrandsMp4(): Uint8Array {
  return join(
    ftypWithCompatibleBrands(RESOURCE_BRANDS),
    standardMdat(),
    box("moov", movieHeader(30_000)),
  );
}

/** A valid top-level moov declaration whose metadata payload exceeds 4 MiB. */
export function excessiveMoovBytesMp4(): Uint8Array {
  return join(
    standardFtyp(),
    standardMdat(),
    box("moov", box("free", new Uint8Array(RESOURCE_MOOV_BYTES))),
  );
}

/** Five complete tracks exceed the shared four-track cap before track parsing begins. */
export function excessiveTrackCountMp4(): Uint8Array {
  const offsets = standardOffsets();
  const tracks = [
    track(
      1,
      "vide",
      30_000,
      30_000,
      videoSampleEntry("avc1", 720, 1280),
      offsets.video,
      720,
      1280,
    ),
  ];
  for (let trackId = 2; trackId <= RESOURCE_TRACKS + 1; trackId += 1) {
    tracks.push(
      track(
        trackId,
        "soun",
        30_000,
        30_000,
        audioSampleEntry(),
        offsets.audio,
        720,
        1280,
      ),
    );
  }
  return recordingWithTracks(tracks);
}

/** A fully encoded stts table exceeds the per-track table-entry cap. */
export function excessiveTableEntriesMp4(): Uint8Array {
  const offsets = standardOffsets();
  return recordingWithTracks([
    trackWithSampleTable(
      1,
      "vide",
      stblWithSttsEntries(
        videoSampleEntry("avc1", 720, 1280),
        offsets.video,
        RESOURCE_TABLE_ENTRIES + 1,
      ),
      720,
      1280,
    ),
  ]);
}

/** One stts entry claiming too many samples exercises the aggregate sample cap. */
export function excessiveSttsSampleCountMp4(): Uint8Array {
  const offsets = standardOffsets();
  return recordingWithTracks([
    trackWithSampleTable(
      1,
      "vide",
      stblWithSttsSampleCount(
        videoSampleEntry("avc1", 720, 1280),
        offsets.video,
        RESOURCE_TABLE_ENTRIES + 1,
      ),
      720,
      1280,
    ),
  ]);
}

/** Fully encoded video sample descriptions exceed the stsd entry cap. */
export function excessiveSampleDescriptionsMp4(): Uint8Array {
  const offsets = standardOffsets();
  return recordingWithTracks([
    trackWithSampleTable(
      1,
      "vide",
      stblWithSampleDescriptions(
        RESOURCE_SAMPLE_DESCRIPTIONS + 1,
        offsets.video,
      ),
      720,
      1280,
    ),
  ]);
}

/** A fully encoded stco table exceeds the chunk-offset cap before offsets are allocated. */
export function excessiveChunkOffsetsMp4(): Uint8Array {
  const offsets = standardOffsets();
  return recordingWithTracks([
    trackWithSampleTable(
      1,
      "vide",
      stblWithChunkOffsets(
        videoSampleEntry("avc1", 720, 1280),
        offsets.video,
        RESOURCE_TABLE_ENTRIES + 1,
      ),
      720,
      1280,
    ),
  ]);
}

/** Extra complete descriptors exceed the per-level descriptor cap. */
export function excessiveDescriptorsMp4(): Uint8Array {
  const offsets = standardOffsets();
  return recordingWithTracks([
    track(
      1,
      "vide",
      30_000,
      30_000,
      videoSampleEntry("avc1", 720, 1280),
      offsets.video,
      720,
      1280,
    ),
    track(
      2,
      "soun",
      30_000,
      30_000,
      audioSampleEntry(RESOURCE_NESTED_BOXES / 4),
      offsets.audio,
      720,
      1280,
    ),
  ]);
}

/** A 65-box moov child level exercises the nested-box cap. */
export function excessiveNestedBoxesMp4(): Uint8Array {
  return join(
    standardFtyp(),
    standardMdat(),
    box("moov", movieHeader(30_000), ...freeBoxes(RESOURCE_NESTED_BOXES)),
  );
}

/** Multiple individually valid nested levels exceed the aggregate parsed-box budget. */
export function excessiveTotalBoxBudgetMp4(): Uint8Array {
  const offsets = standardOffsets();
  return recordingWithTracks([
    track(
      1,
      "vide",
      30_000,
      30_000,
      videoSampleEntry("avc1", 720, 1280),
      offsets.video,
      720,
      1280,
      {
        trak: freeBoxes(RESOURCE_NESTED_BOXES - 2),
        mdia: freeBoxes(RESOURCE_NESTED_BOXES - 3),
        minf: freeBoxes(RESOURCE_NESTED_BOXES - 1),
        stbl: freeBoxes(RESOURCE_NESTED_BOXES - 5),
      },
    ),
  ]);
}

export function truncateFixture(bytesToTruncate: number): Uint8Array {
  const fixture = syntheticRecordedMp4();
  return fixture.slice(0, Math.max(0, fixture.length - bytesToTruncate));
}
