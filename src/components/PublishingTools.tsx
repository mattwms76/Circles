import React, { useEffect, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { getFrameAt, isValidFile, trim } from 'react-native-video-trim';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ActionButton, Disclosure } from './Primitives';
import { CommunityField } from './CommunityDepth';
import { parseSubtitles, validateTrim } from '../lib/publishing';
import { colors } from '../theme';
import type { PostAttachment } from '../types';
export function PublishingTools({
  items,
  onChange,
  onAddPhotos,
  disabled,
  onProcessingChange,
}: {
  items: PostAttachment[];
  onChange: (items: PostAttachment[]) => void | Promise<void>;
  onAddPhotos: () => void;
  disabled: boolean;
  onProcessingChange?: (processing: boolean) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {items.length > 1 ? (
        <Text style={{ color: colors.muted }}>Photo carousel · {items.length}/10</Text>
      ) : null}
      {items.map((a, i) =>
        a.kind === 'video' ? (
          <VideoEditor
            key={a.uri}
            attachment={a}
            disabled={disabled}
            onChange={(next) => onChange([next])}
            onProcessingChange={onProcessingChange}
          />
        ) : (
          <View
            key={`${a.uri}:${i}`}
            style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
          >
            <Image
              source={{ uri: a.uri }}
              accessibilityLabel={`Photo ${i + 1}`}
              style={{ width: 56, height: 56, borderRadius: 12 }}
            />
            <Text style={{ color: colors.ink }}>Photo {i + 1}</Text>
            {i > 0 ? (
              <ActionButton
                compact
                variant="outline"
                label={`Move photo ${i + 1} earlier`}
                disabled={disabled}
                onPress={() => {
                  const next = [...items];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  onChange(next);
                }}
              />
            ) : null}
            <ActionButton
              compact
              variant="outline"
              label={`Remove photo ${i + 1}`}
              disabled={disabled}
              onPress={() => onChange(items.filter((_, n) => n !== i))}
            />
          </View>
        ),
      )}
      {items.length < 10 && items.every((a) => a.kind === 'image') ? (
        <ActionButton
          compact
          variant="outline"
          label="Add more photos"
          disabled={disabled}
          onPress={onAddPhotos}
        />
      ) : null}
    </View>
  );
}
function VideoEditor({
  attachment,
  onChange,
  disabled,
  onProcessingChange,
}: {
  attachment: PostAttachment;
  onChange: (a: PostAttachment) => void | Promise<void>;
  disabled: boolean;
  onProcessingChange?: (processing: boolean) => void;
}) {
  const player = useVideoPlayer(attachment.uri),
    [duration, setDuration] = useState((attachment.durationMs ?? 120000) / 1000),
    [start, setStart] = useState('0'),
    [end, setEnd] = useState(String((attachment.durationMs ?? 120000) / 1000)),
    [cover, setCover] = useState('0'),
    [subtitles, setSubtitles] = useState(
      (attachment.subtitles ?? []).map((c) => `${c.start} - ${c.end} | ${c.text}`).join('\n'),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    void isValidFile(attachment.uri)
      .then((r) => {
        if (alive.current && r.isValid) {
          setDuration(r.duration / 1000);
          setEnd(String(r.duration / 1000));
        }
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      onProcessingChange?.(false);
    };
  }, [attachment.uri]);
  const run = async (fn: () => Promise<void>) => {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    onProcessingChange?.(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as any)?.message ?? 'Could not edit this video.');
    } finally {
      lock.current = false;
      onProcessingChange?.(false);
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Disclosure title="Trim, cover and subtitles">
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        style={{ height: 200, width: '100%', borderRadius: 12 }}
      />
      <Text style={{ color: colors.muted }}>
        Duration: {duration.toFixed(1)} seconds. Times below use seconds.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}
      <CommunityField
        label="Trim start (seconds)"
        value={start}
        onChange={setStart}
        disabled={busy || disabled}
      />
      <CommunityField
        label="Trim end (seconds)"
        value={end}
        onChange={setEnd}
        disabled={busy || disabled}
      />
      <ActionButton
        label={busy ? 'Processing…' : 'Apply trim'}
        disabled={disabled || busy}
        onPress={() =>
          void run(async () => {
            const range = validateTrim(Number(start), Number(end), duration);
            player.pause();
            const result = await trim(attachment.uri, { ...range, outputExt: 'mp4' });
            if (!result.success || !result.outputPath)
              throw Error('The video could not be trimmed.');
            if (alive.current)
              await onChange({
                ...attachment,
                uri: result.outputPath.startsWith('file:')
                  ? result.outputPath
                  : `file://${result.outputPath}`,
                mimeType: 'video/mp4',
                fileName: `trimmed-${Date.now()}.mp4`,
                durationMs: result.duration,
                coverUri: undefined,
                subtitles: [],
              });
          })
        }
      />
      <CommunityField
        label="Cover frame (seconds)"
        value={cover}
        onChange={setCover}
        disabled={busy || disabled}
      />
      <ActionButton
        label="Use this video frame as cover"
        disabled={disabled || busy}
        onPress={() =>
          void run(async () => {
            const t = Number(cover);
            if (!Number.isFinite(t) || t < 0 || t >= duration)
              throw Error('Choose a cover frame inside this video.');
            const result = await getFrameAt(attachment.uri, {
              time: Math.round(t * 1000),
              format: 'jpeg',
              quality: 85,
              maxWidth: 960,
            });
            if (alive.current)
              await onChange({
                ...attachment,
                coverUri: result.outputPath.startsWith('file:')
                  ? result.outputPath
                  : `file://${result.outputPath}`,
              });
          })
        }
      />
      {attachment.coverUri ? (
        <Image
          source={{ uri: attachment.coverUri }}
          style={{ width: 140, height: 90, borderRadius: 12 }}
        />
      ) : null}
      <CommunityField
        label="Subtitles (start - end | text, one per line)"
        value={subtitles}
        max={32000}
        disabled={busy || disabled}
        onChange={setSubtitles}
      />
      <Text style={{ color: colors.muted }}>Example: 0 - 3 | Welcome to our circle</Text>
      <ActionButton
        label="Save subtitles"
        disabled={disabled || busy}
        onPress={() =>
          void run(async () => {
            const cues = parseSubtitles(subtitles, duration);
            if (alive.current) await onChange({ ...attachment, subtitles: cues });
          })
        }
      />
    </Disclosure>
  );
}
