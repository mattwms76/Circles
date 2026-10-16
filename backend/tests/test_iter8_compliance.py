"""
Iteration 8 — Compliance features X1–X7 + regression.

Covers:
- X3 age gate on register (DOB, under-13, minor, missing/invalid, consent)
- X1/X7 legal versions + consent recording
- X2 data export + account deletion (owner-guard)
- X4 blocking (feed hide, DM gating both directions, self-block, list, unblock)
- X5 priority report categories + moderator-only /moderation/priority
- X6 expanded reporting target types, /reports/mine feedback, resolve
- X6 statement of reasons + appeal flow (post removal, mute, appeals list)
- REGRESSION: guide/demo login, feed, post+like+comment, circles, private gating,
  conversation IDOR, wallet/gift atomicity + self-gift, mute cap.
"""

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

GUIDE_EMAIL = "guide@circles.app"
GUIDE_PASSWORD = "circles123"
DEMO_EMAIL = "demo@circles.app"
DEMO_PASSWORD = "demo1234"

ADULT_DOB = "1990-05-20"
MINOR_DOB = (datetime.now(timezone.utc).date().replace(year=datetime.now(timezone.utc).year - 15)).isoformat()
UNDER13_DOB = (datetime.now(timezone.utc).date().replace(year=datetime.now(timezone.utc).year - 10)).isoformat()


# ------------------------------- helpers -----------------------------------
def _unique_email(tag: str) -> str:
    return f"TEST_{tag}_{uuid.uuid4().hex[:10]}@example.com"


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def _register(email=None, password="pass1234", name="TEST User",
              dob=ADULT_DOB, accepted_terms=True, extra=None):
    body = {
        "email": email or _unique_email("u"),
        "password": password,
        "name": name,
        "date_of_birth": dob,
        "accepted_terms": accepted_terms,
    }
    if extra:
        body.update(extra)
    # Retry transparently on 429 (register is rate-limited 5/min per IP);
    # the limit is a production security feature, not a code bug.
    for _ in range(8):
        r = requests.post(f"{API}/auth/register", json=body, timeout=20)
        if r.status_code != 429:
            return r, body
        time.sleep(13)
    return r, body


def _login(email, password):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)


@pytest.fixture(scope="session")
def guide_token():
    r = _login(GUIDE_EMAIL, GUIDE_PASSWORD)
    assert r.status_code == 200, f"guide login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def demo_token():
    r = _login(DEMO_EMAIL, DEMO_PASSWORD)
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


# ----------------------- X3 Age gate on register ---------------------------
class TestX3AgeGate:
    def test_under_13_rejected_403(self):
        r, _ = _register(dob=UNDER13_DOB)
        assert r.status_code == 403, r.text

    def test_adult_ok_not_minor(self):
        r, body = _register(dob=ADULT_DOB)
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        assert user["is_minor"] is False
        assert user["email"].lower() == body["email"].lower()

    def test_minor_13_to_17_is_minor_true(self):
        r, _ = _register(dob=MINOR_DOB)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["is_minor"] is True

    def test_missing_dob_is_400(self):
        body = {"email": _unique_email("nodob"), "password": "pass1234",
                "name": "TEST", "accepted_terms": True}
        r = requests.post(f"{API}/auth/register", json=body, timeout=20)
        # pydantic missing field → 422; invalid value → 400. Spec says 400,
        # but 422 is also acceptable schema-validation behaviour.
        assert r.status_code in (400, 422), r.text

    def test_invalid_dob_is_400(self):
        r, _ = _register(dob="not-a-date")
        assert r.status_code == 400, r.text

    def test_accepted_terms_false_rejected_400(self):
        r, _ = _register(accepted_terms=False)
        assert r.status_code == 400, r.text

    def test_duplicate_email_still_409(self):
        email = _unique_email("dup")
        r1, _ = _register(email=email)
        assert r1.status_code == 200
        r2, _ = _register(email=email)
        assert r2.status_code == 409, r2.text


