export type RecordingDuration = 30 | 60;

export const RECORDING_DURATIONS = [30, 60] as const;
export const MAX_RECORDED_VIDEO_BYTES = 20 * 1024 * 1024;

export type RecordedVideoMetadata = {
  mimeType: "video/mp4";
  fileSize: number;
  durationMs: number;
  width: number;
  height: number;
};

export type RecordedVideoDraft = RecordedVideoMetadata & {
  localUri: string;
  maxDurationSeconds: RecordingDuration;
};

type Box = {
  type: string;
  start: number;
  dataStart: number;
  end: number;
  headerSize: number;
};

type Timing = {
  duration: bigint;
  timescale: number;
};

type MdatRange = {
  dataStart: number;
  end: number;
};

type SampleDescription = {
  entryCount: number;
  width?: number;
  height?: number;
};

type ParsedTrack = {
  handlerType: string;
  timing: Timing;
  width?: number;
  height?: number;
};

type SampleToChunk = {
  firstChunk: number;
  samplesPerChunk: number;
};

const SUPPORTED_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "iso7",
  "iso8",
  "mp41",
  "mp42",
  "avc1",
  "M4V ",
]);

const AAC_AUDIO_OBJECT_TYPES = new Set([
  1, 2, 3, 4, 5, 6, 17, 19, 20, 21, 22, 23, 29,
]);

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_TOP_LEVEL_BOXES = 16;
const MAX_MOOV_BYTES = 4 * 1024 * 1024;
const MAX_TRACKS = 4;
const MAX_TRACK_SAMPLES = 120_000;
const MAX_NESTED_BOXES_PER_LEVEL = 64;
const MAX_TOTAL_PARSED_BOXES = 256;
const MAX_SAMPLE_DESCRIPTIONS = 16;
const MAX_TABLE_ENTRIES = MAX_TRACK_SAMPLES;
const MAX_COMPATIBLE_BRANDS = 32;
const MAX_DESCRIPTORS_PER_LEVEL = 16;
const MAX_TOTAL_DESCRIPTORS = 32;
const MAX_PARAMETER_SETS = 32;
const MAX_ITERATION_WORK = 1_000_000;
const MAX_TRACK_SAMPLES_BIGINT = BigInt(MAX_TRACK_SAMPLES);
const RECORDED_MP4_RESOURCE_ERROR =
  "This MP4 file exceeds the recording metadata resource limit.";

type ParseBudget = {
  parsedBoxes: number;
  descriptors: number;
  iterationWork: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function malformed(): never {
  return fail(
    "This MP4 file is incomplete or damaged. Record it again and try again.",
  );
}

function unsupportedContainer(): never {
  return fail(
    "Choose a standard MP4 video. QuickTime, WebM, and other video formats are not supported.",
  );
}

function unsupportedCodec(): never {
  return fail("This video must use H.264 video with AAC audio.");
}

function missingMetadata(): never {
  return fail("This video is missing the metadata needed to publish it.");
}

function resourceLimit(): never {
  return fail(RECORDED_MP4_RESOURCE_ERROR);
}

function createParseBudget(): ParseBudget {
  return { parsedBoxes: 0, descriptors: 0, iterationWork: 0 };
}

function consumeParsedBox(budget: ParseBudget) {
  if (budget.parsedBoxes >= MAX_TOTAL_PARSED_BOXES) resourceLimit();
  budget.parsedBoxes += 1;
}

function consumeDescriptor(budget: ParseBudget) {
  if (budget.descriptors >= MAX_TOTAL_DESCRIPTORS) resourceLimit();
  budget.descriptors += 1;
}

function consumeIterationWork(budget: ParseBudget, work: number) {
  if (!Number.isSafeInteger(work) || work < 0) resourceLimit();
  if (budget.iterationWork > MAX_ITERATION_WORK - work) resourceLimit();
  budget.iterationWork += work;
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) malformed();
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) malformed();
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readU64(bytes: Uint8Array, offset: number): bigint {
  return (
    (BigInt(readU32(bytes, offset)) << 32n) | BigInt(readU32(bytes, offset + 4))
  );
}

function readType(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.length) malformed();
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function asSafeNumber(value: bigint): number {
  if (value > MAX_SAFE_BIGINT) malformed();
  return Number(value);
}

