import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { PGlite } from '@electric-sql/pglite';
import { loadSource, demo, mountChat, act } from './react-fixture.mjs';

const user = 'aaaaaaaa-0000-4000-8000-000000000001';
const peer = 'aaaaaaaa-0000-4000-8000-000000000002';
const circle = 'aaaaaaaa-0000-4000-8000-000000000003';
const pagination = loadSource('src/lib/messagePagination.ts');

// Execute the actual SDK's HTTP query filters in PostgreSQL. This checks the
// participant and page predicates combine correctly, including repeated OR keys.
function filterSql(expression, params) {
  const logical = /^(and|or)\((.*)\)$/.exec(expression);
  if (logical) {
    let depth = 0,
      start = 0;
    const parts = [];
    for (let i = 0; i <= logical[2].length; i++) {
      const char = logical[2][i];
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (i === logical[2].length || (char === ',' && depth === 0)) {
        parts.push(filterSql(logical[2].slice(start, i), params));
        start = i + 1;
      }
    }
    return `(${parts.join(logical[1] === 'and' ? ' AND ' : ' OR ')})`;
  }
  const match = /^(id|sender_id|recipient_id|circle_id|created_at)\.(eq|lt)\.(.+)$/.exec(
    expression,
  );
  assert.ok(match, `Unsupported test query filter: ${expression}`);
  params.push(match[3]);
  return `${match[1]} ${match[2] === 'eq' ? '=' : '<'} $${params.length}`;
}

for (const group of [false, true]) {
  test(`${group ? 'Circle' : 'Direct'} message pagination includes every timestamp tie without duplicates`, async (t) => {
    const db = await PGlite.create();
    t.after(() => db.close());
    await db.exec(`
      CREATE TABLE messages (id uuid, sender_id uuid, recipient_id uuid, circle_id uuid,
        created_at timestamptz, body text);
      INSERT INTO messages
        SELECT ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
          '${user}', '${peer}', '${circle}',
          CASE WHEN i = 1 THEN '2026-10-15T11:00:00Z'::timestamptz
               WHEN i = 85 THEN '2026-10-15T13:00:00Z'::timestamptz
               ELSE '2026-10-15T12:00:00Z'::timestamptz END, 'message ' || i
        FROM generate_series(1,85) i;
      INSERT INTO messages VALUES ('99999999-0000-4000-8000-000000000001', '${user}',
        '${circle}', '${peer}', '2026-10-15T12:00:00Z', 'another conversation');
    `);
    const requests = [];
    const sdk = createClient('https://pagination.test', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input) => {
          const url = new URL(input);
          requests.push(url);
          const params = [],
            predicates = [];
          for (const [key, value] of url.searchParams) {
            if (key === 'or') predicates.push(filterSql(`or${value}`, params));
            else if (['circle_id', 'created_at'].includes(key))
              predicates.push(filterSql(`${key}.${value}`, params));
          }
          const order = url.searchParams.get('order');
          assert.match(order, /^created_at\.desc(?:,id\.desc)?$/);
          const limit = Number(url.searchParams.get('limit'));
          assert.equal(limit, 40);
          const result = await db.query(
            `SELECT * FROM messages WHERE ${predicates.join(' AND ')}
          ORDER BY ${order.replaceAll('.desc', ' DESC')} LIMIT 40`,
            params,
          );
          return new Response(JSON.stringify(result.rows), {
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    });
    const client = {
      from: sdk.from.bind(sdk),
      auth: { getUser: async () => ({ data: { user: { id: user } } }) },
    };
    const mocks = {
      './supabase': { supabase: client },
      './media': {},
      './communityDepth': {},
      '../data/demo': demo,
      'expo-file-system/legacy': {},
    };
    const api = loadSource(group ? 'src/lib/communityMedia.ts' : 'src/lib/repositories.ts', mocks);
    const seen = [];
    let cursor;
    for (let page = 0; page < 4; page++) {
      const rows = group
        ? await api.groupMessages(user, circle, cursor)
        : await api.loadConversationMessages(peer, cursor);
      seen.push(...rows.map((row) => row.id));
      if (rows.length < 40) break;
      const oldest = group ? rows.at(-1) : rows[0];
      cursor = { id: oldest.id, createdAt: group ? oldest.created_at : oldest.createdAtIso };
    }
    assert.equal(seen.length, 85);
    assert.equal(new Set(seen).size, 85);
    assert.ok(!seen.includes('99999999-0000-4000-8000-000000000001'));
    assert.equal(requests.length, 3);
    assert.equal(requests[1].searchParams.getAll('or').length, group ? 1 : 2);
  });
}

test('Message cursors preserve database precision and reject raw filter injection', () => {
  const createdAt = '2026-10-15T12:00:00.123456+00:00';
  assert.ok(pagination.messageCursorFilter({ id: user, createdAt }).includes(createdAt));
  for (const invalid of [
    { id: 'x),id.gt.0', createdAt },
    { id: user, createdAt: `${createdAt},id.gt.0` },
    { id: user, createdAt: 'not-a-date' },
  ])
    assert.throws(() => pagination.messageCursorFilter(invalid), /Invalid message page cursor/);
});

test('Load earlier messages passes both the oldest timestamp and message ID', async (t) => {
  let cursor;
  const first = { id: user, senderId: peer, body: 'Oldest', createdAtIso: '2026-10-15T12:00:00Z' };
  const chat = await mountChat({
    conversation: { ...demo.conversations[0], messages: [first] },
    hasOlder: true,
    onLoadOlder: async (value) => {
      cursor = value;
      return [];
    },
  });
  t.after(() => chat.close());
  await act(async () =>
    chat.renderer.root
      .findAllByType('ActionButton')
      .find((node) => node.props.label === 'Load earlier messages')
      .props.onPress(),
  );
  assert.deepEqual({ ...cursor }, { createdAt: first.createdAtIso, id: first.id });
});
