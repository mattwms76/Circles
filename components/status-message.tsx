import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { C, T } from "@/components/circles-ui";
import {
  createStatusAnnouncementDedupe,
  normalizeStatusMessage,
  statusAccessibilityProps,
  type StatusTone,
} from "../lib/status-announcement";

export type StatusMessageProps = {
  message: string | null | undefined;
  tone?: StatusTone;
  /** Keeps visible status copy without registering another platform announcement. */
  announce?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
};

/**
 * A nonblocking outcome message. Web and Android receive one live-region
 * update; iOS receives one guarded native announcement for each meaningful
 * change. It never moves accessibility focus.
 */
export function StatusMessage({
  message,
  tone = "info",
  announce = true,
  style,
  testID,
}: StatusMessageProps) {
  const [announcer] = useState(createStatusAnnouncementDedupe);

  const normalizedMessage = normalizeStatusMessage(message);
  const platform = Platform.OS;

  useEffect(() => {
    if (!announce) return;
    void announcer.announce({
      platform,
      message: normalizedMessage,
      tone,
      announcer:
        platform === "ios"
          ? {
              announceForAccessibility:
                AccessibilityInfo?.announceForAccessibility,
              announceForAccessibilityWithOptions:
                AccessibilityInfo?.announceForAccessibilityWithOptions,
            }
          : undefined,
    });
  }, [announce, announcer, normalizedMessage, platform, tone]);

  if (!normalizedMessage) return null;

  return (
    <T
      {...(announce ? statusAccessibilityProps(tone, platform) : {})}
      testID={testID}
      style={[style, { color: tone === "error" ? C.action : C.secondary }]}
    >
      {normalizedMessage}
    </T>
  );
}