/** Parses one bounded, non-recursive ISO-BMFF box sequence. */
function parseBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  budget: ParseBudget,
  maxBoxes: number,
): Box[] {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > bytes.length
  ) {
    malformed();
  }

  const boxes: Box[] = [];
  let offset = start;
  while (offset < end) {
    if (boxes.length >= maxBoxes) resourceLimit();
    consumeIterationWork(budget, 1);
    if (end - offset < 8) malformed();

    const size32 = readU32(bytes, offset);
    const type = readType(bytes, offset + 4);
    let headerSize = 8;
    let size: number;

    if (size32 === 1) {
      if (end - offset < 16) malformed();
      size = asSafeNumber(readU64(bytes, offset + 8));
      headerSize = 16;
    } else if (size32 === 0) {
      // A zero-sized box is permitted only as the final box in this sequence.
      size = end - offset;
    } else {
      size = size32;
    }

    if (type === "uuid") headerSize += 16;
    if (size < headerSize || size > end - offset) malformed();

    const box: Box = {
      type,
      start: offset,
      dataStart: offset + headerSize,
      end: offset + size,
      headerSize,
    };
    consumeParsedBox(budget);
    boxes.push(box);
    offset = box.end;
  }

  if (offset !== end) malformed();
  return boxes;
}

function exactlyOne(
  boxes: readonly Box[],
  type: string,
  onMissing: () => never,
  budget: ParseBudget,
): Box {
  consumeIterationWork(budget, boxes.length);
  let match: Box | undefined;
  for (const box of boxes) {
    if (box.type !== type) continue;
    if (match) onMissing();
    match = box;
  }
  if (!match) onMissing();
  return match;
}

function requireFullBoxVersion(
  bytes: Uint8Array,
  box: Box,
  allowedVersions: readonly number[],
): number {
  if (box.end - box.dataStart < 4) malformed();
  const version = bytes[box.dataStart];
  if (!allowedVersions.includes(version)) malformed();
  return version;
}

function checkedTableLength(
  baseLength: number,
  entries: number,
  entryLength: number,
): number {
  const length = baseLength + entries * entryLength;
  if (!Number.isSafeInteger(length)) malformed();
  return length;
}

function inspectFtyp(bytes: Uint8Array, ftyp: Box, budget: ParseBudget) {
  if (
    ftyp.end - ftyp.dataStart < 8 ||
    (ftyp.end - ftyp.dataStart - 8) % 4 !== 0
  ) {
    malformed();
  }

  const compatibleBrandCount = (ftyp.end - ftyp.dataStart - 8) / 4;
  const brandCount = compatibleBrandCount + 1;
  if (brandCount > MAX_COMPATIBLE_BRANDS) resourceLimit();
  consumeIterationWork(budget, brandCount);

  let supportsStandardMp4 = false;
  const inspectBrand = (brand: string) => {
    if (brand === "qt  " || brand === "hvc1" || brand === "hev1") {
      unsupportedContainer();
    }
    if (SUPPORTED_BRANDS.has(brand)) supportsStandardMp4 = true;
  };

  inspectBrand(readType(bytes, ftyp.dataStart));
  for (let offset = ftyp.dataStart + 8; offset < ftyp.end; offset += 4) {
    inspectBrand(readType(bytes, offset));
  }

  if (!supportsStandardMp4) unsupportedContainer();
}

function parseTiming(bytes: Uint8Array, box: Box): Timing {
  const version = requireFullBoxVersion(bytes, box, [0, 1]);
  let timescale: number;
  let duration: bigint;

  if (version === 0) {
    const minimumLength = box.type === "mvhd" ? 100 : 24;
    if (box.end - box.dataStart < minimumLength) malformed();
    timescale = readU32(bytes, box.dataStart + 12);
    duration = BigInt(readU32(bytes, box.dataStart + 16));
  } else {
    const minimumLength = box.type === "mvhd" ? 112 : 36;
    if (box.end - box.dataStart < minimumLength) malformed();
    timescale = readU32(bytes, box.dataStart + 20);
    duration = readU64(bytes, box.dataStart + 24);
  }

  if (timescale === 0 || duration === 0n) missingMetadata();
  return { duration, timescale };
}

