# Live Audio (Agora) — enabling real voice in Live Rooms

The app ships with a **simulated** stage (host / co-host / listener, raise-hand, mute UI) that works
everywhere, including Expo Go and the web preview. Real microphone audio uses **Agora** and requires a
**native/dev build** — it cannot run in Expo Go.

Everything below is already built and waiting:
- Backend token signer: `POST /api/rooms/{id}/rtc-token` (role derived from server-side membership) and
  `GET /api/live/config` (tells the client whether audio is enabled).
- Client component: `src/audio/AudioRoom.native.tsx` (native) — wired to the token endpoint, handles
  join, token renewal, promotion/demotion role switch, and mute.

## 1. Get Agora credentials
Create a free project at https://console.agora.io → choose **App ID + Token (Recommended)**.
Copy the **App ID** (public) and reveal the **App Certificate** (secret).

## 2. Set the keys
- `backend/.env`: `AGORA_APP_ID="..."` and `AGORA_APP_CERTIFICATE="..."`
- `frontend/.env`: `EXPO_PUBLIC_AGORA_APP_ID="..."`
(Deployed app: add the same under Publish → Secrets, then redeploy.)

## 3. Install native deps
```
yarn expo install react-native-agora expo-dev-client expo-build-properties
```
Add to `app.json` plugins: `expo-dev-client`, and
`["expo-build-properties", { "android": { "minSdkVersion": 24 }, "ios": { "deploymentTarget": "12.4" } }]`.
Add `android.permissions: ["android.permission.RECORD_AUDIO"]` and
`ios.infoPlist.NSMicrophoneUsageDescription`.

## 4. Wire it into the room screen
In `app/room/[id].tsx`, when `liveConfig.enabled` is true, render:
```tsx
import { AudioRoom } from "@/src/audio/AudioRoom";
// uid must be a stable positive 32-bit int for this user in this room
<AudioRoom roomId={room.id} uid={myUid} canSpeak={room.my_role !== "listener"} muted={!micOn} />
```

## 5. Build & test
Publish → generate iOS/Android builds. Install on two real devices and confirm the host is heard,
listeners can't publish, raise-hand → promote enables the mic, and mute stops audio.
