import {
  ChannelProfileType,
  ClientRoleType,
  ConnectionStateType,
  createAgoraRtcEngine,
  RtcSurfaceView,
  VideoSourceType,
  type IRtcEngineEventHandler,
  type IRtcEngine,
} from 'react-native-agora';
import React, { useEffect } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import type { StreamingAdapter, UUID } from '../types';
import { requireSupabase } from './supabase';

export interface StreamCredentials {
  token: string;
  channel: string;
  uid: number;
  role: 'host' | 'cohost' | 'viewer';
}

export interface StreamProvider {
  issueCredentials(sessionId: UUID, role: StreamCredentials['role']): Promise<StreamCredentials>;
  adapter(onError?: (error: Error) => void): StreamingAdapter;
}

export function agoraUidFor(userId: UUID) {
  return Number.parseInt(userId.replace(/-/g, '' ).slice(0, 7), 16) + 1;
}

export class AgoraProvider implements StreamProvider {
  async issueCredentials(sessionId: UUID, role: StreamCredentials['role']): Promise<StreamCredentials> {
    const { data, error } = await requireSupabase().functions.invoke('issue-stream-token', { body: { sessionId, role } });
    if (error) throw error;
    return data as StreamCredentials;
  }

  adapter(onError?: (error: Error) => void) {
    return new AgoraStreamingAdapter((sessionId, role) => this.issueCredentials(sessionId, role), onError);
  }
}

export class AgoraStreamingAdapter implements StreamingAdapter {
  constructor(
    private readonly refreshCredentials: (sessionId: UUID, role: StreamCredentials['role']) => Promise<StreamCredentials>,
    private readonly onError?: (error: Error) => void,
  ) {}

  private engine: IRtcEngine | null = null;
  private joined = false;
  private joining = false;
  private joinContext: { sessionId: UUID; role: StreamCredentials['role'] } | null = null;
  private tokenRefresh: Promise<void> | null = null;
  private remoteUsers = new Set<number>();
  private remoteUsersListener: ((uids: number[]) => void) | null = null;
  private eventHandler: IRtcEngineEventHandler | null = null;

