# Circles: Record → Preview → Publish

## Implemented source

The existing post composer now offers native video recording and existing-library selection. Members choose a **30- or 60-second maximum** before recording; 30 seconds remains the default. `expo-camera` requests camera and microphone access only after an explicit action, waits for readiness, offers front/back selection before capture, displays an elapsed timer, and synchronously guards repeated Record/Stop actions. Recording requests **720p** and H.264 where supported; the interface reports actual inspected dimensions rather than promising that every device produces 720p.

The recorder releases its camera before local `expo-video` playback. Preview offers play/pause, native seeking, replay, Retake, and Use video. Use returns the clip to the composer without publishing; the caption survives retakes and recoverable failures. The composer also displays actual video playback instead of rendering video files as images. Web keeps library uploads and clearly identifies native-only recording.

Recordings are inspected from actual MP4 bytes for supported nonfragmented container, H.264/AAC metadata, sample timing, dimensions, and file size. The selected duration and effective upload limit are independently enforced, with a hard cap of **20 MiB**. Files are adopted into an app-owned temporary cache; only canonical direct-child camera/owned-cache paths can be cleaned up. Library files are never deleted. Preview does not upload or encode base64. Explicit Publish performs a bounded re-read and validation before entering the existing encrypted upload path.

The recorder has a conservative 250 ms automatic-stop margin to leave room for audio/mux finalization. Native duration/file-size guards and server byte validation remain authoritative. The MP4 inspector conservatively accounts for AAC sample-table padding; it does not implement arbitrary edit-list trimming or transcoding. Unsupported native output is rejected with truthful guidance, not renamed or relabeled.

## Retry-safe publication

The composer retains the exact canonical uploaded URL and a cryptographic `clientPublishId`. Actor, composer, route/audience, and async-operation fences prevent late results from populating another scope. Uncertain delivery locks editing and Retry sends the same canonical payload and operation ID. Definitive rejection unlocks deliberate editing but an unchanged Retry still preserves its ID, including after a deleted-post conflict. Feed/profile invalidation and local-success cleanup occur only after confirmed success. A lost response never triggers deletion of server media.

The protected server creates the post, media claim, and actor/operation receipt transactionally. Identical retries return the original post; changed payloads conflict; a deleted post leaves a tombstone rather than being recreated. Current membership, actor-owned attachment, and stored upload MIME remain server-authoritative. Legacy callers without the optional operation ID remain compatible. Recorded uploads undergo MP4 inspection before encryption/storage.

`social.publicationStatus` exposes only `{ ready: boolean }` and prevents an expensive upload when the durable receipt schema is unavailable. The read-only recovery inventory now covers **31 queries**, while the existing **27-table `circles_app`** readiness contract is unchanged.

## Database rollout

The owner separately approved only `operations/migrations/0015_circles_publish_post_receipts.sql` on 27 October 2026. Its exact SHA-256 is:

```text
20a240535e0a5f40a8504ce7368fc5ce9e05ce346be9dc89f3d2934994844bb3
```

It adds private `circles_publish` receipts, actor/operation uniqueness, payload hashes, deletion-safe post references, forced RLS, and restricted runtime permissions. The independent review found no migration defect. The exact approved SQL committed successfully at 08:04 UTC; the existing 27-table app catalog fingerprint is unchanged, forced RLS is verified, and bounded receipt readiness is now `{ ready: true }` under the restricted runtime role. No user rows were read or written by the installation/verification, and no providers, schedules, or app-publication settings were changed. Both existing API and Metro listeners remain ready.

## Validation and release boundaries

The isolated PostgreSQL 17 publication fixture passed 7 actual HTTP/router/service/Drizzle tests, including concurrent exact retries, payload conflicts, actor isolation, ownership/MIME rejection, deletion tombstones, private permissions/readiness, and missing-schema failure. Existing Circle Home, Activity, Moderator, conversation/pagination, and email/session fixtures also passed without production access.

All **869 tests in 167 files** passed in the credential-free full regression suite. Strict TypeScript, including unused-local/parameter checks, API compilation, zero-warning lint, source formatting, environment-template/public-CI checks, and the packaged recovery-skill validator passed. Focused source tests cover MP4/file validation, lifecycle/late completion, publish-attempt identity, safe error copy, local preview rendering through mocked native seams, and composer recipient/readiness behavior. The independent read-only integration review found no source-confirmed correctness, security, lifecycle, or migration defect.

Native configuration introspection confirms preserved Circles identifiers/scheme and recording/live permission descriptions. Web, iOS, and Android JavaScript exports passed; their compiled composer callbacks retain the synchronous unsettled-publication caption guard. This ARM sandbox cannot execute Expo's packaged x86-64 Hermes compiler, so those exports used the validation-only `--no-bytecode` flag without changing the app's Hermes configuration. They do not prove Hermes bytecode or signed native builds. The source CI retains the normal native export/build boundary on its compatible runner.

**Not claimed:** physical iOS/Android camera or microphone behavior, low-storage/background/network journeys on devices, signed release binaries, real provider transfer, or public app deployment. The Dashboard must rebuild the native binary for the new native dependencies/configuration, and the recording flow still requires physical-device validation.
