export type D28LiveLeaveDialogOpenInput = {
  isCurrentHost: boolean;
  dismissKeyboard: () => void;
  openConfirmation: () => void;
};

/**
 * Opens only the current host's leave confirmation after the existing chat IME
 * has been dismissed. The end mutation retains its independent lease and
 * server-side authorization checks.
 */
export function openD28LiveLeaveDialog({
  isCurrentHost,
  dismissKeyboard,
  openConfirmation,
}: D28LiveLeaveDialogOpenInput): boolean {
  if (!isCurrentHost) return false;

  dismissKeyboard();
  openConfirmation();
  return true;
}