  async join(input: { sessionId: UUID; role: 'host' | 'cohost' | 'viewer'; token: string; channel: string; uid: number }) {
    const appId = process.env.EXPO_PUBLIC_AGORA_APP_ID;
    if (!appId) throw new Error('Add EXPO_PUBLIC_AGORA_APP_ID before starting a live room.');
    if (Platform.OS === 'android' && input.role !== 'viewer') {
      const permissions = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      if (Object.values(permissions).some((permission) => permission !== PermissionsAndroid.RESULTS.GRANTED)) {
        throw new Error('Allow camera and microphone access in Settings to host or co-host a live room.');
      }
    }
    const engine = createAgoraRtcEngine();
    this.engine = engine;
    try {
      this.joinContext = { sessionId: input.sessionId, role: input.role };
      assertAgoraSuccess(engine.initialize({ appId, channelProfile: ChannelProfileType.ChannelProfileLiveBroadcasting }), 'initialize the live engine');
      assertAgoraSuccess(engine.enableVideo(), 'enable live video');
      assertAgoraSuccess(engine.enableAudio(), 'enable live audio');
      this.eventHandler = {
        onUserJoined: (_connection: unknown, uid: number) => { this.remoteUsers.add(uid); this.remoteUsersListener?.([...this.remoteUsers]); },
        onUserOffline: (_connection: unknown, uid: number) => { this.remoteUsers.delete(uid); this.remoteUsersListener?.([...this.remoteUsers]); },
        onTokenPrivilegeWillExpire: () => { void this.renewToken(); },
        onRequestToken: () => { void this.renewToken(); },
        onConnectionStateChanged: (_connection, state) => {
          if (state === ConnectionStateType.ConnectionStateFailed) {
            this.onError?.(new Error('The live connection was lost. Check your internet connection and rejoin.'));
          }
        },
      };
      const eventHandler = this.eventHandler;
      assertAgoraSuccess(engine.setClientRole(input.role === 'viewer' ? ClientRoleType.ClientRoleAudience : ClientRoleType.ClientRoleBroadcaster), 'set the live role');
      if (input.role !== 'viewer') assertAgoraSuccess(await engine.startPreview(), 'start the camera preview');
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          error ? reject(error) : resolve();
        };
        const finishJoin = () => finish();
        const failJoin = (error: Error) => finish(error);
        const timeout = setTimeout(() => failJoin(new Error('Timed out while connecting to the live room. Check your connection and try again.')), 15000);
        eventHandler.onJoinChannelSuccess = finishJoin;
        eventHandler.onError = (code: number) => failJoin(new Error(`Agora could not join the live room (error ${code}).`));
        engine.registerEventHandler(eventHandler);
        this.joining = true;
        try {
          const result = engine.joinChannel(input.token, input.channel, input.uid, { clientRoleType: input.role === 'viewer' ? ClientRoleType.ClientRoleAudience : ClientRoleType.ClientRoleBroadcaster, publishCameraTrack: input.role !== 'viewer', publishMicrophoneTrack: input.role !== 'viewer', autoSubscribeAudio: true, autoSubscribeVideo: true });
          assertAgoraSuccess(result, 'join the live room');
        } catch (error) { failJoin(error instanceof Error ? error : new Error('Agora could not join the live room.')); }
      });
      this.joined = true;
      this.joining = false;
    } catch (error) {
      try { await this.leave(); } catch { /* Preserve the join failure shown to the user. */ }
      throw error;
    }
  }

  async leave() {
    if (!this.engine) return;
    const engine = this.engine;
    try {
      if (this.joined || this.joining) assertAgoraSuccess(await engine.leaveChannel(), 'leave the live room');
    } finally {
      if (this.eventHandler) engine.unregisterEventHandler(this.eventHandler);
      engine.release();
      this.engine = null;
      this.joined = false;
      this.joining = false;
      this.joinContext = null;
      this.tokenRefresh = null;
      this.eventHandler = null;
      this.remoteUsers.clear();
      this.remoteUsersListener?.([]);
    }
  }

  async setMicrophoneEnabled(enabled: boolean) {
    if (this.engine) assertAgoraSuccess(this.engine.enableLocalAudio(enabled), enabled ? 'enable the microphone' : 'mute the microphone');
  }
  async setCameraEnabled(enabled: boolean) {
    if (this.engine) assertAgoraSuccess(this.engine.enableLocalVideo(enabled), enabled ? 'enable the camera' : 'turn off the camera');
  }
  async switchCamera() {
    if (!this.engine || !this.joined) throw new Error('Join the live room before switching cameras.');
    assertAgoraSuccess(this.engine.switchCamera(), 'switch cameras');
  }

  private async renewToken() {
    if (this.tokenRefresh) return this.tokenRefresh;
    const engine = this.engine;
    const context = this.joinContext;
    if (!engine || !context || (!this.joined && !this.joining)) return;
    this.tokenRefresh = (async () => {
      try {
        const credentials = await this.refreshCredentials(context.sessionId, context.role);
        if (this.engine !== engine || this.joinContext !== context) return;
        assertAgoraSuccess(engine.renewToken(credentials.token), 'renew the live connection');
      } catch (error) {
        if (this.engine === engine) this.onError?.(error instanceof Error ? error : new Error('Could not renew the live connection.'));
      } finally {
        this.tokenRefresh = null;
      }
    })();
    return this.tokenRefresh;
  }
  onRemoteUsersChanged(listener: (uids: number[]) => void) {
    this.remoteUsersListener = listener;
    listener([...this.remoteUsers]);
    return () => { if (this.remoteUsersListener === listener) this.remoteUsersListener = null; };
  }
}

function assertAgoraSuccess(result: number, action: string) {
  if (result < 0) throw new Error(`Agora could not ${action} (error ${result}).`);
}

export function AgoraVideoTile({ uid, local = false, style }: { uid: number; local?: boolean; style: object }) {
  return <RtcSurfaceView style={style} canvas={{ uid, sourceType: local ? VideoSourceType.VideoSourceCamera : VideoSourceType.VideoSourceRemote }} />;
}

export function AgoraAvailabilityNote() {
  const configured = Boolean(process.env.EXPO_PUBLIC_AGORA_APP_ID);
  return configured ? null : null;
}

export function useAppFocusForAgora(active: boolean, adapter: StreamingAdapter | null) {
  useEffect(() => () => { if (active) void adapter?.leave(); }, [active, adapter]);
}

export const streamProvider = new AgoraProvider();
