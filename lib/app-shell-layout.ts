export type ShellInsets = {
  top: number;
  left: number;
  right: number;
};

function nonnegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function appShellLayout(windowWidth: number, insets: ShellInsets) {
  const width = nonnegativeFinite(windowWidth);
  const top = nonnegativeFinite(insets.top);
  const left = nonnegativeFinite(insets.left);
  const right = nonnegativeFinite(insets.right);
  const availableWidth = Math.max(0, width - left - right);
  const wide = availableWidth >= 900;
  const gutter = wide ? 30 : availableWidth <= 360 ? 16 : 20;

  return {
    availableWidth,
    wide,
    gutter,
    headerGutter: wide ? 32 : gutter,
    showSidebar: wide && availableWidth > 1130,
    framePadding: {
      paddingTop: top,
      paddingLeft: left,
      paddingRight: right,
    },
  };
}
