import assert from "node:assert/strict";
import { test } from "node:test";
import { mountApp, mountChat, act, demo, deferred } from "./react-fixture.mjs";
test("Repeated sign-in events preserve the loaded profile", async (t) => {
  const app = await mountApp();
  t.after(() => app.close());
  assert.equal(app.props("HomeScreen").profile.displayName, "Saved profile");
  await app.auth("SIGNED_IN");
  assert.equal(app.props("HomeScreen").profile.displayName, "Saved profile");
  assert.equal(app.props("HomeScreen").profile.bio, "Saved bio");
});
test("Back cancels an in-flight member profile load", async (t) => {
  const pending = deferred();
  const app = await mountApp({
    repositories: { loadPublicProfile: () => pending.promise },
  });
  t.after(() => app.close());
  await act(async () => app.props("TabBar").onChange("profile"));
  await act(async () =>
    app.props("ProfileScreen").onOpenProfile(demo.people[0]),
  );
  await act(async () => app.props("PublicProfileScreen").onBack());
  await act(async () => pending.resolve(demo.people[0]));
  assert.equal(app.count("PublicProfileScreen"), 0);
});
test("Feed pagination cannot restore account data after sign-out", async (t) => {
  const app = await mountApp();
  t.after(() => app.close());
  const pending = deferred();
  app.repo.loadPosts = () => pending.promise;
  await act(async () => {
    void app.props("HomeScreen").onLoadMore();
  });
  await app.auth("SIGNED_OUT", null);
  await act(async () =>
    pending.resolve([{ ...demo.posts[0], id: "private-old-account-post" }]),
  );
  assert.equal(app.props("HomeScreen").feed.length, 0);
});
test("Demo Explore reflects current joins instead of resetting to seed data", async (t) => {
  const app = await mountApp({ connected: false });
  t.after(() => app.close());
  await app.settleSearch();
  await act(async () => app.props("TabBar").onChange("circles"));
  const circle = demo.circles.find((c) => !c.isMember && !c.isPrivate);
  await act(async () => app.props("ExploreScreen").onJoin(circle));
  await app.settleSearch();
  assert.equal(
    app.props("ExploreScreen").circles.find((c) => c.id === circle.id).isMember,
    true,
  );
});
test("Closing a chat immediately persists the latest message draft", async () => {
  const chat = await mountChat();
  await act(async () =>
    chat.renderer.root
      .findByType("TextInput")
      .props.onChangeText("Keep this draft"),
  );
  await chat.close();
  assert.ok([...chat.files.values()].includes("Keep this draft"));
});
test("Failed microphone setup releases the joined streaming adapter", async (t) => {
  let leaves = 0;
  const live = {
    ...demo.liveSessions[0],
    host: { ...demo.currentUser, id: "account-a" },
    seats: [],
  };
  const stream = {
    join: async () => {},
    leave: async () => {
      leaves++;
    },
    setMicrophoneEnabled: async () => {
      throw new Error("Microphone failed");
    },
    setCameraEnabled: async () => {},
    onRemoteUsersChanged: () => () => {},
  };
  const app = await mountApp({
    stream,
    repositories: { loadLiveSessions: async () => [live] },
  });
  t.after(() => app.close());
  await act(async () => app.props("HomeScreen").onLive(live));
  assert.equal(leaves, 1);
});
test("Activity refresh cannot restore private notifications after sign-out", async (t) => {
  const app = await mountApp();
  t.after(() => app.close());
  const pending = deferred();
  app.services.loadNotifications = () => pending.promise;
  await act(async () => app.props("HomeScreen").onActivity());
  await act(async () => {
    void app.props("ActivitySheet").onRefresh();
  });
  await app.auth("SIGNED_OUT", null);
  await act(async () =>
    pending.resolve([
      { id: "old-notification", body: "Private account activity" },
    ]),
  );
  await act(async () => app.props("HomeScreen").onActivity());
  assert.equal(app.props("ActivitySheet").items.length, 0);
});
test("New demo posts appear when opening their circle", async (t) => {
  const app = await mountApp({ connected: false });
  t.after(() => app.close());
  const circle = demo.circles.find((c) => c.isMember);
  await act(async () => app.props("HomeScreen").onCreatePost());
  await act(async () => {
    app.props("CreatePostSheet").onSelectCircle(circle.id);
    app.props("CreatePostSheet").onBody("New demo post");
  });
  await act(async () => app.props("CreatePostSheet").onSubmit());
  await act(async () => app.props("HomeScreen").onCircle(circle));
  assert.ok(
    app
      .props("CircleDetailScreen")
      .posts.some((p) => p.body === "New demo post"),
  );
});