function parseTkhd(bytes: Uint8Array, tkhd: Box, requireDimensions: boolean) {
  const version = requireFullBoxVersion(bytes, tkhd, [0, 1]);
  const widthOffset = tkhd.dataStart + (version === 0 ? 76 : 88);
  const heightOffset = widthOffset + 4;
  if (heightOffset + 4 > tkhd.end) malformed();

  const width = readU32(bytes, widthOffset);
  const height = readU32(bytes, heightOffset);
  if (requireDimensions && (width === 0 || height === 0)) missingMetadata();
}

function parseHandlerType(bytes: Uint8Array, hdlr: Box): string {
  if (hdlr.end - hdlr.dataStart < 24) malformed();
  requireFullBoxVersion(bytes, hdlr, [0]);
  return readType(bytes, hdlr.dataStart + 8);
}

function parseStts(
  bytes: Uint8Array,
  stts: Box,
  budget: ParseBudget,
): { sampleCount: bigint; duration: bigint } {
  requireFullBoxVersion(bytes, stts, [0]);
  if (stts.end - stts.dataStart < 8) malformed();
  const entryCount = readU32(bytes, stts.dataStart + 4);
  if (entryCount > MAX_TABLE_ENTRIES) resourceLimit();
  if (
    entryCount === 0 ||
    stts.end - stts.dataStart !== checkedTableLength(8, entryCount, 8)
  ) {
    malformed();
  }
  consumeIterationWork(budget, entryCount);

  let sampleCount = 0n;
  let duration = 0n;
  let offset = stts.dataStart + 8;
  for (let index = 0; index < entryCount; index += 1) {
    const count = readU32(bytes, offset);
    const delta = readU32(bytes, offset + 4);
    if (count === 0 || delta === 0) malformed();
    if (sampleCount + BigInt(count) > MAX_TRACK_SAMPLES_BIGINT) {
      resourceLimit();
    }
    sampleCount += BigInt(count);
    duration += BigInt(count) * BigInt(delta);
    offset += 8;
  }
  return { sampleCount, duration };
}

function parseStsz(
  bytes: Uint8Array,
  stsz: Box,
  budget: ParseBudget,
): { sampleCount: bigint; totalBytes: bigint } {
  requireFullBoxVersion(bytes, stsz, [0]);
  if (stsz.end - stsz.dataStart < 12) malformed();
  const sampleSize = readU32(bytes, stsz.dataStart + 4);
  const sampleCount = readU32(bytes, stsz.dataStart + 8);
  if (sampleCount > MAX_TRACK_SAMPLES) resourceLimit();
  if (sampleCount === 0) malformed();

  let totalBytes = 0n;
  if (sampleSize === 0) {
    if (stsz.end - stsz.dataStart !== checkedTableLength(12, sampleCount, 4))
      malformed();
    consumeIterationWork(budget, sampleCount);
    let offset = stsz.dataStart + 12;
    for (let index = 0; index < sampleCount; index += 1) {
      const entrySize = readU32(bytes, offset);
      if (entrySize === 0) malformed();
      totalBytes += BigInt(entrySize);
      offset += 4;
    }
  } else {
    if (stsz.end - stsz.dataStart !== 12) malformed();
    totalBytes = BigInt(sampleSize) * BigInt(sampleCount);
  }

  return { sampleCount: BigInt(sampleCount), totalBytes };
}

function parseStsc(
  bytes: Uint8Array,
  stsc: Box,
  entryCount: number,
  budget: ParseBudget,
): SampleToChunk[] {
  requireFullBoxVersion(bytes, stsc, [0]);
  if (stsc.end - stsc.dataStart < 8) malformed();
  const count = readU32(bytes, stsc.dataStart + 4);
  if (count > MAX_TABLE_ENTRIES) resourceLimit();
  if (
    count === 0 ||
    stsc.end - stsc.dataStart !== checkedTableLength(8, count, 12)
  ) {
    malformed();
  }

  consumeIterationWork(budget, count);
  const entries: SampleToChunk[] = [];
  let previousFirstChunk = 0;
  let offset = stsc.dataStart + 8;
  for (let index = 0; index < count; index += 1) {
    const firstChunk = readU32(bytes, offset);
    const samplesPerChunk = readU32(bytes, offset + 4);
    const sampleDescriptionIndex = readU32(bytes, offset + 8);
    if (
      firstChunk === 0 ||
      firstChunk <= previousFirstChunk ||
      samplesPerChunk === 0 ||
      sampleDescriptionIndex === 0 ||
      sampleDescriptionIndex > entryCount
    ) {
      malformed();
    }
    previousFirstChunk = firstChunk;
    entries.push({ firstChunk, samplesPerChunk });
    offset += 12;
  }
  return entries;
}

