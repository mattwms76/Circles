// Real Agora live audio for native (iOS/Android) — ready to use on a DEV/NATIVE BUILD.
//
// NOT referenced by the app by default so the Expo Go / web preview stays stable.
// To enable (see src/audio/README.md):
//   1) yarn expo install react-native-agora expo-dev-client expo-build-properties
//   2) add AGORA_APP_ID + AGORA_APP_CERTIFICATE to backend/.env and
//      EXPO_PUBLIC_AGORA_APP_ID to frontend/.env
//   3) import { AudioRoom } from "@/src/audio/AudioRoom" inside app/room/[id].tsx
//      and render it when liveConfig.enabled is true
//   4) Publish → generate a native build (Agora cannot run in Expo Go)
//
// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import {
  ChannelProfileType,
  ClientRoleType,
  createAgoraRtcEngine,
} from "react-native-agora";

import { apiPost } from "@/src/api/client";

const APP_ID = process.env.EXPO_PUBLIC_AGORA_APP_ID as string;

export function AudioRoom({
  roomId,
  uid,
  canSpeak,
  muted,
}: {
  roomId: string;
  uid: number;
  canSpeak: boolean;
  muted: boolean;
}) {
  const engine = useRef<any>(null);
  const [joined, setJoined] = useState(false);

  const getToken = async () =>
    apiPost<{ token: string; channel: string; canSpeak: boolean }>(`/api/rooms/${roomId}/rtc-token`, { uid });

  useEffect(() => {
    let handler: any;
    (async () => {
      const e = createAgoraRtcEngine();
      engine.current = e;
      handler = {
        onJoinChannelSuccess: () => setJoined(true),
        onTokenPrivilegeWillExpire: async () => {
          const x = await getToken();
          e.renewToken(x.token);
        },
      };
      e.registerEventHandler(handler);
      e.initialize({ appId: APP_ID });
      e.setChannelProfile(ChannelProfileType.ChannelProfileLiveBroadcasting);
      const x = await getToken();
      await e.joinChannel(x.token, x.channel, uid, {
        channelProfile: ChannelProfileType.ChannelProfileLiveBroadcasting,
        clientRoleType: x.canSpeak ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience,
        publishMicrophoneTrack: x.canSpeak,
        autoSubscribeAudio: true,
      });
    })().catch(() => {});
    return () => {
      engine.current?.leaveChannel();
      if (handler) engine.current?.unregisterEventHandler(handler);
      engine.current?.release();
      engine.current = null;
    };
  }, [roomId, uid]);

  // React to promotion/demotion (canSpeak) — fetch a fresh role-scoped token and switch role.
  useEffect(() => {
    (async () => {
      const e = engine.current;
      if (!e || !joined) return;
      const x = await getToken();
      await e.renewToken(x.token);
      await e.setClientRole(canSpeak ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience);
      await e.updateChannelMediaOptions({ publishMicrophoneTrack: canSpeak });
    })().catch(() => {});
  }, [canSpeak, joined]);

  // React to mute toggle.
  useEffect(() => {
    engine.current?.muteLocalAudioStream(muted);
  }, [muted]);

  return null;
}
