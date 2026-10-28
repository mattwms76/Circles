export type D28008AuthPresentation =
  | "checking"
  | "error"
  | "guest"
  | "authenticated";

/**
 * Keeps unresolved auth distinct from a settled guest presentation. Consumers
 * still own their route-specific copy and protected-content boundary.
 */
export function resolveD28008AuthPresentation(
  authState: string | null | undefined,
  hasUser: boolean,
): D28008AuthPresentation {
  if (authState === "checking") return "checking";
  if (authState === "error") return "error";
  return hasUser ? "authenticated" : "guest";
}