function offsetIsInMdat(offset: bigint, ranges: readonly MdatRange[]): boolean {
  for (const range of ranges) {
    if (offset >= BigInt(range.dataStart) && offset < BigInt(range.end)) {
      return true;
    }
  }
  return false;
}

function parseChunkOffsets(
  bytes: Uint8Array,
  stco: Box,
  mdatRanges: readonly MdatRange[],
  budget: ParseBudget,
): bigint[] {
  const is64Bit = stco.type === "co64";
  requireFullBoxVersion(bytes, stco, [0]);
  if (stco.end - stco.dataStart < 8) malformed();
  const count = readU32(bytes, stco.dataStart + 4);
  const entrySize = is64Bit ? 8 : 4;
  if (count > MAX_TRACK_SAMPLES) resourceLimit();
  if (
    count === 0 ||
    stco.end - stco.dataStart !== checkedTableLength(8, count, entrySize)
  ) {
    malformed();
  }

  // Account for every mdat lookup before materializing any attacker-sized offsets array.
  consumeIterationWork(budget, count * mdatRanges.length);
  const offsets: bigint[] = [];
  let offset = stco.dataStart + 8;
  for (let index = 0; index < count; index += 1) {
    const chunkOffset = is64Bit
      ? readU64(bytes, offset)
      : BigInt(readU32(bytes, offset));
    if (!offsetIsInMdat(chunkOffset, mdatRanges)) malformed();
    offsets.push(chunkOffset);
    offset += entrySize;
  }
  return offsets;
}

function validateSampleToChunkCoverage(
  entries: readonly SampleToChunk[],
  chunkOffsets: readonly bigint[],
  sampleCount: bigint,
  budget: ParseBudget,
) {
  if (entries[0]?.firstChunk !== 1) malformed();

  consumeIterationWork(budget, entries.length);
  let representedSamples = 0n;
  for (let index = 0; index < entries.length; index += 1) {
    const firstChunk = entries[index].firstChunk;
    const followingFirstChunk = entries[index + 1]?.firstChunk;
    const lastChunk = followingFirstChunk
      ? followingFirstChunk - 1
      : chunkOffsets.length;
    if (firstChunk > chunkOffsets.length || lastChunk < firstChunk) malformed();
    const samplesInEntry =
      BigInt(lastChunk - firstChunk + 1) *
      BigInt(entries[index].samplesPerChunk);
    if (
      samplesInEntry > MAX_TRACK_SAMPLES_BIGINT ||
      representedSamples > MAX_TRACK_SAMPLES_BIGINT - samplesInEntry
    ) {
      resourceLimit();
    }
    representedSamples += samplesInEntry;
  }
  if (representedSamples !== sampleCount) malformed();
}

function readDescriptorLength(
  bytes: Uint8Array,
  offset: number,
  end: number,
): { length: number; nextOffset: number } {
  let value = 0;
  let currentOffset = offset;
  for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
    if (currentOffset >= end) malformed();
    const next = bytes[currentOffset];
    currentOffset += 1;
    value = value * 128 + (next & 0x7f);
    if ((next & 0x80) === 0)
      return { length: value, nextOffset: currentOffset };
  }
  malformed();
}

type Descriptor = {
  tag: number;
  dataStart: number;
  end: number;
};

function parseDescriptors(
  bytes: Uint8Array,
  start: number,
  end: number,
  budget: ParseBudget,
): Descriptor[] {
  const descriptors: Descriptor[] = [];
  let offset = start;
  while (offset < end) {
    if (descriptors.length >= MAX_DESCRIPTORS_PER_LEVEL) resourceLimit();
    consumeIterationWork(budget, 1);
    const tag = bytes[offset];
    offset += 1;
    const length = readDescriptorLength(bytes, offset, end);
    if (length.length > end - length.nextOffset) malformed();
    consumeDescriptor(budget);
    descriptors.push({
      tag,
      dataStart: length.nextOffset,
      end: length.nextOffset + length.length,
    });
    offset = length.nextOffset + length.length;
  }
  if (offset !== end) malformed();
  return descriptors;
}

