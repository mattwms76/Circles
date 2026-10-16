"""
Backend tests for Circles iteration 4 features:
- Moderator Tools: report, review, dismiss, remove (DELETE /posts/{id} by mod/owner),
  resolve of open reports on delete
- Gift Leaderboard: GET /circles/{id}/leaderboard with sender attribution
- Reminders: /api/reminders works (regression)
- Regression: self-gift blocked (400), gift_count increments
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
def guide_circle(guide_sess):
    r = guide_sess.post(f"{API}/circles", json={
        "name": f"TEST_Mod_{uuid.uuid4().hex[:6]}",
        "description": "mod test",
        "category": "General"
    })
    assert r.status_code == 200, r.text
    return r.json()


# -------------------- Moderator Tools --------------------
class TestModeratorReports:
    def test_create_report_stores_circle_id(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        # guide posts
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST reportable post"})
        assert r.status_code == 200
        pid = r.json()["id"]

        reporter = _register("reporter")
        reporter.post(f"{API}/circles/{cid}/join")
        r = reporter.post(f"{API}/reports", json={
            "target_type": "post",
            "target_id": pid,
            "reason": "spam",
        })
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Owner can list and the report has circle_id and enrichment
        lr = guide_sess.get(f"{API}/circles/{cid}/reports")
        assert lr.status_code == 200
        reports = lr.json()
        hit = next((x for x in reports if x["target_id"] == pid), None)
        assert hit is not None
        assert hit["circle_id"] == cid
        assert hit.get("post_text") == "TEST reportable post"
        assert "post_author" in hit
        assert hit.get("post_deleted") is False

    def test_non_mod_cannot_list_reports(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        outsider = _register("outsider")
        # even join doesn't make moderator
        outsider.post(f"{API}/circles/{cid}/join")
        r = outsider.get(f"{API}/circles/{cid}/reports")
        assert r.status_code == 403

    def test_dismiss_report_by_owner(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST dismiss"})
        pid = r.json()["id"]
        reporter = _register("dismiss_rep")
        reporter.post(f"{API}/circles/{cid}/join")
        reporter.post(f"{API}/reports", json={"target_type": "post", "target_id": pid, "reason": "x"})

        reports = guide_sess.get(f"{API}/circles/{cid}/reports").json()
        rep = next(x for x in reports if x["target_id"] == pid)

        resp = guide_sess.post(f"{API}/reports/{rep['id']}/resolve")
        assert resp.status_code == 200

        # not in open list anymore
        reports2 = guide_sess.get(f"{API}/circles/{cid}/reports").json()
        assert not any(x["id"] == rep["id"] for x in reports2)

    def test_moderator_role_can_list_and_dismiss(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        mod = _register("mod_user")
        mod.post(f"{API}/circles/{cid}/join")
        # promote to moderator
        r = guide_sess.post(f"{API}/circles/{cid}/members/{mod.user['id']}/role", json={"role": "moderator"})
        assert r.status_code == 200

        # create a report
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST mod dismiss"})
        pid = r.json()["id"]
        reporter = _register("mod_reporter")
        reporter.post(f"{API}/circles/{cid}/join")
        reporter.post(f"{API}/reports", json={"target_type": "post", "target_id": pid, "reason": "x"})

        # Moderator (non-owner) can list
        lr = mod.get(f"{API}/circles/{cid}/reports")
        assert lr.status_code == 200
        rep = next(x for x in lr.json() if x["target_id"] == pid)

        # Moderator can resolve
        dr = mod.post(f"{API}/reports/{rep['id']}/resolve")
        assert dr.status_code == 200

    def test_non_mod_cannot_resolve(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST not_resolve"})
        pid = r.json()["id"]
        reporter = _register("nnr_rep")
        reporter.post(f"{API}/circles/{cid}/join")
        reporter.post(f"{API}/reports", json={"target_type": "post", "target_id": pid, "reason": "x"})
        rep = next(x for x in guide_sess.get(f"{API}/circles/{cid}/reports").json() if x["target_id"] == pid)

        rand = _register("rand")
        r = rand.post(f"{API}/reports/{rep['id']}/resolve")
        assert r.status_code == 403


# -------------------- Delete post / Remove --------------------
class TestDeletePost:
    def test_author_can_delete_own_post(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        u = _register("own_del")
        u.post(f"{API}/circles/{cid}/join")
        r = u.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST own del"})
        pid = r.json()["id"]
        r = u.delete(f"{API}/posts/{pid}")
        assert r.status_code == 200

    def test_non_author_non_mod_403(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        a = _register("auth_a")
        a.post(f"{API}/circles/{cid}/join")
        r = a.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST not yours"})
        pid = r.json()["id"]

        b = _register("auth_b")
        b.post(f"{API}/circles/{cid}/join")
        r = b.delete(f"{API}/posts/{pid}")
        assert r.status_code == 403

    def test_circle_moderator_can_delete(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        mod = _register("del_mod")
        mod.post(f"{API}/circles/{cid}/join")
        guide_sess.post(f"{API}/circles/{cid}/members/{mod.user['id']}/role", json={"role": "moderator"})

        author = _register("del_target_a")
        author.post(f"{API}/circles/{cid}/join")
        r = author.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST mod remove"})
        pid = r.json()["id"]

        r = mod.delete(f"{API}/posts/{pid}")
        assert r.status_code == 200

    def test_delete_resolves_open_reports(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        author = _register("rr_auth")
        author.post(f"{API}/circles/{cid}/join")
        r = author.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST remove-resolves"})
        pid = r.json()["id"]

        reporter = _register("rr_rep")
        reporter.post(f"{API}/circles/{cid}/join")
        reporter.post(f"{API}/reports", json={"target_type": "post", "target_id": pid, "reason": "x"})

        # Report exists in open list
        reports = guide_sess.get(f"{API}/circles/{cid}/reports").json()
        assert any(x["target_id"] == pid for x in reports)

        # Owner deletes post
        r = guide_sess.delete(f"{API}/posts/{pid}")
        assert r.status_code == 200

        # No open report remains for this post
        reports2 = guide_sess.get(f"{API}/circles/{cid}/reports").json()
        assert not any(x["target_id"] == pid for x in reports2)

    def test_owner_can_delete_members_post(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        author = _register("owner_del_tgt")
        author.post(f"{API}/circles/{cid}/join")
        r = author.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST owner removes"})
        pid = r.json()["id"]
        r = guide_sess.delete(f"{API}/posts/{pid}")
        assert r.status_code == 200


# -------------------- Gift Leaderboard --------------------
class TestLeaderboard:
    def test_leaderboard_attributes_gift_to_circle(self, guide_sess):
        # fresh circle so leaderboard is clean
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_LB_{uuid.uuid4().hex[:6]}",
            "description": "lb",
            "category": "General"
        })
        cid = r.json()["id"]

        # guide creates a post in that circle
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST lb target"})
        pid = r.json()["id"]

        sender = _register("lb_s1")
        # Flower = 25
        r = sender.post(f"{API}/gifts", json={
            "recipient_id": guide_sess.user["id"],
            "gift_type": "Flower",
            "post_id": pid,
        })
        assert r.status_code == 200, r.text

        lb = guide_sess.get(f"{API}/circles/{cid}/leaderboard")
        assert lb.status_code == 200
        board = lb.json()
        assert isinstance(board, list)
        assert len(board) >= 1
        entry = next((e for e in board if e["id"] == sender.user["id"]), None)
        assert entry is not None
        assert entry["total"] >= 25
        assert "name" in entry
        assert "avatar_url" in entry

    def test_leaderboard_sorted_desc(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_LBSort_{uuid.uuid4().hex[:6]}",
            "description": "lb",
            "category": "General"
        })
        cid = r.json()["id"]
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST lb sort"})
        pid = r.json()["id"]

        s_small = _register("lb_small")
        s_big = _register("lb_big")
        # Small sends Heart (10)
        s_small.post(f"{API}/gifts", json={"recipient_id": guide_sess.user["id"], "gift_type": "Heart", "post_id": pid})
        # Big sends Flower (25)
        s_big.post(f"{API}/gifts", json={"recipient_id": guide_sess.user["id"], "gift_type": "Flower", "post_id": pid})

        lb = guide_sess.get(f"{API}/circles/{cid}/leaderboard").json()
        # Ensure the big one is before the small one
        totals = {e["id"]: e["total"] for e in lb}
        assert totals.get(s_big.user["id"], 0) > totals.get(s_small.user["id"], 0)
        order = [e["id"] for e in lb]
        assert order.index(s_big.user["id"]) < order.index(s_small.user["id"])

    def test_leaderboard_empty_circle(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={
            "name": f"TEST_LBEmpty_{uuid.uuid4().hex[:6]}",
            "description": "lb",
            "category": "General"
        })
        cid = r.json()["id"]
        lb = guide_sess.get(f"{API}/circles/{cid}/leaderboard")
        assert lb.status_code == 200
        assert lb.json() == []


# -------------------- Regression --------------------
class TestRegression:
    def test_self_gift_blocked(self, guide_sess):
        r = guide_sess.post(f"{API}/gifts", json={
            "recipient_id": guide_sess.user["id"],
            "gift_type": "Heart",
        })
        assert r.status_code == 400

    def test_login_feed_still_works(self, guide_sess):
        r = guide_sess.get(f"{API}/feed")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_reminders_endpoint(self):
        u = _register("rem_iter4")
        r = u.get(f"{API}/reminders")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_gift_increments_gift_count_on_post(self, guide_sess, guide_circle):
        cid = guide_circle["id"]
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST gift count"})
        pid = r.json()["id"]

        sender = _register("gc_s")
        r = sender.post(f"{API}/gifts", json={
            "recipient_id": guide_sess.user["id"],
            "gift_type": "Heart",
            "post_id": pid,
        })
        assert r.status_code == 200

        posts = guide_sess.get(f"{API}/circles/{cid}/posts").json()
        p2 = next(p for p in posts if p["id"] == pid)
        assert p2.get("gift_count", 0) >= 1

    def test_rooms_endpoint(self, guide_sess):
        r = guide_sess.get(f"{API}/rooms")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_messaging_conversations(self, guide_sess):
        r = guide_sess.get(f"{API}/conversations")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
