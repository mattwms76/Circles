export type CurrentAuthOperation = {
  isCurrent: () => boolean;
};

/**
 * Allows a route to defer navigation until an authentication confirmation has
 * settled, while sharing the exact form operation fence that Close invalidates.
 */
export async function completeCurrentAuthOperation(
  operation: CurrentAuthOperation,
  confirm: () => Promise<boolean>,
  onConfirmedCurrent: () => void,
): Promise<boolean> {
  const confirmed = await confirm();
  if (!confirmed || !operation.isCurrent()) return false;
  onConfirmedCurrent();
  return true;
}
