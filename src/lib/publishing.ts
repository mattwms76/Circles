import type { SubtitleCue, PostAttachment } from '../types';
export function parseSubtitles(source: string, duration = 120): SubtitleCue[] {
  if (!source.trim()) return [];
  const cues = source
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      const match = line.match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\|\s*(.+)$/);
      if (!match) throw Error('Use seconds: 0 - 3 | Your subtitle');
      return { start: Number(match[1]), end: Number(match[2]), text: match[3].trim() };
    });
  if (cues.length > 100) throw Error('Use up to 100 subtitle cues.');
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (
      c.start < 0 ||
      c.end <= c.start ||
      c.end > duration ||
      !c.text ||
      c.text.length > 300 ||
      (i > 0 && c.start < cues[i - 1].end)
    )
      throw Error('Subtitles must be ordered, must not overlap, and must fit inside the video.');
  }
  return cues;
}
export function validateTrim(start: number, end: number, duration: number) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > duration ||
    end - start > 120
  )
    throw Error('Choose a valid trim range of up to 120 seconds.');
  return { startTime: Math.round(start * 1000), endTime: Math.round(end * 1000) };
}
export function validateAttachments(items: PostAttachment[]) {
  if (items.length > 10 || (items.length > 1 && items.some((m) => m.kind !== 'image')))
    throw Error('Choose up to 10 photos, or one video or GIF.');
}
