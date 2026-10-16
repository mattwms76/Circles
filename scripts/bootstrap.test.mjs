import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDatabase } from './db-fixture.mjs';
test('The fresh-install manifest builds stories, bookmarks and independent retention together', async (t) => {
  const read = (path) => readFileSync(new URL('../supabase/' + path, import.meta.url), 'utf8');
  const files = read('bootstrap.list').trim().split(/\r?\n/);
  const db = await createDatabase(files.map(read).join('\n'));
  t.after(() => db.close());
  for (const table of ['post_bookmarks', 'circle_stories', 'story_media_cleanup']) {
    const result = await db.query('select relrowsecurity from pg_class where oid=$1::regclass', [
      'public.' + table,
    ]);
    assert.equal(result.rows[0].relrowsecurity, true);
  }
  assert.equal(
    (await db.query("select public from storage.buckets where id='story-media'")).rows[0].public,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.authorize_story_cleanup(text)','execute') as allowed",
      )
    ).rows[0].allowed,
    false,
  );
});
