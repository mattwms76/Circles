# Circles authenticated native E2E operator guide

These files are **operator tooling**, not a test-account generator or login bypass. Do not run them against anonymous sessions. Never commit, upload, or paste the private fixture/evidence JSON into chat.

## Preconditions

1. Start from the intended accepted source and discover the current credential-free API origin through the approved runtime mechanism. Do not reuse a historical sandbox hostname.
2. Prepare existing, disposable **real** accounts and objects: an approved private-circle member, owner/moderator with an existing pending member, direct-conversation participant, an active host, an authorized viewer, and a separately nominated logout session. Do not create data through this tooling.
3. Save the fixture locally with `chmod 600 /private/circles-e2e.json`; it must be owned by the operator and not be a symlink. The tool refuses broader permissions.
4. Install an Android/iOS **development, internal-distribution, or release build** that contains `react-native-webrtc`. Expo Web, Metro output, bundle export, and Expo Go are not native proof. For camera/microphone proof, use a physical device.

## Private authenticated fixture

Only real current credentials and IDs belong in this file; shown values are shape-only placeholders.

```json
{
  "version": 1,
  "accounts": {
    "member": { "bearerToken": "REAL", "userId": 101 },
    "moderator": { "bearerToken": "REAL", "userId": 102 },
    "host": {
      "bearerToken": "REAL",
      "userId": 103,
      "nominatedForMutations": true
    },
    "viewer": {
      "bearerToken": "REAL",
      "userId": 104,
      "nominatedForMutations": true
    },
    "logout": {
      "bearerToken": "REAL",
      "userId": 105,
      "nominatedForMutations": true,
      "nominatedForLogout": true
    }
  },
  "ids": {
    "privateCircleId": 201,
    "privatePostId": 202,
    "moderationPendingMemberId": 203,
    "directConversationId": 204,
    "attachmentPath": "/manus-storage/social-encrypted/101/00000000-0000-4000-8000-000000000000.jpg.enc",
    "streamId": 205,
    "viewerGeneration": 1
  },
  "mutations": {
    "runId": "operator-controlled-disposable-run",
    "nominatedAccounts": ["host", "viewer", "logout"],
    "teardownStreamId": 205
  }
}
```

The member must be approved in `privateCircleId`, `privatePostId` must be visible in that circle, `moderationPendingMemberId` must still be pending and visible to the moderator, the direct conversation and attachment must be accessible to `member`, and `streamId` must be an existing disposable host stream. `viewerGeneration` is only for a **currently active** viewer in the read-only pass. Every authentication check validates `auth.me` against the expected fixture `userId` without reporting identities or values.

## Read-only API pass

```sh
node scripts/verify-authenticated-e2e.mjs \
  --fixture-file /private/circles-e2e.json \
  --api-base-url https://current-api-origin.example
```

The pass reads authenticated profile/session state, approved private circle/members/feed/comments, moderator pending-members visibility, direct conversations/messages, one-byte range of the authenticated `/api/media/*` attachment path, and current live viewer signals/chat. It creates no account, OAuth code, post, message, membership, upload, stream, or fixture. Missing accounts, IDs, active viewer generation, or auth context is `INCOMPLETE`/`BLOCKED`, never a pass.

## Mutating live flows — explicit operator action

All three flows require a fixture nomination plus the literal acknowledgement below. They use only the nominated host/viewer tokens.

```sh
node scripts/verify-authenticated-e2e.mjs \
  --fixture-file /private/circles-e2e.json --api-base-url https://current-api-origin.example \
  --allow-mutations \
  --acknowledge-mutations I_ACKNOWLEDGE_NOMINATED_TEST_SESSIONS_ONLY \
  --live-flow reconnect
```

- `reconnect` performs viewer join → heartbeat → signals read → leave → rejoin → heartbeat → signals read → leave, with a final cleanup attempt.
- `reload` performs a nominated viewer join, a nominated host `live.join` generation reload, verifies the stale viewer generation is rejected, re-joins the viewer to the new generation, reads signals, then leaves the viewer. It intentionally leaves the host stream available.
- `teardown` sends `live.end` only when `mutations.teardownStreamId` exactly equals `ids.streamId`; this ends that disposable stream and is irreversible through this tool.

The tool does not send SDP/ICE payloads or create a live stream. Actual camera-to-camera connectivity remains a device check below.

