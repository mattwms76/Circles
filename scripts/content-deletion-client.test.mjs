import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { act, demo, deferred, loadSource, mountApp, native } from './react-fixture.mjs';
const deletion = loadSource('src/lib/contentDeletion.ts');

test('Deletion eligibility checks ownership, timestamps, and the exact 15-minute boundary', () => {
  const now = Date.now();
  const can = (age, owner='me', viewer='me') => deletion.canDeleteOwnContent(owner, viewer, new Date(now-age).toISOString(), now);
  assert.equal(can(0), true);
  assert.equal(can(899999), true);
  assert.equal(can(900000), false);
  assert.equal(can(900001), false);
  assert.equal(can(-1), false);
  assert.equal(can(1,'them'), false);
  assert.equal(deletion.canDeleteOwnContent('me','me',undefined,now), false);
  assert.equal(deletion.canDeleteOwnContent('me','me','not a date',now), false);
});

test('Native delete control expires while open and asks before removing content', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout'], now:Date.now()});
  let confirmation, deletes=0;
  const screens = loadSource('src/screens/AppScreens.tsx', {
    '../lib/contentDeletion': deletion, 'expo-image-picker': {},
    '@react-native-async-storage/async-storage': {},
    'react-native': new Proxy({ Alert: { alert: (_title,_copy,buttons) => { confirmation=buttons; } } }, {get:(o,k)=>o[k]??native[k]}),
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-video': {}, '../lib/streaming': {}, '../components/Primitives': {}, '../theme':{colors:{}}, '../appStyles':{styles:{}},
  });
  let renderer;
  const props = { ownerId:'me',viewerId:'me',kind:'message',createdAtIso:new Date(Date.now()-899000).toISOString(),onDelete:async()=>{deletes++;} };
  await act(async()=>{renderer=TestRenderer.create(React.createElement(screens.DeleteOwnContentButton,props));});
  t.after(()=>act(async()=>renderer.unmount()));
  await act(async()=>renderer.root.findByType('Pressable').props.onPress());
  assert.equal(deletes,0);
  await act(async()=>confirmation.find(button=>button.text==='Delete').onPress());
  assert.equal(deletes,1);
  await act(async()=>t.mock.timers.tick(1002));
  assert.equal(renderer.root.findAllByType('Pressable').length,0);
});

test('Demo messages and comments delete from open views and stay deleted on reopen', async t => {
  const app=await mountApp({connected:false});t.after(()=>app.close());
  await act(async()=>app.props('TabBar').onChange('inbox'));
  const conversation=app.props('InboxScreen').conversations[0];
  await act(async()=>app.props('InboxScreen').onConversation(conversation));
  await act(async()=>app.props('ChatScreen').onSend('Delete this message'));
  const message=app.props('ChatScreen').conversation.messages.at(-1);
  assert.ok(message.createdAtIso);
  await act(async()=>app.props('ChatScreen').onDelete(message));
  assert.ok(!app.props('ChatScreen').conversation.messages.some(item=>item.id===message.id));
  await act(async()=>app.props('ChatScreen').onClose());
  await act(async()=>app.props('InboxScreen').onConversation(app.props('InboxScreen').conversations[0]));
  assert.ok(!app.props('ChatScreen').conversation.messages.some(item=>item.id===message.id));
  await act(async()=>app.props('ChatScreen').onClose());
  await act(async()=>app.props('TabBar').onChange('home'));
  const post=app.props('HomeScreen').feed[0];
  await act(async()=>app.props('HomeScreen').onReply(post));
  await act(async()=>app.props('PostRepliesSheet').onDraft('Delete this comment'));
  await act(async()=>app.props('PostRepliesSheet').onSend());
  const comment=app.props('PostRepliesSheet').comments[0];
  assert.ok(comment.createdAtIso);
  await act(async()=>app.props('PostRepliesSheet').onDelete(comment));
  assert.equal(app.props('PostRepliesSheet').comments.length,0);
  await act(async()=>app.props('PostRepliesSheet').onClose());
  await act(async()=>app.props('HomeScreen').onReply(post));
  assert.equal(app.props('PostRepliesSheet').comments.length,0);
});

async function connectedApp() {
  const peer=demo.people[0];
  const message={id:'message-1',senderId:'account-a',body:'Recent message',createdAt:'now',createdAtIso:new Date().toISOString()};
  const comment={id:'comment-1',postId:demo.posts[0].id,author:{...demo.currentUser,id:'account-a'},body:'Recent comment',createdAt:'now',createdAtIso:new Date().toISOString()};
  const conversation={id:'chat',peer,isMutual:true,unread:0,messages:[message]};
  const app=await mountApp({repositories:{
    loadPeopleAndFollows:async()=>({people:[peer],followingIds:[peer.id],followerIds:[peer.id]}),
    loadConversations:async()=>[conversation], loadConversationMessages:async()=>[message], markConversationRead:async()=>{}, loadPostComments:async()=>[comment],
    deleteDirectMessage:async()=>{throw new Error('Try again');}, deletePostComment:async()=>{throw new Error('Try again');},
  }});
  return {app,message,comment};
}

test('Failed message and comment deletions keep the original content for retry', async t => {
  const {app,message,comment}=await connectedApp();t.after(()=>app.close());
  await act(async()=>app.props('TabBar').onChange('inbox'));
  await act(async()=>app.props('InboxScreen').onConversation(app.props('InboxScreen').conversations[0]));
  await act(async()=>assert.rejects(app.props('ChatScreen').onDelete(message),/Try again/));
  assert.equal(app.props('ChatScreen').conversation.messages.length,1);
  await act(async()=>app.props('ChatScreen').onClose());
  await act(async()=>app.props('TabBar').onChange('home'));
  await act(async()=>app.props('HomeScreen').onReply(demo.posts[0]));
  await act(async()=>assert.rejects(app.props('PostRepliesSheet').onDelete(comment),/Try again/));
  assert.equal(app.props('PostRepliesSheet').comments.length,1);
});

test('Realtime deletes remove open content and stale refreshes cannot restore it', async t => {
  const {app,message,comment}=await connectedApp();t.after(()=>app.close());
  await act(async()=>app.props('TabBar').onChange('inbox'));
  await act(async()=>app.props('InboxScreen').onConversation(app.props('InboxScreen').conversations[0]));
  await app.emitDelete('direct_messages',message.id);
  assert.equal(app.props('ChatScreen').conversation.messages.length,0);
  assert.equal(app.props('InboxScreen').conversations[0].messages.length,0);
  await act(async()=>app.props('ChatScreen').onClose());
  await act(async()=>app.props('TabBar').onChange('home'));
  const pending=deferred();app.repo.loadPostComments=()=>pending.promise;
  await act(async()=>app.props('HomeScreen').onReply(demo.posts[0]));
  await app.emitDelete('post_comments',comment.id);
  await act(async()=>pending.resolve([comment]));
  assert.equal(app.props('PostRepliesSheet').comments.length,0);
});
