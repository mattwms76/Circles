import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { assertAccount, localValue, storeValue, type GroupMessage } from './communityDepth';
export interface MessageMedia {
  id: string;
  uri: string;
  kind: 'photo' | 'voice';
  mime: string;
  duration?: number;
}
function checked<T>(r: { data: T; error: any }): T {
  if (r.error) throw r.error;
  return r.data;
}
export async function messageMediaUrl(path: string) {
  if (!supabase) return path;
  const data = checked(await supabase.storage.from('community-media').createSignedUrl(path, 600));
  if (!data) throw Error('Attachment unavailable.');
  return data.signedUrl;
}
export async function directAttachment(message: string) {
  if (!supabase) return null;
  return checked(
    await supabase.from('message_attachments').select('*').eq('message_id', message).maybeSingle(),
  );
}
export async function sendMessageMedia(
  user: string,
  target: string,
  media: MessageMedia,
  group = false,
) {
  await assertAccount(user);
  if (media.kind === 'voice' && (!media.duration || media.duration < 1 || media.duration > 60000))
    throw Error('Record a voice note of up to 60 seconds.');
  const allowed =
    media.kind === 'photo'
      ? ['image/jpeg', 'image/png', 'image/webp']
      : ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/webm'];
  if (!allowed.includes(media.mime)) throw Error('Unsupported attachment format.');
  const info = await FileSystem.getInfoAsync(media.uri);
  if (!info.exists || !Number.isFinite(info.size) || info.size <= 0 || info.size > 10 * 1024 * 1024)
    throw Error('Choose an attachment up to 10 MB.');
  if (!supabase) {
    if (group) await sendGroupMessage(user, target, '', media.id, media);
    else throw Error('Connect Supabase to send media messages.');
    return;
  }
  const table = group ? 'circle_chat_messages' : 'direct_messages';
  const prior = checked(await supabase.from(table).select('id').eq('id', media.id).maybeSingle());
  if (prior) return;
  const ext =
    media.kind === 'voice'
      ? media.mime === 'audio/webm'
        ? 'webm'
        : 'm4a'
      : media.mime === 'image/png'
        ? 'png'
        : media.mime === 'image/webp'
          ? 'webp'
          : 'jpg';
  const path = `${user}/${group ? 'circle' : 'direct'}/${target}/${media.id}.${ext}`;
  const bytes = await (await fetch(media.uri)).arrayBuffer();
  if (bytes.byteLength > 10 * 1024 * 1024) throw Error('Attachment must be 10 MB or smaller.');
  await assertAccount(user);
  const upload = await supabase.storage
    .from('community-media')
    .upload(path, bytes, { contentType: media.mime });
  if (
    upload.error &&
    !['409', 'Duplicate'].includes(String(upload.error.statusCode)) &&
    !upload.error.message?.includes('already exists')
  )
    throw upload.error;
  await assertAccount(user);
  if (group)
    checked(
      await supabase.from('circle_chat_messages').insert({
        id: media.id,
        circle_id: target,
        author_id: user,
        body: '',
        media_kind: media.kind,
        media_path: path,
        duration_ms: media.duration ?? null,
      }),
    );
  else
    checked(
      await supabase.rpc('send_media_message', {
        recipient_user: target,
        media_kind: media.kind,
        media_path: path,
        voice_duration: media.duration ?? null,
        request_id: media.id,
      }),
    );
}
export async function groupMessages(
  user: string,
  circle: string,
  before?: string,
): Promise<GroupMessage[]> {
  if (!supabase) return localValue(user, `chat:${circle}`, []);
  let q = supabase
    .from('circle_chat_messages')
    .select('*,profiles!circle_chat_messages_author_id_fkey(display_name)')
    .eq('circle_id', circle)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(40);
  if (before) q = q.lt('created_at', before);
  return checked(await q) as unknown as GroupMessage[];
}
export async function sendGroupMessage(
  user: string,
  circle: string,
  body: string,
  id: string,
  media?: MessageMedia,
) {
  await assertAccount(user);
  if (supabase) {
    const prior = checked(
      await supabase.from('circle_chat_messages').select('id').eq('id', id).maybeSingle(),
    );
    if (!prior)
      checked(
        await supabase
          .from('circle_chat_messages')
          .insert({ id, circle_id: circle, author_id: user, body: body.trim() }),
      );
  } else {
    const rows = await groupMessages(user, circle);
    await storeValue(user, `chat:${circle}`, [
      {
        id,
        circle_id: circle,
        author_id: user,
        body: body.trim(),
        created_at: new Date().toISOString(),
        media_kind: media?.kind,
        media_path: media?.uri,
        duration_ms: media?.duration,
      },
      ...rows.filter((r) => r.id !== id),
    ]);
  }
}
export async function deleteGroupMessage(user: string, circle: string, id: string) {
  await assertAccount(user);
  if (supabase) {
    const r = await supabase
      .from('circle_chat_messages')
      .delete()
      .eq('id', id)
      .eq('circle_id', circle)
      .select('id')
      .single();
    checked(r);
  } else
    await storeValue(
      user,
      `chat:${circle}`,
      (await groupMessages(user, circle)).filter((m) => m.id !== id),
    );
}
export async function groupPreference(
  user: string,
  circle: string,
): Promise<{ muted: boolean; read_at: string }> {
  if (!supabase)
    return localValue(user, `chat-pref:${circle}`, {
      muted: false,
      read_at: new Date(0).toISOString(),
    });
  return (
    checked(
      await supabase
        .from('circle_chat_preferences')
        .select('muted,read_at')
        .eq('user_id', user)
        .eq('circle_id', circle)
        .maybeSingle(),
    ) ?? { muted: false, read_at: new Date(0).toISOString() }
  );
}
export async function saveGroupPreference(
  user: string,
  circle: string,
  values: { muted?: boolean; read_at?: string },
) {
  await assertAccount(user);
  if (supabase)
    checked(
      await supabase.from('circle_chat_preferences').upsert({
        user_id: user,
        circle_id: circle,
        ...values,
      }),
    );
  else
    await storeValue(user, `chat-pref:${circle}`, {
      ...(await groupPreference(user, circle)),
      ...values,
    });
}
