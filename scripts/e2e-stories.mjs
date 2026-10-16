import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Invoked only by the disposable-stack harness. Never use production accounts here.
export async function verifyStories({ admin, host, guest, outsider, circleId, url, anonKey }) {
  const ok = (result) => {
    if (result.error) throw result.error;
    return result.data;
  };
  const id = randomUUID(),
    path = `${host.id}/${circleId}/${id}.png`;
  const png = readFileSync(new URL('../tests/fixtures/story.png', import.meta.url));
  try {
    ok(
      await host.client.storage.from('story-media').upload(path, png, { contentType: 'image/png' }),
    );
    assert.ok(
      (
        await outsider.client.storage
          .from('story-media')
          .upload(`${outsider.id}/${circleId}/${id}.png`, png, { contentType: 'image/png' })
      ).error,
    );
    const story = ok(
      await host.client
        .from('circle_stories')
        .insert({ id, circle_id: circleId, author_id: host.id, kind: 'image', storage_path: path })
        .select()
        .single(),
    );
    assert.equal(Date.parse(story.expires_at) - Date.parse(story.created_at), 86400000);
    assert.equal(ok(await guest.client.from('circle_stories').select('id').eq('id', id)).length, 1);
    assert.equal(
      ok(await outsider.client.from('circle_stories').select('id').eq('id', id)).length,
      0,
    );
    assert.ok(
      ok(await guest.client.storage.from('story-media').createSignedUrl(path, 30)).signedUrl,
    );
    assert.ok((await outsider.client.storage.from('story-media').createSignedUrl(path, 30)).error);
    ok(await guest.client.from('circle_stories').delete().eq('id', id));
    assert.equal(ok(await host.client.from('circle_stories').select('id').eq('id', id)).length, 1);
    assert.ok((await guest.client.rpc('queue_expired_story_media')).error);
    assert.ok(
      (
        await host.client
          .from('circle_stories')
          .update({ expires_at: new Date(Date.now() + 172800000).toISOString() })
          .eq('id', id)
      ).error,
    );
    ok(
      await admin
        .from('circle_stories')
        .update({
          created_at: new Date(Date.now() - 90000000).toISOString(),
          expires_at: new Date(Date.now() - 3600000).toISOString(),
        })
        .eq('id', id),
    );
    assert.equal(ok(await guest.client.from('circle_stories').select('id').eq('id', id)).length, 0);
    assert.ok((await guest.client.storage.from('story-media').createSignedUrl(path, 30)).error);
    if (process.env.CIRCLES_E2E_ACCOUNT_FUNCTIONS === 'true') {
      const endpoint = url + '/functions/v1/cleanup-story-media';
      const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
      assert.equal((await fetch(endpoint, { method: 'POST', headers })).status, 401);
      const secret = process.env.CIRCLES_E2E_CLEANUP_SECRET;
      assert.ok(secret, 'Set the disposable database cleanup secret before function integration');
      const result = await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, 'x-cleanup-secret': secret },
      });
      assert.equal(result.status, 200);
      assert.ok((await result.json()).removed >= 1);
      assert.ok((await admin.storage.from('story-media').download(path)).error);
      assert.equal(
        ok(await admin.from('story_media_cleanup').select().eq('storage_path', path)).length,
        0,
      );
    }
    console.log(
      'PASS: stories membership, private media, ownership, server expiry, and cleanup authorization.',
    );
  } finally {
    ok(await admin.from('circle_stories').delete().eq('id', id));
    ok(await admin.storage.from('story-media').remove([path]));
    ok(await admin.from('story_media_cleanup').delete().eq('storage_path', path));
  }
}
