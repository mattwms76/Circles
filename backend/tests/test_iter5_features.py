"""
Backend tests for Circles iteration 5 features:
- Supporter Perks: author_is_supporter on feed/circle posts/comments (top-3 gift senders by circle)
- Mute & Ban: owner/mod can mute/unmute/remove members; muted => 403 on posts/comments;
  removed => circle_bans causes POST /join to 403 until expiry; owner immune
- Event Calendar: GET /events/upcoming returns joined-circle events from start-of-today onward
  with circle_name, rsvp_count, going; RSVP toggles going
- Regression: self-gift blocked, feed/circles/comments return 200
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

GUIDE = {"email": "guide@circles.app", "password": "circles123"}


def _register(suffix=""):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_{uuid.uuid4().hex[:8]}{suffix}@circles.app"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "pw1234", "name": f"T_{suffix or 'u'}"})
    assert r.status_code == 200, r.text
    data = r.json()
    s.headers.update({"Authorization": f"Bearer {data['access_token']}"})
    s.user = data["user"]
    return s


def _fund(session, coins=500):
    # Register additional throwaways and gift to self? No - self-gift blocked.
    # Use the dev funding endpoint if any, else rely on 100 start coins (enough for Heart=10 / Flower=25).
    return session


@pytest.fixture(scope="module")
def guide_sess():
    r = requests.post(f"{API}/auth/login", json=GUIDE)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    s.user = r.json()["user"]
    return s


@pytest.fixture(scope="module")
def test_circle(guide_sess):
    r = guide_sess.post(f"{API}/circles", json={
        "name": f"TEST_Iter5_{uuid.uuid4().hex[:6]}",
        "description": "iter5",
        "category": "General"
    })
    assert r.status_code == 200
    return r.json()


# -------------------- Supporter Perks --------------------
class TestSupporterPerks:
    def test_feed_includes_author_is_supporter_flag(self, guide_sess):
        r = guide_sess.get(f"{API}/feed")
        assert r.status_code == 200
        posts = r.json()
        if posts:
            assert "author_is_supporter" in posts[0]
            assert isinstance(posts[0]["author_is_supporter"], bool)

    def test_supporter_flag_true_after_gift(self, guide_sess):
        # Fresh circle
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_Supp_{uuid.uuid4().hex[:6]}", "description": "s", "category": "General"
        })
        cid = r.json()["id"]

        # Guide posts in circle
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST supp target"})
        pid = r.json()["id"]

        # Register sender, join circle, send Flower gift (25 coins)
        sender = _register("supp_s")
        sender.post(f"{API}/circles/{cid}/join")
        r = sender.post(f"{API}/gifts", json={
            "recipient_id": guide_sess.user["id"],
            "gift_type": "Flower",
            "post_id": pid,
        })
        assert r.status_code == 200, r.text

        # Sender posts in that circle - should now be flagged supporter
        r = sender.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST I'm a supporter"})
        assert r.status_code == 200
        sender_pid = r.json()["id"]

        posts = guide_sess.get(f"{API}/circles/{cid}/posts").json()
        sp = next(p for p in posts if p["id"] == sender_pid)
        assert sp["author_is_supporter"] is True

        # Guide (recipient) is not a supporter in their own circle (didn't send gifts)
        gp = next(p for p in posts if p["id"] == pid)
        assert gp["author_is_supporter"] is False

    def test_supporter_flag_on_comments(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_SuppC_{uuid.uuid4().hex[:6]}", "description": "s", "category": "General"
        })
        cid = r.json()["id"]
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST comment supp"})
        pid = r.json()["id"]

        supporter = _register("supp_c_sender")
        supporter.post(f"{API}/circles/{cid}/join")
        r = supporter.post(f"{API}/gifts", json={
            "recipient_id": guide_sess.user["id"],
            "gift_type": "Flower",
            "post_id": pid,
        })
        assert r.status_code == 200

        # Supporter comments on the post
        r = supporter.post(f"{API}/posts/{pid}/comments", json={"text": "TEST supporter comment"})
        assert r.status_code == 200
        body = r.json()
        assert body.get("author_is_supporter") is True

        # GET comments also carries flag
        comments = guide_sess.get(f"{API}/posts/{pid}/comments").json()
        own = next(c for c in comments if c["id"] == body["id"])
        assert own["author_is_supporter"] is True

    def test_non_supporter_flag_false(self, guide_sess, test_circle):
        cid = test_circle["id"]
        randuser = _register("rand_nosupp")
        randuser.post(f"{API}/circles/{cid}/join")
        r = randuser.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST non-supp"})
        assert r.status_code == 200
        posts = guide_sess.get(f"{API}/circles/{cid}/posts").json()
        p = next(x for x in posts if x["id"] == r.json()["id"])
        assert p["author_is_supporter"] is False


# -------------------- Mute & Ban --------------------
class TestMuteBan:
    def test_owner_can_mute_member_blocks_posting(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_Mute_{uuid.uuid4().hex[:6]}", "description": "m", "category": "General"
        })
        cid = r.json()["id"]

        victim = _register("muted")
        victim.post(f"{API}/circles/{cid}/join")

        # before mute: can post
        r = victim.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST pre-mute"})
        assert r.status_code == 200
        pid = r.json()["id"]

        # mute 30 min
        r = guide_sess.post(f"{API}/circles/{cid}/members/{victim.user['id']}/mute", json={"minutes": 30})
        assert r.status_code == 200
        assert "muted_until" in r.json()

        # post blocked
        r = victim.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST post muted"})
        assert r.status_code == 403

        # comment on existing post also blocked
        r = victim.post(f"{API}/posts/{pid}/comments", json={"text": "TEST c muted"})
        assert r.status_code == 403

        # members endpoint shows muted flag
        members = guide_sess.get(f"{API}/circles/{cid}/members").json()
        me = next(m for m in members if m["id"] == victim.user["id"])
        assert me["muted"] is True

        # unmute restores
        r = guide_sess.post(f"{API}/circles/{cid}/members/{victim.user['id']}/unmute")
        assert r.status_code == 200
        r = victim.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST post unmuted"})
        assert r.status_code == 200

    def test_non_mod_cannot_mute(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_MuteNM_{uuid.uuid4().hex[:6]}", "description": "m", "category": "General"
        })
        cid = r.json()["id"]
        a = _register("mnm_a")
        a.post(f"{API}/circles/{cid}/join")
        b = _register("mnm_b")
        b.post(f"{API}/circles/{cid}/join")
        r = a.post(f"{API}/circles/{cid}/members/{b.user['id']}/mute", json={"minutes": 10})
        assert r.status_code == 403

    def test_cannot_mute_owner(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_MuteOwn_{uuid.uuid4().hex[:6]}", "description": "m", "category": "General"
        })
        cid = r.json()["id"]
        # Promote a user to moderator who tries to mute the owner
        mod = _register("mo_mod")
        mod.post(f"{API}/circles/{cid}/join")
        guide_sess.post(f"{API}/circles/{cid}/members/{mod.user['id']}/role", json={"role": "moderator"})
        r = mod.post(f"{API}/circles/{cid}/members/{guide_sess.user['id']}/mute", json={"minutes": 10})
        assert r.status_code == 400

    def test_remove_deletes_membership_and_bans_rejoin(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_Rm_{uuid.uuid4().hex[:6]}", "description": "r", "category": "General"
        })
        cid = r.json()["id"]
        victim = _register("rm_victim")
        r = victim.post(f"{API}/circles/{cid}/join")
        assert r.status_code == 200

        r = guide_sess.post(f"{API}/circles/{cid}/members/{victim.user['id']}/remove", json={"minutes": 60})
        assert r.status_code == 200
        assert "banned_until" in r.json()

        # Membership removed
        members = guide_sess.get(f"{API}/circles/{cid}/members").json()
        assert not any(m["id"] == victim.user["id"] for m in members)

        # Rejoin blocked
        r = victim.post(f"{API}/circles/{cid}/join")
        assert r.status_code == 403

    def test_cannot_remove_owner(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_RmOwn_{uuid.uuid4().hex[:6]}", "description": "r", "category": "General"
        })
        cid = r.json()["id"]
        mod = _register("rmo_mod")
        mod.post(f"{API}/circles/{cid}/join")
        guide_sess.post(f"{API}/circles/{cid}/members/{mod.user['id']}/role", json={"role": "moderator"})
        r = mod.post(f"{API}/circles/{cid}/members/{guide_sess.user['id']}/remove", json={"minutes": 60})
        assert r.status_code == 400


# -------------------- Event Calendar --------------------
class TestEventCalendar:
    def test_upcoming_events_returns_joined_circles(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_Ev_{uuid.uuid4().hex[:6]}", "description": "ev", "category": "General"
        })
        cid = r.json()["id"]
        starts = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        r = guide_sess.post(f"{API}/circles/{cid}/events", json={
            "title": "TEST Future Event", "description": "d", "starts_at": starts
        })
        assert r.status_code == 200
        eid = r.json()["id"]

        up = guide_sess.get(f"{API}/events/upcoming")
        assert up.status_code == 200
        events = up.json()
        hit = next((e for e in events if e["id"] == eid), None)
        assert hit is not None
        assert hit["circle_id"] == cid
        assert "circle_name" in hit
        assert hit["circle_name"]  # non-empty
        assert "rsvp_count" in hit
        assert "going" in hit
        assert hit["going"] is False

    def test_upcoming_excludes_past_events(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_EvPast_{uuid.uuid4().hex[:6]}", "description": "ev", "category": "General"
        })
        cid = r.json()["id"]
        past = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
        r = guide_sess.post(f"{API}/circles/{cid}/events", json={
            "title": "TEST Past Event", "description": "d", "starts_at": past
        })
        assert r.status_code == 200
        past_eid = r.json()["id"]

        up = guide_sess.get(f"{API}/events/upcoming").json()
        assert not any(e["id"] == past_eid for e in up)

    def test_rsvp_toggle_updates_going(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_Rsvp_{uuid.uuid4().hex[:6]}", "description": "ev", "category": "General"
        })
        cid = r.json()["id"]
        starts = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        r = guide_sess.post(f"{API}/circles/{cid}/events", json={
            "title": "TEST RSVP", "description": "d", "starts_at": starts
        })
        eid = r.json()["id"]

        r = guide_sess.post(f"{API}/events/{eid}/rsvp")
        assert r.status_code == 200
        assert r.json()["going"] is True
        assert r.json()["rsvp_count"] >= 1

        # Toggle off
        r = guide_sess.post(f"{API}/events/{eid}/rsvp")
        assert r.status_code == 200
        assert r.json()["going"] is False

    def test_upcoming_excludes_non_joined_circles(self):
        # Fresh user has no memberships => no events
        u = _register("ev_no_join")
        r = u.get(f"{API}/events/upcoming")
        assert r.status_code == 200
        assert r.json() == []


# -------------------- Regression --------------------
class TestRegression:
    def test_login_works(self):
        r = requests.post(f"{API}/auth/login", json=GUIDE)
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_feed(self, guide_sess):
        r = guide_sess.get(f"{API}/feed")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_like_comment(self, guide_sess, test_circle):
        cid = test_circle["id"]
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST regression post"})
        assert r.status_code == 200
        pid = r.json()["id"]
        r = guide_sess.post(f"{API}/posts/{pid}/like")
        assert r.status_code == 200
        r = guide_sess.post(f"{API}/posts/{pid}/comments", json={"text": "TEST c"})
        assert r.status_code == 200

    def test_self_gift_blocked(self, guide_sess):
        r = guide_sess.post(f"{API}/gifts", json={
            "recipient_id": guide_sess.user["id"], "gift_type": "Heart"
        })
        assert r.status_code == 400

    def test_rooms_and_conversations(self, guide_sess):
        r = guide_sess.get(f"{API}/rooms")
        assert r.status_code == 200
        r = guide_sess.get(f"{API}/conversations")
        assert r.status_code == 200

    def test_leaderboard_still_works(self, guide_sess, test_circle):
        r = guide_sess.get(f"{API}/circles/{test_circle['id']}/leaderboard")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_reports_endpoint(self, guide_sess, test_circle):
        r = guide_sess.get(f"{API}/circles/{test_circle['id']}/reports")
        assert r.status_code == 200
