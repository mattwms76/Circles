import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyStories } from './e2e-stories.mjs';

const url = process.env.CIRCLES_E2E_URL;
const anonKey = process.env.CIRCLES_E2E_ANON_KEY;
const serviceKey = process.env.CIRCLES_E2E_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Set CIRCLES_E2E_URL, CIRCLES_E2E_ANON_KEY, and CIRCLES_E2E_SERVICE_ROLE_KEY for a disposable Supabase test project.',
  );
}
const hostname = new URL(url).hostname;
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname);
if (!isLocal && process.env.CIRCLES_E2E_ALLOW_REMOTE !== 'true') {
  throw new Error(
    'This harness only targets local Supabase by default. Set CIRCLES_E2E_ALLOW_REMOTE=true only for a disposable non-production project.',
  );
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = randomUUID().slice(0, 8);
const password = `Circles-E2E-${randomUUID()}!`;
const testUsers = [];
const testCircles = [];
const testLives = [];
const testMediaPaths = [];

function expectNoError(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function createTestUser(index) {
  const email = `circles-e2e-${runId}-${index}@example.test`;
  const created = expectNoError(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `E2E Member ${index}`, handle: `e2e_${runId}_${index}` },
    }),
    `Create test user ${index}`,
  );
  testUsers.push(created.user.id);
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  expectNoError(
    await client.auth.signInWithPassword({ email, password }),
    `Sign in test user ${index}`,
  );
  return { id: created.user.id, client };
}

