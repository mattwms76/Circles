import { test, expect } from '@playwright/test';

test('Conversation tools expose the search and mute controls without clipping', async ({
  page,
}) => {
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  await page.locator('[data-action="openChat"]').first().click();
  await page.getByLabel('Conversation options', { exact: true }).click();
  const geometry = await page.locator('.conversationToolsBody').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const field = el.querySelector('input')!.getBoundingClientRect();
    const mute = el.querySelector('button')!.getBoundingClientRect();
    return {
      height: r.height,
      top: r.top,
      bottom: r.bottom,
      fieldTop: field.top,
      muteBottom: mute.bottom,
    };
  });
  expect(geometry.height).toBeGreaterThan(140);
  expect(geometry.fieldTop).toBeGreaterThanOrEqual(geometry.top);
  expect(geometry.muteBottom).toBeLessThanOrEqual(geometry.bottom + 1);
});

test('Enlarged Home controls wrap as complete controls, not word fragments', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#previewTextSize').selectOption('large');
  const tabs = await page.locator('.feedSegments button').evaluateAll((nodes) =>
    nodes.map((el) => ({
      height: el.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(el).lineHeight),
      width: el.getBoundingClientRect().width,
    })),
  );
  tabs.forEach((tab) => {
    expect(tab.height).toBeLessThanOrEqual(tab.line * 2 + 24);
    expect(tab.width).toBeGreaterThan(80);
  });
});

test('Selected Inbox filters have a visibly different state in each palette', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#previewTheme').selectOption(theme);
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    const states = await page.locator('.inboxToolbar [aria-pressed]').evaluateAll((nodes) =>
      nodes.map((el) => {
        const s = getComputedStyle(el);
        return {
          selected: el.getAttribute('aria-pressed'),
          appearance: [s.backgroundColor, s.color, s.borderColor].join('|'),
        };
      }),
    );
    expect(states[0].selected).toBe('true');
    expect(states[0].appearance).not.toBe(states[1].appearance);
  }
});