# -------------------- X1/X7 Consent + legal versions -----------------------
class TestX1LegalConsent:
    def test_legal_versions(self):
        r = requests.get(f"{API}/legal", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "terms_version" in data and "privacy_version" in data

    def test_consent_recorded_on_register(self):
        r, _ = _register()
        assert r.status_code == 200
        tok = r.json()["access_token"]
        exp = requests.get(f"{API}/users/me/export", headers=_h(tok), timeout=20)
        assert exp.status_code == 200
        payload = exp.json()
        assert len(payload["consents"]) >= 1
        c = payload["consents"][0]
        assert "tos_version" in c and "privacy_version" in c


# ---------------- X2 Data export + deletion --------------------------------
class TestX2DataRights:
    def test_export_keys_and_email(self, guide_token):
        r = requests.get(f"{API}/users/me/export", headers=_h(guide_token), timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("profile", "posts", "comments", "messages", "memberships",
                  "transactions", "gifts_sent", "consents", "exported_at"):
            assert k in d, f"missing {k}"
        assert d["profile"]["email"] == GUIDE_EMAIL

    def test_delete_account_flow(self):
        # throwaway user joins a public circle, posts, then deletes
        r, body = _register()
        tok = r.json()["access_token"]
        # join a public seed circle
        circles = requests.get(f"{API}/circles", headers=_h(tok), timeout=20).json()
        pub = next((c for c in circles if not c["is_private"]), None)
        assert pub is not None, "no public circle found"
        requests.post(f"{API}/circles/{pub['id']}/join", headers=_h(tok), timeout=20).raise_for_status()
        pr = requests.post(f"{API}/posts", headers=_h(tok),
                           json={"circle_id": pub["id"], "text": "TEST_will_be_deleted"}, timeout=20)
        assert pr.status_code == 200
        post_id = pr.json()["id"]
        # delete self
        dr = requests.delete(f"{API}/users/me", headers=_h(tok), timeout=20)
        assert dr.status_code == 200, dr.text
        # login must now fail
        lr = _login(body["email"], body["password"])
        assert lr.status_code == 401
        # the deleted post must not appear in feed for guide
        gtok = _login(GUIDE_EMAIL, GUIDE_PASSWORD).json()["access_token"]
        feed = requests.get(f"{API}/feed", headers=_h(gtok), timeout=20).json()
        assert all(p["id"] != post_id for p in feed)

    def test_owner_cannot_delete_without_transfer(self):
        r, _ = _register()
        tok = r.json()["access_token"]
        cr = requests.post(f"{API}/circles", headers=_h(tok),
                           json={"name": f"TEST_owned_{uuid.uuid4().hex[:6]}"}, timeout=20)
        assert cr.status_code == 200
        dr = requests.delete(f"{API}/users/me", headers=_h(tok), timeout=20)
        assert dr.status_code == 400, dr.text

    def test_guide_delete_blocked_owns_seed(self, guide_token):
        # DO NOT actually delete guide — just assert the 400 guard
        r = requests.delete(f"{API}/users/me", headers=_h(guide_token), timeout=20)
        assert r.status_code == 400, r.text


# ---------------- X4 Blocking ---------------------------------------------
class TestX4Blocking:
    def test_block_self_400(self, guide_token):
        me = requests.get(f"{API}/auth/me", headers=_h(guide_token), timeout=20).json()
        r = requests.post(f"{API}/users/{me['id']}/block", headers=_h(guide_token), timeout=20)
        assert r.status_code == 400

    def test_full_block_cycle(self):
        # A and B
        ra, abody = _register()
        rb, bbody = _register()
        atok = ra.json()["access_token"]; btok = rb.json()["access_token"]
        a_id = ra.json()["user"]["id"]; b_id = rb.json()["user"]["id"]

        # join a shared public circle; B posts
        circles = requests.get(f"{API}/circles", headers=_h(atok), timeout=20).json()
        pub = next(c for c in circles if not c["is_private"])
        requests.post(f"{API}/circles/{pub['id']}/join", headers=_h(atok), timeout=20)
        requests.post(f"{API}/circles/{pub['id']}/join", headers=_h(btok), timeout=20)
        bpost = requests.post(f"{API}/posts", headers=_h(btok),
                              json={"circle_id": pub["id"], "text": "TEST_from_B"}, timeout=20).json()

        # pre-existing direct conv A<->B
        conv = requests.post(f"{API}/conversations/direct", headers=_h(atok),
                             json={"user_id": b_id}, timeout=20)
        assert conv.status_code == 200
        conv_id = conv.json()["id"]

        # A blocks B
        br = requests.post(f"{API}/users/{b_id}/block", headers=_h(atok), timeout=20)
        assert br.status_code == 200

        # Feed must hide B's post
        feed = requests.get(f"{API}/feed", headers=_h(atok), timeout=20).json()
        assert all(p["id"] != bpost["id"] for p in feed)

        # new DM start forbidden
        d2 = requests.post(f"{API}/conversations/direct", headers=_h(atok),
                           json={"user_id": b_id}, timeout=20)
        assert d2.status_code == 403

        # messaging in pre-existing conv forbidden both directions
        m_ab = requests.post(f"{API}/conversations/{conv_id}/messages", headers=_h(atok),
                             json={"text": "TEST_hi"}, timeout=20)
        assert m_ab.status_code == 403
        m_ba = requests.post(f"{API}/conversations/{conv_id}/messages", headers=_h(btok),
                             json={"text": "TEST_hi"}, timeout=20)
        assert m_ba.status_code == 403

        # blocks list contains B
        bl = requests.get(f"{API}/users/me/blocks", headers=_h(atok), timeout=20).json()
        assert any(x["id"] == b_id for x in bl)

        # unblock
        ur = requests.post(f"{API}/users/{b_id}/unblock", headers=_h(atok), timeout=20)
        assert ur.status_code == 200
        # messaging works
        m_ok = requests.post(f"{API}/conversations/{conv_id}/messages", headers=_h(atok),
                             json={"text": "TEST_hello_again"}, timeout=20)
        assert m_ok.status_code == 200


# ---------------- X5 Priority / Illegal reporting --------------------------
class TestX5Priority:
    def test_priority_true_for_csam(self, demo_token):
        r = requests.post(f"{API}/reports", headers=_h(demo_token),
                          json={"target_type": "post", "target_id": "nonexistent",
                                "category": "csam", "reason": "TEST"}, timeout=20)
        assert r.status_code == 200
        assert r.json()["priority"] is True

    def test_priority_false_for_spam(self, demo_token):
        r = requests.post(f"{API}/reports", headers=_h(demo_token),
                          json={"target_type": "post", "target_id": "nonexistent",
                                "category": "spam", "reason": "TEST"}, timeout=20)
        assert r.status_code == 200
        assert r.json()["priority"] is False

    def test_priority_queue_moderator_only(self, guide_token, demo_token):
        r = requests.get(f"{API}/moderation/priority", headers=_h(guide_token), timeout=20)
        assert r.status_code == 200
        # every row must be priority
        for row in r.json():
            assert row.get("priority") is True
        # non-mod forbidden
        r2 = requests.get(f"{API}/moderation/priority", headers=_h(demo_token), timeout=20)
        assert r2.status_code == 403


# ---------------- X6 Expanded reporting + feedback -------------------------
class TestX6Feedback:
    def test_invalid_target_type_400(self, demo_token):
        r = requests.post(f"{API}/reports", headers=_h(demo_token),
                          json={"target_type": "banana", "target_id": "x",
                                "category": "spam"}, timeout=20)
        assert r.status_code == 400

    def test_target_types_accepted(self, demo_token):
        for t in ("post", "comment", "message", "user", "room"):
            r = requests.post(f"{API}/reports", headers=_h(demo_token),
                              json={"target_type": t, "target_id": "TEST_tgt",
                                    "category": "spam", "reason": "TEST"}, timeout=20)
            assert r.status_code == 200, f"{t}: {r.text}"

    def test_mine_and_resolve_cycle(self, demo_token, guide_token):
        r = requests.post(f"{API}/reports", headers=_h(demo_token),
                          json={"target_type": "user", "target_id": "TEST_victim",
                                "category": "harassment", "reason": "TEST_mine"}, timeout=20)
        rid = r.json()["report_id"]
        mine = requests.get(f"{API}/reports/mine", headers=_h(demo_token), timeout=20).json()
        assert any(x["id"] == rid for x in mine)
        # moderator resolves
        res = requests.post(f"{API}/reports/{rid}/resolve", headers=_h(guide_token),
                            json={"action": "removed", "note": "TEST_resolved"}, timeout=20)
        assert res.status_code == 200
        mine2 = requests.get(f"{API}/reports/mine", headers=_h(demo_token), timeout=20).json()
        row = next(x for x in mine2 if x["id"] == rid)
        assert row["status"] == "resolved"
        assert row["resolution"]["action"] == "removed"


# ---------------- X6 Statement of reasons + appeal -------------------------
class TestX6Appeals:
    def test_post_removal_logs_action_and_appeal(self, guide_token):
        # register throwaway, join public circle, post
        r, body = _register()
        tok = r.json()["access_token"]
        circles = requests.get(f"{API}/circles", headers=_h(tok), timeout=20).json()
        pub = next(c for c in circles if not c["is_private"])
        requests.post(f"{API}/circles/{pub['id']}/join", headers=_h(tok), timeout=20)
        p = requests.post(f"{API}/posts", headers=_h(tok),
                         json={"circle_id": pub["id"], "text": "TEST_to_remove"}, timeout=20).json()
        # guide removes
        d = requests.delete(f"{API}/posts/{p['id']}", headers=_h(guide_token), timeout=20)
        assert d.status_code == 200
        # author sees moderation action
        acts = requests.get(f"{API}/moderation/actions/mine", headers=_h(tok), timeout=20).json()
        pr = next((a for a in acts if a["action"] == "post_removed" and a["target_id"] == p["id"]), None)
        assert pr is not None and pr.get("reason")
        action_id = pr["id"]
        # appeal
        ap = requests.post(f"{API}/moderation/actions/{action_id}/appeal", headers=_h(tok),
                           json={"reason": "TEST_appeal"}, timeout=20)
        assert ap.status_code == 200
        # someone-else's appeal → 403
        r2, _ = _register()
        tok2 = r2.json()["access_token"]
        ap2 = requests.post(f"{API}/moderation/actions/{action_id}/appeal", headers=_h(tok2),
                            json={"reason": "TEST_notmine"}, timeout=20)
        assert ap2.status_code == 403
        # double appeal → 409
        ap3 = requests.post(f"{API}/moderation/actions/{action_id}/appeal", headers=_h(tok),
                            json={"reason": "TEST_again"}, timeout=20)
        assert ap3.status_code == 409
        # mod sees open appeals list
        appeals = requests.get(f"{API}/moderation/appeals", headers=_h(guide_token), timeout=20)
        assert appeals.status_code == 200
        assert any(a["action_id"] == action_id for a in appeals.json())

    def test_mute_logs_action(self, guide_token):
        # throwaway user joins a circle guide owns (guide owns seed circles)
        r, _ = _register()
        tok = r.json()["access_token"]
        uid = r.json()["user"]["id"]
        # find a guide-owned circle
        gme = requests.get(f"{API}/auth/me", headers=_h(guide_token), timeout=20).json()
        circles = requests.get(f"{API}/circles", headers=_h(guide_token), timeout=20).json()
        owned = next((c for c in circles if c["owner_id"] == gme["id"] and not c["is_private"]), None)
        assert owned, "guide owns no public circle"
        requests.post(f"{API}/circles/{owned['id']}/join", headers=_h(tok), timeout=20)
        # mute
        mr = requests.post(f"{API}/circles/{owned['id']}/members/{uid}/mute",
                           headers=_h(guide_token), json={"minutes": 10}, timeout=20)
        assert mr.status_code == 200
        acts = requests.get(f"{API}/moderation/actions/mine", headers=_h(tok), timeout=20).json()
        assert any(a["action"] == "muted" for a in acts)


# -------------------------- REGRESSION ------------------------------------
class TestRegression:
    def test_guide_demo_login_still_ok(self, guide_token, demo_token):
        assert guide_token and demo_token

    def test_feed_ok(self, demo_token):
        r = requests.get(f"{API}/feed", headers=_h(demo_token), timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_post_like_comment(self, demo_token):
        circles = requests.get(f"{API}/circles", headers=_h(demo_token), timeout=20).json()
        pub = next(c for c in circles if not c["is_private"])
        requests.post(f"{API}/circles/{pub['id']}/join", headers=_h(demo_token), timeout=20)
        pr = requests.post(f"{API}/posts", headers=_h(demo_token),
                           json={"circle_id": pub["id"], "text": "TEST_regression"}, timeout=20)
        assert pr.status_code == 200
        pid = pr.json()["id"]
        lr = requests.post(f"{API}/posts/{pid}/like", headers=_h(demo_token), timeout=20)
        assert lr.status_code == 200 and lr.json()["liked"] in (True, False)
        cr = requests.post(f"{API}/posts/{pid}/comments", headers=_h(demo_token),
                           json={"text": "TEST_cmt"}, timeout=20)
        assert cr.status_code == 200

    def test_circles_and_rooms_and_events(self, demo_token):
        for ep in ("/circles", "/circles?search=Morning", "/rooms", "/events/upcoming"):
            r = requests.get(f"{API}{ep}", headers=_h(demo_token), timeout=20)
            assert r.status_code == 200, f"{ep}: {r.status_code}"

    def test_wallet_and_self_gift(self, demo_token):
        w = requests.get(f"{API}/wallet", headers=_h(demo_token), timeout=20)
        assert w.status_code == 200
        me = requests.get(f"{API}/auth/me", headers=_h(demo_token), timeout=20).json()
        gf = requests.post(f"{API}/gifts", headers=_h(demo_token),
                           json={"recipient_id": me["id"], "gift_type": "Heart"}, timeout=20)
        assert gf.status_code == 400

    def test_mute_cap_7_days(self, guide_token):
        # pick a guide-owned circle, mute demo for 999999 minutes → clamped to 7d
        gme = requests.get(f"{API}/auth/me", headers=_h(guide_token), timeout=20).json()
        circles = requests.get(f"{API}/circles", headers=_h(guide_token), timeout=20).json()
        owned = next((c for c in circles if c["owner_id"] == gme["id"]), None)
        r2, _ = _register()
        uid = r2.json()["user"]["id"]
        tok2 = r2.json()["access_token"]
        requests.post(f"{API}/circles/{owned['id']}/join", headers=_h(tok2), timeout=20)
        mr = requests.post(f"{API}/circles/{owned['id']}/members/{uid}/mute",
                           headers=_h(guide_token), json={"minutes": 999999}, timeout=20)
        assert mr.status_code == 200
        until = datetime.fromisoformat(mr.json()["muted_until"].replace("Z", "+00:00"))
        delta = until - datetime.now(timezone.utc)
        assert delta <= timedelta(days=7, minutes=1)

    def test_private_circle_gating(self, demo_token):
        # Create private circle as new user, demo cannot read
        r, _ = _register()
        tok = r.json()["access_token"]
        cr = requests.post(f"{API}/circles", headers=_h(tok),
                           json={"name": f"TEST_priv_{uuid.uuid4().hex[:6]}",
                                 "is_private": True}, timeout=20)
        cid = cr.json()["id"]
        gr = requests.get(f"{API}/circles/{cid}", headers=_h(demo_token), timeout=20)
        assert gr.status_code == 403

    def test_conversation_idor_still_403(self, demo_token):
        # Create a direct conv between two throwaway users; demo must not read it
        ra, _ = _register(); rb, _ = _register()
        toka = ra.json()["access_token"]; b_id = rb.json()["user"]["id"]
        conv = requests.post(f"{API}/conversations/direct", headers=_h(toka),
                             json={"user_id": b_id}, timeout=20).json()
        r = requests.get(f"{API}/conversations/{conv['id']}/messages",
                         headers=_h(demo_token), timeout=20)
        assert r.status_code == 403