function descriptorExactlyOne(
  descriptors: readonly Descriptor[],
  tag: number,
  budget: ParseBudget,
): Descriptor {
  consumeIterationWork(budget, descriptors.length);
  let match: Descriptor | undefined;
  for (const descriptor of descriptors) {
    if (descriptor.tag !== tag) continue;
    if (match) unsupportedCodec();
    match = descriptor;
  }
  if (!match) unsupportedCodec();
  return match;
}

function parseAudioSpecificConfig(
  bytes: Uint8Array,
  start: number,
  end: number,
) {
  let bitOffset = start * 8;
  const endBits = end * 8;
  const readBits = (count: number): number => {
    if (bitOffset + count > endBits) malformed();
    let value = 0;
    for (let bit = 0; bit < count; bit += 1) {
      value =
        value * 2 +
        ((bytes[Math.floor(bitOffset / 8)] >> (7 - (bitOffset % 8))) & 1);
      bitOffset += 1;
    }
    return value;
  };

  const readAudioObjectType = (): number => {
    const value = readBits(5);
    return value === 31 ? 32 + readBits(6) : value;
  };

  let audioObjectType = readAudioObjectType();
  const frequencyIndex = readBits(4);
  if (frequencyIndex === 13 || frequencyIndex === 14) unsupportedCodec();
  if (frequencyIndex === 15 && readBits(24) === 0) unsupportedCodec();
  const channels = readBits(4);
  // Program-config-element channel layouts need additional parsing. Do not guess.
  if (channels === 0) unsupportedCodec();

  if (audioObjectType === 5 || audioObjectType === 29) {
    const extensionFrequencyIndex = readBits(4);
    if (extensionFrequencyIndex === 13 || extensionFrequencyIndex === 14)
      unsupportedCodec();
    if (extensionFrequencyIndex === 15 && readBits(24) === 0)
      unsupportedCodec();
    audioObjectType = readAudioObjectType();
  }

  if (!AAC_AUDIO_OBJECT_TYPES.has(audioObjectType)) unsupportedCodec();
}

function parseEsds(bytes: Uint8Array, esds: Box, budget: ParseBudget) {
  requireFullBoxVersion(bytes, esds, [0]);
  if (esds.end - esds.dataStart < 5) malformed();
  const topLevel = parseDescriptors(
    bytes,
    esds.dataStart + 4,
    esds.end,
    budget,
  );
  const esDescriptor = descriptorExactlyOne(topLevel, 0x03, budget);
  if (esDescriptor.end - esDescriptor.dataStart < 3) malformed();

  let offset = esDescriptor.dataStart + 2;
  const flags = bytes[offset];
  offset += 1;
  if ((flags & 0x80) !== 0) offset += 2;
  if ((flags & 0x40) !== 0) {
    if (offset >= esDescriptor.end) malformed();
    const urlLength = bytes[offset];
    offset += 1 + urlLength;
  }
  if ((flags & 0x20) !== 0) offset += 2;
  if (offset > esDescriptor.end) malformed();

  const esChildren = parseDescriptors(bytes, offset, esDescriptor.end, budget);
  const decoderConfig = descriptorExactlyOne(esChildren, 0x04, budget);
  if (decoderConfig.end - decoderConfig.dataStart < 13) malformed();
  if (bytes[decoderConfig.dataStart] !== 0x40) unsupportedCodec();
  const streamType = (bytes[decoderConfig.dataStart + 1] >> 2) & 0x3f;
  if (streamType !== 0x05) unsupportedCodec();

  const decoderChildren = parseDescriptors(
    bytes,
    decoderConfig.dataStart + 13,
    decoderConfig.end,
    budget,
  );
  const audioConfig = descriptorExactlyOne(decoderChildren, 0x05, budget);
  if (audioConfig.dataStart === audioConfig.end) malformed();
  parseAudioSpecificConfig(bytes, audioConfig.dataStart, audioConfig.end);
}

