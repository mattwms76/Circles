import { platformCreationIssue } from "./platform-feature-ui";
import type { PlatformStatus } from "../shared/platform-settings";

export type A26LiveCreationAvailability = Readonly<{
  kind: "available" | "checking" | "error" | "unavailable";
  message: string | null;
}>;

export function resolveA26LiveCreationAvailability({
  isLoading,
  isError,
  status,
}: {
  isLoading: boolean;
  isError: boolean;
  status: PlatformStatus | undefined;
}): A26LiveCreationAvailability {
  if (isError) {
    return {
      kind: "error",
      message: "We couldn’t check live creation availability. Try again.",
    };
  }

  if (!status || isLoading) {
    return {
      kind: "checking",
      message: "Checking creation availability. Please try again shortly.",
    };
  }

  const issue = platformCreationIssue(status, "live");
  return issue
    ? { kind: "unavailable", message: issue }
    : { kind: "available", message: null };
}
