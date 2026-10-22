export type Fnd001QueryDisplayState = "loading" | "error" | "empty" | "content";

type Fnd001QueryDisplayInput = {
  isLoading: boolean;
  isError: boolean;
  hasContent: boolean;
};

/**
 * Keeps failed queries out of successful empty or ended UI states.
 *
 * React Query does not report loading and error together, but loading remains
 * first so an in-flight query keeps its existing progress UI.
 */
export function resolveFnd001QueryDisplayState({
  isLoading,
  isError,
  hasContent,
}: Fnd001QueryDisplayInput): Fnd001QueryDisplayState {
  if (isLoading) {
    return "loading";
  }

  if (isError) {
    return "error";
  }

  return hasContent ? "content" : "empty";
}