function parseVideoSampleEntry(
  bytes: Uint8Array,
  entry: Box,
  budget: ParseBudget,
): SampleDescription {
  if (entry.type !== "avc1" && entry.type !== "avc3") unsupportedCodec();
  // ISO VisualSampleEntry fields are 78 bytes after the ordinary 8-byte box header.
  if (entry.headerSize !== 8 || entry.end - entry.start < 86) malformed();
  const width = readU16(bytes, entry.start + 32);
  const height = readU16(bytes, entry.start + 34);
  if (width === 0 || height === 0) missingMetadata();

  const children = parseBoxes(
    bytes,
    entry.start + 86,
    entry.end,
    budget,
    MAX_NESTED_BOXES_PER_LEVEL,
  );
  const avcC = exactlyOne(children, "avcC", unsupportedCodec, budget);
  if (avcC.end - avcC.dataStart < 7 || bytes[avcC.dataStart] !== 1) {
    unsupportedCodec();
  }

  let offset = avcC.dataStart + 6;
  const sequenceParameterSetCount = bytes[avcC.dataStart + 5] & 0x1f;
  if (sequenceParameterSetCount === 0) unsupportedCodec();
  if (sequenceParameterSetCount > MAX_PARAMETER_SETS) resourceLimit();
  consumeIterationWork(budget, sequenceParameterSetCount);
  for (let index = 0; index < sequenceParameterSetCount; index += 1) {
    if (offset + 2 > avcC.end) malformed();
    const length = readU16(bytes, offset);
    offset += 2;
    if (length === 0 || length > avcC.end - offset) malformed();
    offset += length;
  }
  if (offset >= avcC.end) malformed();
  const pictureParameterSetCount = bytes[offset];
  offset += 1;
  if (pictureParameterSetCount === 0) unsupportedCodec();
  if (pictureParameterSetCount > MAX_PARAMETER_SETS) resourceLimit();
  consumeIterationWork(budget, pictureParameterSetCount);
  for (let index = 0; index < pictureParameterSetCount; index += 1) {
    if (offset + 2 > avcC.end) malformed();
    const length = readU16(bytes, offset);
    offset += 2;
    if (length === 0 || length > avcC.end - offset) malformed();
    offset += length;
  }
  if (offset > avcC.end) malformed();

  return { entryCount: 1, width, height };
}

function parseAudioSampleEntry(
  bytes: Uint8Array,
  entry: Box,
  budget: ParseBudget,
): SampleDescription {
  if (entry.type !== "mp4a") unsupportedCodec();
  if (entry.headerSize !== 8 || entry.end - entry.start < 36) malformed();
  const soundDescriptionVersion = readU16(bytes, entry.start + 16);
  let childrenStart = entry.start + 36;
  if (soundDescriptionVersion === 1) childrenStart += 16;
  if (soundDescriptionVersion !== 0 && soundDescriptionVersion !== 1)
    unsupportedCodec();
  if (childrenStart > entry.end) malformed();

  const children = parseBoxes(
    bytes,
    childrenStart,
    entry.end,
    budget,
    MAX_NESTED_BOXES_PER_LEVEL,
  );
  parseEsds(
    bytes,
    exactlyOne(children, "esds", unsupportedCodec, budget),
    budget,
  );
  return { entryCount: 1 };
}

function parseStsd(
  bytes: Uint8Array,
  stsd: Box,
  handlerType: string,
  budget: ParseBudget,
): SampleDescription {
  requireFullBoxVersion(bytes, stsd, [0]);
  if (stsd.end - stsd.dataStart < 8) malformed();
  const entryCount = readU32(bytes, stsd.dataStart + 4);
  if (entryCount > MAX_SAMPLE_DESCRIPTIONS) resourceLimit();
  if (entryCount === 0) missingMetadata();
  const entries = parseBoxes(
    bytes,
    stsd.dataStart + 8,
    stsd.end,
    budget,
    MAX_SAMPLE_DESCRIPTIONS,
  );
  if (entries.length !== entryCount) malformed();

  consumeIterationWork(budget, entryCount);
  let width: number | undefined;
  let height: number | undefined;
  for (const entry of entries) {
    const parsed =
      handlerType === "vide"
        ? parseVideoSampleEntry(bytes, entry, budget)
        : parseAudioSampleEntry(bytes, entry, budget);
    if (handlerType === "vide") {
      if (width !== undefined || height !== undefined) unsupportedCodec();
      width = parsed.width;
      height = parsed.height;
    }
  }

  return { entryCount, width, height };
}