try {
  const [host, guest, third, fourth, fifth] = await Promise.all(
    [1, 2, 3, 4, 5].map(createTestUser),
  );

  const originalProfile = expectNoError(
    await host.client
      .from('profiles')
      .select('display_name,bio,interests')
      .eq('id', host.id)
      .single(),
    'Read own profile',
  );
  expectNoError(
    await host.client
      .from('profiles')
      .update({
        display_name: 'E2E Profile Updated',
        bio: 'Profile regression check',
        interests: ['Testing', 'Circles'],
      })
      .eq('id', host.id),
    'Update own profile',
  );
  const savedProfile = expectNoError(
    await host.client
      .from('profiles')
      .select('display_name,bio,interests')
      .eq('id', host.id)
      .single(),
    'Verify own profile update',
  );
  assert.equal(savedProfile.display_name, 'E2E Profile Updated');
  assert.deepEqual(savedProfile.interests, ['Testing', 'Circles']);
  expectNoError(
    await host.client
      .from('profiles')
      .update({ display_name: 'Unauthorized edit' })
      .eq('id', guest.id),
    'Attempt cross-account profile update',
  );
  const unchangedProfile = expectNoError(
    await admin.from('profiles').select('display_name').eq('id', guest.id).single(),
    'Verify cross-account profile isolation',
  );
  assert.notEqual(
    unchangedProfile.display_name,
    'Unauthorized edit',
    'Members must not change another profile',
  );
  assert.ok(originalProfile, 'Own profile is available to its owner');

  const publicCircle = expectNoError(
    await host.client
      .from('circles')
      .insert({
        owner_id: host.id,
        name: `E2E Public ${runId}`,
        description: 'Temporary integration fixture',
        interest: 'Testing',
        is_private: false,
      })
      .select('id')
      .single(),
    'Create public circle',
  );
  testCircles.push(publicCircle.id);
  assert.equal(
    expectNoError(
      await guest.client.rpc('request_circle_membership', { target_circle_id: publicCircle.id }),
      'Join public circle',
    ),
    'member',
  );
  const joinedCircle = expectNoError(
    await host.client.from('circles').select('members_count').eq('id', publicCircle.id).single(),
    'Verify member count after join',
  );
  assert.equal(joinedCircle.members_count, 2, 'Circle count must reflect real memberships');
  const ownerLeave = await host.client.rpc('leave_circle', { target_circle_id: publicCircle.id });
  assert.ok(ownerLeave.error, 'A circle owner must not be able to orphan the circle');
  assert.equal(
    expectNoError(
      await guest.client.rpc('leave_circle', { target_circle_id: publicCircle.id }),
      'Leave public circle',
    ),
    'left',
  );
  const afterPublicLeave = expectNoError(
    await guest.client
      .from('circle_memberships')
      .select('status')
      .eq('circle_id', publicCircle.id)
      .eq('user_id', guest.id),
    'Verify public membership removal',
  );
  assert.equal(
    afterPublicLeave.length,
    0,
    'Leaving a public circle must delete the member relationship',
  );
  assert.equal(
    expectNoError(
      await guest.client.rpc('request_circle_membership', { target_circle_id: publicCircle.id }),
      'Rejoin public circle',
    ),
    'member',
  );

  const privateCircle = expectNoError(
    await host.client
      .from('circles')
      .insert({
        owner_id: host.id,
        name: `E2E Private ${runId}`,
        description: 'Temporary integration fixture',
        interest: 'Testing',
        is_private: true,
      })
      .select('id')
      .single(),
    'Create private circle',
  );
  testCircles.push(privateCircle.id);
  assert.equal(
    expectNoError(
      await guest.client.rpc('request_circle_membership', { target_circle_id: privateCircle.id }),
      'Request private circle access',
    ),
    'pending',
  );
  assert.equal(
    expectNoError(
      await guest.client.rpc('leave_circle', { target_circle_id: privateCircle.id }),
      'Cancel private circle request',
    ),
    'request_cancelled',
  );
  assert.equal(
    expectNoError(
      await guest.client.rpc('request_circle_membership', { target_circle_id: privateCircle.id }),
      'Request private circle access again',
    ),
    'pending',
  );
  expectNoError(
    await host.client
      .from('circle_memberships')
      .update({ status: 'member' })
      .eq('circle_id', privateCircle.id)
      .eq('user_id', guest.id),
    'Approve private circle request',
  );
  await verifyStories({
    admin,
    host,
    guest,
    outsider: third,
    circleId: privateCircle.id,
    url,
    anonKey,
  });
  assert.equal(
    expectNoError(
      await guest.client.rpc('leave_circle', { target_circle_id: privateCircle.id }),
      'Leave private circle',
    ),
    'left',
  );
  if (process.env.CIRCLES_E2E_STREAM_FUNCTIONS === 'true') {
    const privateLive = expectNoError(
      await host.client.rpc('start_live_session', {
        session_title: `E2E private live ${runId}`,
        target_circle_id: privateCircle.id,
      }),
      'Start private-circle live room',
    );
    testLives.push(privateLive);
    const deniedPrivateStream = await guest.client.functions.invoke('issue-stream-token', {
      body: { sessionId: privateLive, role: 'viewer' },
    });
    assert.ok(
      deniedPrivateStream.error,
      'A non-member must not receive a token for a private-circle live room',
    );
    assert.equal(
      deniedPrivateStream.error.context?.status,
      403,
      'Private-circle token requests should be rejected as forbidden',
    );
  }

  const post = expectNoError(
    await guest.client
      .from('posts')
      .insert({
        circle_id: publicCircle.id,
        author_id: guest.id,
        body: 'Local end-to-end check',
        visibility: 'published',
      })
      .select('id')
      .single(),
    'Create circle post',
  );
  assert.ok(post.id);
  expectNoError(
    await guest.client.from('post_bookmarks').insert({ user_id: guest.id, post_id: post.id }),
    'Save post',
  );
  const saved = expectNoError(
    await guest.client.from('post_bookmarks').select('post_id'),
    'Load saved posts',
  );
  assert.ok(saved.some((row) => row.post_id === post.id));
  const privateSaved = expectNoError(
    await host.client.from('post_bookmarks').select('post_id').eq('user_id', guest.id),
    'Check bookmark privacy',
  );
  assert.equal(privateSaved.length, 0);
  expectNoError(
    await guest.client.from('post_bookmarks').delete().eq('post_id', post.id),
    'Unsave post',
  );
  const mediaPost = expectNoError(
    await guest.client
      .from('posts')
      .insert({
        circle_id: publicCircle.id,
        author_id: guest.id,
        body: 'Media upload regression check',
        visibility: 'removed',
      })
      .select('id')
      .single(),
    'Create draft media post',
  );
  const mediaPath = `${guest.id}/${mediaPost.id}/${runId}.jpg`;
  testMediaPaths.push(mediaPath);
  expectNoError(
    await guest.client.storage
      .from('post-media')
      .upload(mediaPath, new Uint8Array([255, 216, 255, 217]), { contentType: 'image/jpeg' }),
    'Upload post media',
  );
  expectNoError(
    await guest.client.from('post_media').insert({
      post_id: mediaPost.id,
      owner_id: guest.id,
      kind: 'image',
      storage_path: mediaPath,
      mime_type: 'image/jpeg',
    }),
    'Register post media',
  );
  const hiddenDraft = expectNoError(
    await host.client.from('posts').select('id').eq('id', mediaPost.id),
    'Check draft privacy',
  );
  assert.equal(hiddenDraft.length, 0, 'Other circle members must not see an unpublished draft');
  assert.ok(
    (await host.client.storage.from('post-media').createSignedUrl(mediaPath, 60)).error,
    'Other circle members must not read draft media',
  );
  expectNoError(
    await guest.client.storage.from('post-media').remove([mediaPath]),
    'Clean up an unpublished upload',
  );
  assert.ok(
    (await guest.client.storage.from('post-media').createSignedUrl(mediaPath, 60)).error,
    'Draft cleanup must actually delete the object',
  );
  expectNoError(
    await guest.client.storage
      .from('post-media')
      .upload(mediaPath, new Uint8Array([255, 216, 255, 217]), { contentType: 'image/jpeg' }),
    'Retry draft upload',
  );
  expectNoError(
    await guest.client.from('posts').update({ visibility: 'published' }).eq('id', mediaPost.id),
    'Publish post after media upload',
  );
  expectNoError(
    await guest.client.storage.from('post-media').createSignedUrl(mediaPath, 60),
    'Read media as a circle member',
  );
  expectNoError(
    await host.client.storage.from('post-media').createSignedUrl(mediaPath, 60),
    'Read published media as another circle member',
  );
  const privateMedia = await third.client.storage.from('post-media').createSignedUrl(mediaPath, 60);
  assert.ok(privateMedia.error, 'A non-member must not read private circle media');

  expectNoError(
    await host.client.from('follows').insert({ follower_id: host.id, followee_id: guest.id }),
    'Host follows guest',
  );
  const oneWayMessage = await host.client.rpc('send_direct_message', {
    recipient_user_id: guest.id,
    message_body: 'One-way messages must be rejected',
  });
  assert.ok(oneWayMessage.error, 'A one-way follow must not allow sending a DM');
  expectNoError(
    await guest.client.from('follows').insert({ follower_id: guest.id, followee_id: host.id }),
    'Guest follows host',
  );
  const hostFollowingIds = expectNoError(
    await host.client.from('follows').select('followee_id').eq('follower_id', host.id),
    'Load people this profile follows',
  );
  assert.ok(
    hostFollowingIds.some((row) => row.followee_id === guest.id),
    'A profile following list should include the followed account',
  );
  const hostFollowerIds = expectNoError(
    await host.client.from('follows').select('follower_id').eq('followee_id', host.id),
    'Load people following this profile',
  );
  assert.ok(
    hostFollowerIds.some((row) => row.follower_id === guest.id),
    'A profile follower list should include its follower',
  );
  expectNoError(
    await host.client.rpc('send_direct_message', {
      recipient_user_id: guest.id,
      message_body: 'Mutual follow message',
    }),
    'Send mutual-follow DM',
  );
  const inbox = expectNoError(
    await guest.client
      .from('direct_messages')
      .select('id,body')
      .eq('sender_id', host.id)
      .eq('recipient_id', guest.id),
    'Read mutual-follow DM',
  );
  assert.equal(inbox.length, 1);
  for (const change of [
    { body: 'Forged message' },
    { sender_id: third.id },
    { recipient_id: third.id },
    { id: randomUUID() },
    { created_at: new Date().toISOString() },
  ]) {
    assert.ok(
      (await guest.client.from('direct_messages').update(change).eq('id', inbox[0].id)).error,
      'Recipients must only have permission to update read_at',
    );
  }
  const originalMessage = expectNoError(
    await guest.client.from('direct_messages').select('body').eq('id', inbox[0].id).single(),
    'Verify original DM contents',
  );
  assert.equal(originalMessage.body, 'Mutual follow message');
  const hostConversations = expectNoError(
    await host.client.rpc('list_mutual_conversations'),
    'Load sender conversations',
  );
  assert.ok(
    hostConversations.some((conversation) => conversation.peer?.id === guest.id),
    'Mutual follows should create an inbox conversation even before more messages exist',
  );
  const guestConversations = expectNoError(
    await guest.client.rpc('list_mutual_conversations'),
    'Load recipient conversations',
  );
  assert.ok(
    guestConversations.some((conversation) => conversation.peer?.id === host.id),
    'Recipient should see the same conversation',
  );
  expectNoError(
    await guest.client.rpc('mark_conversation_read', { peer_user_id: host.id }),
    'Mark received DM as read',
  );
  const readMessage = expectNoError(
    await guest.client.from('direct_messages').select('read_at').eq('id', inbox[0].id).single(),
    'Verify read receipt',
  );
  assert.ok(readMessage.read_at, 'Recipient read receipt should be saved');
  expectNoError(
    await guest.client
      .from('follows')
      .delete()
      .eq('follower_id', guest.id)
      .eq('followee_id', host.id),
    'Remove mutual follow',
  );
  const blockedDm = await host.client.rpc('send_direct_message', {
    recipient_user_id: guest.id,
    message_body: 'Must be rejected',
  });
  assert.ok(blockedDm.error, 'DM send must stop after a follow is removed');
  const hiddenHistory = expectNoError(
    await host.client.from('direct_messages').select('id').eq('id', inbox[0].id),
    'Check sender cannot read old DMs after unfollow',
  );
  assert.equal(hiddenHistory.length, 0, 'Unfollowing must revoke access to old DM history');
  const hiddenInbox = expectNoError(
    await guest.client.rpc('list_mutual_conversations'),
    'Refresh inbox after unfollow',
  );
  assert.equal(hiddenInbox.length, 0, 'Unfollowing must remove the conversation from the inbox');
  const blockedRead = await guest.client.rpc('mark_conversation_read', { peer_user_id: host.id });
  assert.ok(blockedRead.error, 'Unfollowing must block further conversation reads');

  const liveId = expectNoError(
    await host.client.rpc('start_live_session', {
      session_title: `E2E live ${runId}`,
      target_circle_id: null,
    }),
    'Start live room',
  );
  testLives.push(liveId);
  assert.ok(
    expectNoError(
      await host.client.rpc('heartbeat_live_session', { target_session_id: liveId }),
      'Host heartbeat',
    ),
    'Host heartbeat should return its timestamp',
  );
  const nonHostHeartbeat = await guest.client.rpc('heartbeat_live_session', {
    target_session_id: liveId,
  });
  assert.ok(nonHostHeartbeat.error, 'A viewer must not refresh another host heartbeat');
  for (const [index, user] of [guest, third, fourth, fifth].entries()) {
    expectNoError(
      await user.client.rpc('request_live_seat', { target_session_id: liveId }),
      `Request seat ${index + 1}`,
    );
  }
  const requestRows = expectNoError(
    await host.client
      .from('live_seat_requests')
      .select('id,requester_id')
      .eq('session_id', liveId)
      .order('created_at'),
    'Read co-host requests',
  );
  for (const request of requestRows.slice(0, 3)) {
    expectNoError(
      await host.client.rpc('decide_live_seat_request', {
        target_request_id: request.id,
        accept_request: true,
      }),
      'Accept co-host request',
    );
  }
  const fourthSeat = await host.client.rpc('decide_live_seat_request', {
    target_request_id: requestRows[3].id,
    accept_request: true,
  });
  assert.ok(fourthSeat.error, 'The live stage must reject a fourth co-host');
  const seats = expectNoError(
    await host.client.from('live_seats').select('user_id,role').eq('session_id', liveId),
    'Read live seats',
  );
  assert.equal(seats.length, 4, 'The host plus three co-hosts should fill the stage');

  const gift = expectNoError(
    await admin
      .from('gifts')
      .select('id,coin_value')
      .eq('is_active', true)
      .order('coin_value')
      .limit(1)
      .single(),
    'Load least expensive gift',
  );
  expectNoError(
    await admin.from('coin_wallets').update({ balance: 100 }).eq('user_id', guest.id),
    'Fund disposable test wallet',
  );
  const idempotencyKey = `e2e:${runId}:gift`;
  const firstBalance = expectNoError(
    await guest.client.rpc('send_live_gift', {
      target_session_id: liveId,
      target_gift_id: gift.id,
      idempotency_key: idempotencyKey,
    }),
    'Send live gift',
  );
  const retryBalance = expectNoError(
    await guest.client.rpc('send_live_gift', {
      target_session_id: liveId,
      target_gift_id: gift.id,
      idempotency_key: idempotencyKey,
    }),
    'Retry live gift with same key',
  );
  assert.equal(retryBalance, firstBalance, 'Retry should not charge the wallet again');
  const giftEvents = expectNoError(
    await guest.client
      .from('live_gifts')
      .select('id')
      .eq('sender_id', guest.id)
      .eq('idempotency_key', idempotencyKey),
    'Read idempotent gift event',
  );
  assert.equal(giftEvents.length, 1, 'Retry should create exactly one gift event');

  const leakedWallet = expectNoError(
    await guest.client.from('coin_wallets').select('user_id').eq('user_id', host.id),
    'Check wallet row isolation',
  );
  assert.equal(leakedWallet.length, 0, 'A member must not read another member wallet');

  const creditArgs = {
    p_user_id: third.id,
    p_product_id: 'com.circles.coins.120',
    p_transaction_id: `e2e:${runId}:purchase`,
  };
  assert.ok(
    (await third.client.rpc('credit_coin_purchase', creditArgs)).error,
    'Clients must not credit their own wallets',
  );
  assert.ok(
    (await anon.rpc('credit_coin_purchase', creditArgs)).error,
    'Anonymous callers must not credit wallets',
  );
  const purchaseBalance = expectNoError(
    await admin.rpc('credit_coin_purchase', creditArgs),
    'Credit a verified service purchase',
  );
  assert.equal(Number(purchaseBalance), 120);
  assert.equal(
    expectNoError(
      await admin.rpc('credit_coin_purchase', creditArgs),
      'Retry a verified service purchase',
    ),
    purchaseBalance,
    'Purchase retries must not double-credit',
  );
  const purchaseLedger = expectNoError(
    await admin
      .from('coin_ledger')
      .select('id')
      .eq('user_id', third.id)
      .eq('idempotency_key', `purchase:${creditArgs.p_transaction_id}`),
    'Read purchase ledger',
  );
  assert.equal(purchaseLedger.length, 1);

  if (process.env.CIRCLES_E2E_STREAM_FUNCTIONS === 'true') {
    expectNoError(
      await admin
        .from('live_sessions')
        .update({ host_heartbeat_at: new Date(Date.now() - 120_000).toISOString() })
        .eq('id', liveId),
      'Age host heartbeat for token expiry test',
    );
    const staleToken = await host.client.functions.invoke('issue-stream-token', {
      body: { sessionId: liveId, role: 'host' },
    });
    assert.ok(staleToken.error, 'A stale live session must not receive a new Agora token');
    assert.equal(
      staleToken.error.context?.status,
      404,
      'Stale live-room token requests should return not found',
    );
  }

  // Community features through the real Auth, PostgREST and Storage services.
  expectNoError(
    await guest.client
      .from('profiles')
      .update({ interests: ['Testing'], onboarding_completed_at: new Date().toISOString() })
      .eq('id', guest.id),
    'Complete onboarding',
  );
  const discovered = expectNoError(
    await guest.client.rpc('search_circles', {
      search_text: `E2E Public ${runId}`,
      interest_filter: 'All',
    }),
    'Search all circles',
  );
  assert.ok(discovered.some((circle) => circle.id === publicCircle.id));
  expectNoError(
    await host.client
      .from('circles')
      .update({ welcome_text: 'Welcome to the test community' })
      .eq('id', publicCircle.id),
    'Pin circle welcome',
  );
  const event = expectNoError(
    await host.client
      .from('circle_events')
      .insert({
        circle_id: publicCircle.id,
        creator_id: host.id,
        title: 'E2E gathering',
        starts_at: new Date(Date.now() + 3600_000).toISOString(),
      })
      .select('id')
      .single(),
    'Schedule circle event',
  );
  expectNoError(
    await guest.client.from('event_rsvps').insert({ event_id: event.id, user_id: guest.id }),
    'RSVP to event',
  );
  const guestActivity = expectNoError(
    await guest.client.from('notifications').select('id,kind').eq('target_id', event.id),
    'Read event notification',
  );
  assert.equal(guestActivity.length, 1);
  assert.equal(
    expectNoError(
      await third.client.from('notifications').select('id').eq('target_id', event.id),
      'Verify activity privacy',
    ).length,
    0,
  );
  expectNoError(
    await guest.client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', guestActivity[0].id),
    'Mark activity read',
  );
  assert.ok(
    (
      await guest.client
        .from('notifications')
        .update({ title: 'Forged alert' })
        .eq('id', guestActivity[0].id)
    ).error,
  );
  expectNoError(
    await guest.client.from('notification_preferences').upsert({
      user_id: guest.id,
      quiet_enabled: true,
      timezone: 'Europe/London',
      quiet_start: '22:00',
      quiet_end: '08:00',
    }),
    'Save quiet hours',
  );
  expectNoError(
    await guest.client
      .from('circle_notification_preferences')
      .upsert({ user_id: guest.id, circle_id: publicCircle.id, enabled: false }),
    'Mute a circle',
  );
  expectNoError(
    await guest.client.rpc('leave_live_seat', { target_session_id: liveId }),
    'Release own co-host seat',
  );
  assert.equal(
    expectNoError(
      await host.client
        .from('live_seats')
        .select('user_id')
        .eq('session_id', liveId)
        .eq('user_id', guest.id),
      'Verify co-host seat removal',
    ).length,
    0,
  );
  assert.ok(
    (await guest.client.rpc('moderation_queue')).error,
    'Ordinary members cannot read the moderation queue',
  );
  expectNoError(
    await admin.from('moderators').insert({ user_id: fifth.id }),
    'Assign disposable test moderator',
  );
  const report = expectNoError(
    await host.client
      .from('reports')
      .insert({
        reporter_id: host.id,
        target_type: 'post',
        target_id: post.id,
        reason: 'E2E moderation fixture',
      })
      .select('id')
      .single(),
    'Report post',
  );
  const queue = expectNoError(
    await fifth.client.rpc('moderation_queue'),
    'Moderator reviews report queue',
  );
  assert.ok(queue.some((item) => item.id === report.id));
  expectNoError(
    await fifth.client.rpc('review_report', {
      report_id: report.id,
      decision: 'remove',
      note: 'Regression test',
    }),
    'Remove reported post',
  );
  assert.ok(
    (await guest.client.from('posts').update({ visibility: 'published' }).eq('id', post.id)).error,
    'Authors cannot republish moderated posts',
  );
  assert.ok(
    (await guest.client.rpc('prepare_account_deletion', { target_user: host.id })).error,
    'Clients cannot delete another account',
  );
  if (process.env.CIRCLES_E2E_ACCOUNT_FUNCTIONS === 'true') {
    const deleted = expectNoError(
      await fourth.client.functions.invoke('delete-account', {
        body: { confirmation: 'DELETE', password },
      }),
      'Delete own account through Edge Function',
    );
    assert.equal(deleted.deleted, true);
    assert.ok(
      (await admin.auth.admin.getUserById(fourth.id)).error,
      'Auth account must be removed',
    );
    testUsers.splice(testUsers.indexOf(fourth.id), 1);
  }

  expectNoError(
    await guest.client.from('follows').insert({ follower_id: guest.id, followee_id: host.id }),
    'Restore mutual follow before blocking',
  );
  expectNoError(
    await host.client.rpc('block_user', { target_user_id: guest.id }),
    'Block a follower',
  );
  expectNoError(
    await host.client.rpc('block_user', { target_user_id: guest.id }),
    'Repeat block without error',
  );
  const remainingFollowEdges = expectNoError(
    await host.client
      .from('follows')
      .select('follower_id,followee_id')
      .or(
        `and(follower_id.eq.${host.id},followee_id.eq.${guest.id}),and(follower_id.eq.${guest.id},followee_id.eq.${host.id})`,
      ),
    'Verify blocking removes both follow edges',
  );
  assert.equal(
    remainingFollowEdges.length,
    0,
    'Blocking must remove the follower and following relationships',
  );
  const refollow = await guest.client
    .from('follows')
    .insert({ follower_id: guest.id, followee_id: host.id });
  assert.ok(refollow.error, 'A blocked follower must not be able to follow again');

  console.log(
    'PASS: profile RLS, follow lists, circle membership/counts and owner protection, draft media privacy/upload/cleanup, DM read receipts and immutable contents, unfollow revocation, blocking, host-only heartbeats, co-host limits, idempotent gifts and purchase credits, wallet RLS, onboarding, discovery, notifications, events, moderation, and account deletion authorization.',
  );
} finally {
  if (testMediaPaths.length) {
    const { error } = await admin.storage.from('post-media').remove(testMediaPaths);
    if (error) console.error(`Cleanup warning for temporary media: ${error.message}`);
  }
  for (const liveId of testLives) {
    const { error } = await admin.from('live_sessions').delete().eq('id', liveId);
    if (error) console.error(`Cleanup warning for temporary live room ${liveId}: ${error.message}`);
  }
  for (const circleId of testCircles) {
    const { error } = await admin.from('circles').delete().eq('id', circleId);
    if (error) console.error(`Cleanup warning for temporary circle ${circleId}: ${error.message}`);
  }
  for (const userId of testUsers) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`Cleanup warning for temporary account ${userId}: ${error.message}`);
  }
}
