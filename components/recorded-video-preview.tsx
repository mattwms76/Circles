import { useCallback, useEffect } from "react";
import { AppState, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { Button, C, T } from "@/components/circles-ui";
import { StatusMessage } from "@/components/status-message";

export type RecordedVideoPreviewProps = {
  uri: string;
  disabled?: boolean;
  onRetake?: () => void;
  onUse?: () => void;
};

/** Local-only playback: never upload, cache a remote URL, or encode the draft. */
export function RecordedVideoPreview({
  uri,
  disabled = false,
  onRetake,
  onUse,
}: RecordedVideoPreviewProps) {
  const player = useVideoPlayer({ uri, useCaching: false }, (video) => {
    video.loop = false;
    video.staysActiveInBackground = false;
  });
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const ready = status === "readyToPlay";

  useEffect(() => {
    if (disabled) player.pause();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") player.pause();
    });
    return () => subscription.remove();
  }, [disabled, player]);
  useFocusEffect(useCallback(() => () => player.pause(), [player]));

  return (
    <View style={{ gap: 12 }} testID="recorded-video-preview">
      <VideoView
        player={player}
        nativeControls={!disabled}
        contentFit="contain"
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
        startsPictureInPictureAutomatically={false}
        playsInline
        accessibilityLabel="Local video preview"
        style={{
          width: "100%",
          height: 260,
          backgroundColor: C.ink,
          borderRadius: 14,
        }}
      />
      {status === "error" ? (
        <StatusMessage
          message="This video could not play. Retake it or choose another MP4 video."
          tone="error"
        />
      ) : !ready ? (
        <T style={{ color: C.secondary }}>Preparing local playback…</T>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Button
          title={isPlaying ? "Pause video" : "Play video"}
          secondary
          disabled={disabled || !ready}
          onPress={() => (isPlaying ? player.pause() : player.play())}
        />
        <Button
          title="Replay video"
          secondary
          disabled={disabled || !ready}
          onPress={() => player.replay()}
        />
        {onRetake && (
          <Button
            title="Retake"
            secondary
            disabled={disabled}
            onPress={() => {
              player.pause();
              onRetake();
            }}
          />
        )}
        {onUse && (
          <Button
            title="Use video"
            disabled={disabled || !ready}
            onPress={() => {
              player.pause();
              onUse();
            }}
          />
        )}
      </View>
      <T style={{ color: C.secondary, fontSize: 12 }}>
        Use the playback controls to seek. Your recording stays on this device
        until you publish.
      </T>
    </View>
  );
}