function parseSampleTable(
  bytes: Uint8Array,
  stbl: Box,
  handlerType: "vide" | "soun",
  mdatRanges: readonly MdatRange[],
  budget: ParseBudget,
) {
  const boxes = parseBoxes(
    bytes,
    stbl.dataStart,
    stbl.end,
    budget,
    MAX_NESTED_BOXES_PER_LEVEL,
  );
  const stsd = parseStsd(
    bytes,
    exactlyOne(boxes, "stsd", missingMetadata, budget),
    handlerType,
    budget,
  );
  const sampleTiming = parseStts(
    bytes,
    exactlyOne(boxes, "stts", missingMetadata, budget),
    budget,
  );
  const sampleSizes = parseStsz(
    bytes,
    exactlyOne(boxes, "stsz", missingMetadata, budget),
    budget,
  );
  if (sampleTiming.sampleCount !== sampleSizes.sampleCount) malformed();
  const sampleToChunk = parseStsc(
    bytes,
    exactlyOne(boxes, "stsc", missingMetadata, budget),
    stsd.entryCount,
    budget,
  );

  consumeIterationWork(budget, boxes.length);
  let chunkOffsetBox: Box | undefined;
  for (const box of boxes) {
    if (box.type !== "stco" && box.type !== "co64") continue;
    if (chunkOffsetBox) missingMetadata();
    chunkOffsetBox = box;
  }
  if (!chunkOffsetBox) missingMetadata();
  const chunkOffsets = parseChunkOffsets(
    bytes,
    chunkOffsetBox,
    mdatRanges,
    budget,
  );
  validateSampleToChunkCoverage(
    sampleToChunk,
    chunkOffsets,
    sampleTiming.sampleCount,
    budget,
  );

  consumeIterationWork(budget, mdatRanges.length);
  let totalMdatBytes = 0n;
  for (const range of mdatRanges) {
    totalMdatBytes += BigInt(range.end - range.dataStart);
  }
  if (sampleSizes.totalBytes > totalMdatBytes) malformed();

  return { sampleDescription: stsd, sampleDuration: sampleTiming.duration };
}

function parseTrack(
  bytes: Uint8Array,
  trak: Box,
  mdatRanges: readonly MdatRange[],
  budget: ParseBudget,
): ParsedTrack {
  const trakChildren = parseBoxes(
    bytes,
    trak.dataStart,
    trak.end,
    budget,
    MAX_NESTED_BOXES_PER_LEVEL,
  );
  const tkhd = exactlyOne(trakChildren, "tkhd", missingMetadata, budget);
  const mdia = exactlyOne(trakChildren, "mdia", missingMetadata, budget);
  const mdiaChildren = parseBoxes(
    bytes,
    mdia.dataStart,
    mdia.end,
    budget,
    MAX_NESTED_BOXES_PER_LEVEL,
  );
  const mdhd = exactlyOne(mdiaChildren, "mdhd", missingMetadata, budget);
  const hdlr = exactlyOne(mdiaChildren, "hdlr", missingMetadata, budget);
  const handlerType = parseHandlerType(bytes, hdlr);

  const timing = parseTiming(bytes, mdhd);
  if (handlerType !== "vide" && handlerType !== "soun") {
    return { handlerType, timing };
  }

  parseTkhd(bytes, tkhd, handlerType === "vide");
  const minf = exactlyOne(mdiaChildren, "minf", missingMetadata, budget);
  const minfChildren = parseBoxes(
    bytes,
    minf.dataStart,
    minf.end,
    budget,
    MAX_NESTED_BOXES_PER_LEVEL,
  );
  const stbl = exactlyOne(minfChildren, "stbl", missingMetadata, budget);
  const sampleTable = parseSampleTable(
    bytes,
    stbl,
    handlerType,
    mdatRanges,
    budget,
  );
  return {
    handlerType,
    timing: laterTiming(timing, {
      duration: sampleTable.sampleDuration,
      timescale: timing.timescale,
    }),
    width: sampleTable.sampleDescription.width,
    height: sampleTable.sampleDescription.height,
  };
}

function laterTiming(left: Timing, right: Timing): Timing {
  return left.duration * BigInt(right.timescale) >=
    right.duration * BigInt(left.timescale)
    ? left
    : right;
}

function durationMilliseconds(timing: Timing): number {
  const milliseconds =
    (timing.duration * 1000n + BigInt(timing.timescale) - 1n) /
    BigInt(timing.timescale);
  if (milliseconds === 0n || milliseconds > MAX_SAFE_BIGINT) missingMetadata();
  return Number(milliseconds);
}

function effectiveMaxBytes(maxBytes: number): number {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return fail("The video upload limit is unavailable. Try again shortly.");
  }
  return Math.min(MAX_RECORDED_VIDEO_BYTES, Math.floor(maxBytes));
}