## Logout/revocation — separately disposable session only

```sh
node scripts/verify-authenticated-e2e.mjs \
  --fixture-file /private/circles-e2e.json --api-base-url https://current-api-origin.example \
  --allow-mutations \
  --acknowledge-mutations I_ACKNOWLEDGE_NOMINATED_TEST_SESSIONS_ONLY \
  --verify-logout \
  --acknowledge-logout REVOKE_NOMINATED_TEST_SESSION
```

This sends one REST logout only for `accounts.logout`, then attempts `auth.me` with the copied bearer and requires an unauthenticated result. It does not perform account-wide logout, revoke other account entries, or make an invalid/missing auth result pass. A revoked fixture must be replaced through the legitimate sign-in flow before any later run.

## Maestro read-only navigation

`maestro-authenticated-read-only.yaml` is intentionally a post-login navigation flow. It requires an already-authenticated installed Android build, resolves the actual `app/circle/[id].tsx` and `app/chat/[id].tsx` routes via the configured `manus252278368451773` scheme, and taps no mutation control. Run it only after the operator completes real OAuth in the app; do not put OAuth credentials, bearer tokens, or callback code into Maestro variables.

```sh
PRIVATE_CIRCLE_ID=201 DIRECT_CONVERSATION_ID=204 \
maestro test native-e2e/maestro-authenticated-read-only.yaml
```

The checked UI text is drawn from the current source: `CIRCLE SPACE`, the `Members` section, `Private conversation`, and `Attach photo or video`. A Maestro pass is navigation evidence only; it is not evidence for SecureStore persistence, camera/microphone access, WebRTC, or server-side private authorization.

## Manual physical-device flow

On a physical installed build, select **Sign in** and finish the real provider interaction. The callback must return through `manus252278368451773:///oauth/callback`, as built by `constants/oauth.ts`; do not inject a callback or SecureStore value. Close and reopen the app, then confirm the existing session resolves through `/api/auth/me` rather than a stale cached profile—`lib/_core/auth.ts` stores the bearer and display record in SecureStore, while `hooks/use-auth.ts` validates it remotely.

Use the approved member account to open the existing private circle and direct conversation and view the nominated attachment. With a separate physical host and viewer account, start only the pre-existing disposable stream. On the host, accept camera and microphone permissions and wait for the source's `live.heartbeat({ ready: true })` path to show `LIVE`; on the viewer, confirm the real remote video. Reload the host’s live screen, then confirm the viewer goes through the generation-bound rejoin state and receives fresh video. End the disposable stream with **End live session** and confirm the host and viewer leave the live screen. Do not treat Expo Go’s expected WebRTC warning as a pass.

## Native evidence file

After the manual device pass, save a separate owner-only file with `chmod 600 /private/circles-native-evidence.json`:

```json
{
  "version": 1,
  "execution": {
    "surface": "development-build",
    "platform": "android",
    "deviceKind": "physical",
    "buildId": "operator-recorded-build-identifier",
    "deviceId": "operator-recorded-device-identifier",
    "evidenceRef": "private-operator-record",
    "executedAt": "2026-10-23T12:00:00.000Z"
  },
  "checks": {
    "nativeModule": "passed",
    "login": "passed",
    "deepLink": "passed",
    "secureStore": "passed",
    "privateReads": "passed",
    "camera": "passed",
    "microphone": "passed",
    "hostViewer": "passed",
    "teardown": "passed"
  }
}
```

```sh
node scripts/verify-native-readiness.mjs \
  --evidence-file /private/circles-native-evidence.json \
  --project-dir /home/ubuntu/circles
```

Only `development-build`, `internal-distribution-build`, and `release-build` on a physical device are accepted. `web`, `expo-go`, `bundle`, `export`, `metro`, and unrecognized surfaces are explicitly `BLOCKED`. The script compares evidence labels with source contracts (native OAuth deep link, SecureStore, server native callback guard, WebRTC import/capture/cleanup, permissions, and authenticated media path); it prints only check names and statuses.

## Result semantics

`PASSED` means each requested check completed with its expected result. `INCOMPLETE` means required context or proof was absent. `BLOCKED` means execution was refused or authorization/session context was unavailable. `FAILED` means an attempted check produced an unexpected result. Non-`PASSED` runs exit 1; bad CLI syntax exits 2. Neither script is a release build, device test runner, provider test, or production-readiness claim.
