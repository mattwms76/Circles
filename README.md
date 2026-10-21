# Circles

Circles is an Expo / React Native / TypeScript mobile social app for iOS and Android, with a responsive Expo Web preview. Its coral-and-porcelain interface combines a photo-led feed, people discovery, joinable circles, member feeds, group conversations, private messaging and actual peer-to-peer live video.

## Running the app

The fixed mobile starter uses Metro on port **8081** and the API on **3000**. Project runtime addresses and credentials are supplied by Manus; do not copy development hostnames into app code.

```sh
pnpm db:push
pnpm exec tsx scripts/seed-social.ts
pnpm dev
```

The database migration and starter-content script are finite, repeatable preparation commands. The seed creates explicitly fictional public creator profiles and curated example content, not a fake logged-in account. All personal actions require real Manus OAuth. Development and production share the same managed database, so test writes affect the same stored data.

## Environment configuration and GitHub CI

For an independent clone, use Node.js 22 and the `pnpm@9.12.0` version pinned in `package.json`. Copy `.env.example` to `.env`, fill the actual required runtime values, and run `pnpm check:env --mode runtime` before starting the API. The [environment setup guide](docs/environment-setup.md) explains public versus private settings, native-device API addresses, OAuth origins, and encrypted-media key handling. Real environment files are ignored by Git. In the managed app, platform-injected values retain priority over local placeholders.

The [GitHub CI workflow](.github/workflows/ci.yml) runs on `main` pushes, pull requests, and manual dispatches. It verifies the environment contract, TypeScript and regression tests, then compiles the API and web/iOS/Android Expo bundles without production credentials or database writes. Read [continuous-integration.md](docs/continuous-integration.md) for build artifacts and local reproduction. Bundle compilation is not a signed native release; Dashboard mobile builds and device verification remain separate.

The [repository audit](docs/repository-audit.md) records the verified original 155-file upload and the environment/CI improvements added afterward.

## Durable sessions and API recovery

Authentication requires a durable session row bound to the user, application and expiry. The session identifier is random, only its fingerprint is stored, and the maximum lifetime is12hours. Missing/revoked/expired rows or unavailable storage fail closed. REST and tRPC logout revoke every valid credential presented in that request; client logout captures the native bearer before clearing local credentials and account caches. Remote revocation failure is reported honestly after local cleanup. This is not account-wide logout or cancellation of requests already authorized.

Apply and verify `drizzle/0003_application_sessions.sql` before serving this auth build. Existing stateless credentials must sign in again. Keep the app identity and signing key stable: encrypted media currently derives from that key. Do not rotate it as a logout workaround, and do not run unrelated historical remediation migrations over this source.

The [API recovery guide](docs/api-recovery.md) documents `pnpm recover:api`, including guarded local-manager dry-run/apply and DB-free `--verify-only` after a Manus-controlled runtime refresh/restart. The utility discovers14reviewed query procedures, never invokes mutations to fabricate test context and fails strict mode on missing real authentication, existing IDs or viewer context. Example public verification (replace the origin with the current configured result):

```sh
pnpm recover:api --verify-only --project-dir /absolute/path/to/Circles \
  --api-base-url https://current-api-origin.example --strict
```

The versioned [Expo/tRPC Recovery and Security skill](skills/expo-trpc-recovery-security/SKILL.md) contains the reusable workflow, tested utility and safe manifest template. Use its SKILL.md attachment with Manus's Add to My Skills action when installing it into another session/account; saving the source folder is not an account-installation claim. Its bundled script needs an explicit current app `--project-dir` and reviewed definitions if adapted to another app.

## Product areas

`app/(tabs)/` contains Home, Discover, Circles, Messages and Profile. `app/circle/[id].tsx` connects circle feeds, membership and governance. `app/chat/[id].tsx` connects private and group conversations. `app/create.tsx` handles text/photo/video posts, circle creation and broadcast setup. `app/live/` contains actual live discovery, WebRTC video and audience chat.

Reusable native primitives and responsive layout live in `components/`. The public types live in `shared/social.ts`. The social API and server-side permission policy live in `server/social-router.ts` and `server/social-service.ts`; live signaling is in `server/live-router.ts`. `drizzle/schema.ts` and `drizzle/live-schema.ts` define durable social and live state. Media bytes use managed object storage, with database-backed ownership and protected upload requests.

Circle creators are owners. Only owners can appoint or demote moderators. Owners and moderators can approve private membership requests, manage permitted members and remove group content, but cannot remove the owner. Private circles and conversations are checked server-side. Joining a private circle creates a pending request until approved. Messaging and group chat use short-interval polling and persistent records, with sent/read states; they do not claim push notifications or end-to-end encryption.

User-uploaded attachments are encrypted with authenticated encryption before they enter object storage. The underlying stable storage object contains ciphertext, not publicly readable private media. The app reads the original media through `/api/media/` only after current resource-access checks; native clients send their validated Bearer session and web clients use their application session cookie. Public profiles, discoverable circle covers and public posts can intentionally expose their attached media. Private posts and conversation attachments require their current membership or participant permissions. This is server-managed encryption, not end-to-end messaging encryption. The current media key is derived from the managed signing secret with a separate encryption domain; rotating that secret requires a media-key migration to preserve decryptability.

## Native and live-video requirements

Expo Web previews the common React Native UI. Expo Go can preview ordinary social screens but cannot load `react-native-webrtc`. Live video on native devices requires a **development or release build** containing the WebRTC native module and its config plugin. The Dashboard provides Android APK/AAB and iOS/TestFlight build actions from the accepted source. No store release artifact is implied by a source checkpoint.

Web live video uses browser camera/microphone permissions and actual WebRTC offer/answer/ICE media. Native uses the corresponding native module. Signaling, viewer membership and chat are authenticated. This is a small-community peer-to-peer implementation: the host sends an independent media connection to each viewer. It is not an SFU/CDN streaming platform for a large audience. Direct connectivity uses STUN; some NATs and corporate networks need a production TURN relay. TURN provisioning and physical-device / multi-network verification remain launch requirements. There are no simulated or prerecorded “live” broadcasts.

Streams and viewers have short heartbeat leases. A broadcast becomes discoverable to other people only after camera capture is ready; an interrupted or expired host cannot leave a permanent live listing. Normal cleanup ends a host stream or leaves a viewer session, while leases cover crashes and forced termination. Native broadcasting is blocked before stream creation in unsupported Expo Go.

Uploads accept JPEG, PNG, WebP and MP4 up to 20 MB. Other native media formats require conversion before upload. User-generated content moderation is provided through member controls and reporting records; automated abuse detection, push alerts, video transcoding, commercial ranking infrastructure and store submission are not claimed.

## Checks

```sh
pnpm check
pnpm lint:ci
pnpm test
pnpm build
```

The native launcher, splash, adaptive icon and monochrome assets use the Circles ring identity. Platform logo metadata is separate from bundled native assets.

## Photography

Starter community photography was collected through image search for mountain landscapes, café moments and portrait studies. The named sample creators are fictional and are not endorsements or identities of the photographed people. Source results include The Photo Hikes for mountain images, Pexels café photography and portrait photography examples. The images are used as replaceable starter content; confirm usage rights and replace with your own licensed community imagery before a commercial launch.
