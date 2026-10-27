import { View } from "react-native";
import { Button, C, Icon, T } from "@/components/circles-ui";
import type { RecordedVideoDraft } from "@/shared/recorded-video";

export type VideoRecorderProps = {
  maxBytes: number;
  onUse: (draft: RecordedVideoDraft) => void;
  onClose: () => void;
};

/**
 * Expo Camera does not record video on web. The composer keeps its existing
 * library-upload path there instead of suggesting a browser capture that this
 * MP4-only release cannot truthfully support.
 */
export function VideoRecorder({ onClose }: VideoRecorderProps) {
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: C.paper,
        borderColor: C.border,
        borderRadius: 18,
        borderWidth: 1,
        gap: 12,
        padding: 24,
      }}
    >
      <View
        accessible={false}
        style={{
          alignItems: "center",
          backgroundColor: C.sage,
          borderRadius: 28,
          height: 56,
          justifyContent: "center",
          width: 56,
        }}
      >
        <Icon name="cloud-upload-outline" color={C.action} size={28} />
      </View>
      <T style={{ fontSize: 19, fontWeight: "800", textAlign: "center" }}>
        Upload an existing video
      </T>
      <T
        style={{
          color: C.secondary,
          lineHeight: 20,
          maxWidth: 390,
          textAlign: "center",
        }}
      >
        In-app recording is available on iOS and Android. On the web, use Add a
        photo or video in the post composer to choose an existing MP4.
      </T>
      <Button title="Back to post" secondary onPress={onClose} />
    </View>
  );
}

export default VideoRecorder;
