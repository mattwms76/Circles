import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadSource, native } from './react-fixture.mjs';

const palette = JSON.parse(readFileSync('src/design-tokens.json', 'utf8'));
const metrics = JSON.parse(readFileSync('src/design-metrics.json', 'utf8'));
const luminance = (hex) => {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test('Editorial text and essential input boundaries meet contrast targets in both palettes', () => {
  for (const [mode, colors] of Object.entries(palette)) {
    for (const background of ['paper', 'surface']) {
      for (const foreground of ['ink', 'muted', 'coral', 'error', 'success'])
        assert.ok(
          contrast(colors[foreground], colors[background]) >= 4.5,
          `${mode} ${foreground}/${background}`,
        );
      for (const foreground of ['controlBorder', 'focus'])
        assert.ok(
          contrast(colors[foreground], colors[background]) >= 3,
          `${mode} ${foreground}/${background}`,
        );
    }
    assert.ok(contrast(colors.coral, colors.selected) >= 4.5);
    assert.ok(contrast(colors.onPrimary, colors.primary) >= 4.5);
    assert.notEqual(colors.line, colors.controlBorder);
  }
});

test('Lora is a locally bundled TrueType font with its OFL licence and a system fallback', () => {
  const font = readFileSync('assets/fonts/Lora-SemiBold.ttf');
  assert.equal(font.readUInt32BE(0), 0x00010000);
  assert.ok(font.length > 30000);
  assert.match(readFileSync('assets/fonts/OFL-Lora.txt', 'utf8'), /SIL OPEN FONT LICENSE/);
  const theme = loadSource('src/theme.ts', { 'react-native': native });
  theme.configureEditorialFont(true);
  assert.equal(theme.typography.title.fontFamily, 'Lora-SemiBold');
  assert.equal(theme.typography.section.fontFamily, 'Lora-SemiBold');
  assert.equal(theme.typography.body.fontFamily, undefined);
  assert.equal(theme.typography.dialog.fontFamily, undefined);
  theme.configureEditorialFont(false);
  assert.equal(theme.typography.title.fontFamily, undefined);
  assert.equal(metrics.typography.title.fontSize, 32);
  assert.equal(metrics.typography.member.lineHeight, 24);
});

test('Responsive native groups react to viewport width and actual font scale', () => {
  for (const [width, fontScale, compact] of [
    [320, 1, true],
    [390, 1, false],
    [390, 1.4, true],
    [390, 2, true],
  ]) {
    const { useCompactLayout } = loadSource('src/components/Design.tsx', {
      'react-native': { ...native, useWindowDimensions: () => ({ width, height: 844, fontScale }) },
      '../theme': { colors: {}, typography: {}, radii: {} },
    });
    assert.equal(useCompactLayout().compact, compact);
    assert.equal(useCompactLayout().largeText, fontScale > 1.2);
  }
});