function validDuration(duration: unknown): duration is RecordingDuration {
  return duration === 30 || duration === 60;
}

/**
 * Inspects a complete native recording. This deliberately does not trust its filename,
 * MIME type, camera settings, or platform-provided media metadata.
 */
export function inspectRecordedMp4(
  bytes: Uint8Array,
  limits: { maxDurationSeconds: RecordingDuration; maxBytes: number },
): RecordedVideoMetadata {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return malformed();
  }
  if (!limits || !validDuration(limits.maxDurationSeconds)) {
    return fail("Choose a 30- or 60-second recording length.");
  }

  const maxBytes = effectiveMaxBytes(limits.maxBytes);
  if (bytes.byteLength > maxBytes) {
    return fail("Keep your recorded video under the allowed size.");
  }

  const budget = createParseBudget();
  const topLevel = parseBoxes(
    bytes,
    0,
    bytes.length,
    budget,
    MAX_TOP_LEVEL_BOXES,
  );
  if (topLevel.length < 3 || topLevel[0].type !== "ftyp")
    unsupportedContainer();
  inspectFtyp(bytes, topLevel[0], budget);

  consumeIterationWork(budget, topLevel.length);
  let moov: Box | undefined;
  let moovCount = 0;
  const mdatRanges: MdatRange[] = [];
  for (const box of topLevel) {
    if (box.type === "moof") {
      return fail("This fragmented MP4 recording is not supported.");
    }
    if (box.type === "moov") {
      moovCount += 1;
      moov = box;
      continue;
    }
    if (box.type === "mdat") {
      if (box.dataStart === box.end) missingMetadata();
      mdatRanges.push({ dataStart: box.dataStart, end: box.end });
    }
  }
  if (moovCount !== 1 || !moov) missingMetadata();
  if (moov.end - moov.start > MAX_MOOV_BYTES) resourceLimit();
  if (mdatRanges.length === 0) missingMetadata();

  const moovChildren = parseBoxes(
    bytes,
    moov.dataStart,
    moov.end,
    budget,
    MAX_NESTED_BOXES_PER_LEVEL,
  );
  consumeIterationWork(budget, moovChildren.length);
  let mvhd: Box | undefined;
  let mvhdCount = 0;
  const trackBoxes: Box[] = [];
  for (const box of moovChildren) {
    if (box.type === "mvex") {
      return fail("This fragmented MP4 recording is not supported.");
    }
    if (box.type === "mvhd") {
      mvhdCount += 1;
      mvhd = box;
      continue;
    }
    if (box.type === "trak") {
      if (trackBoxes.length >= MAX_TRACKS) resourceLimit();
      trackBoxes.push(box);
    }
  }
  if (mvhdCount !== 1 || !mvhd) missingMetadata();
  const movieTiming = parseTiming(bytes, mvhd);

  const tracks: ParsedTrack[] = [];
  consumeIterationWork(budget, trackBoxes.length);
  for (const trackBox of trackBoxes) {
    tracks.push(parseTrack(bytes, trackBox, mdatRanges, budget));
  }

  let videoTrack: ParsedTrack | undefined;
  let audioTrack: ParsedTrack | undefined;
  let videoTrackCount = 0;
  let audioTrackCount = 0;
  consumeIterationWork(budget, tracks.length);
  for (const track of tracks) {
    if (track.handlerType === "vide") {
      videoTrackCount += 1;
      videoTrack = track;
    } else if (track.handlerType === "soun") {
      audioTrackCount += 1;
      audioTrack = track;
    }
  }
  if (
    videoTrackCount !== 1 ||
    audioTrackCount !== 1 ||
    !videoTrack ||
    !audioTrack
  ) {
    unsupportedCodec();
  }

  if (!videoTrack.width || !videoTrack.height) missingMetadata();
  const completeTiming = laterTiming(
    laterTiming(movieTiming, videoTrack.timing),
    audioTrack.timing,
  );
  if (
    completeTiming.duration >
    BigInt(limits.maxDurationSeconds) * BigInt(completeTiming.timescale)
  ) {
    return fail("This recording is longer than the selected time limit.");
  }

  return {
    mimeType: "video/mp4",
    fileSize: bytes.byteLength,
    durationMs: durationMilliseconds(completeTiming),
    width: videoTrack.width,
    height: videoTrack.height,
  };
}
