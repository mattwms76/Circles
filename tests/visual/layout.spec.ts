import { test, expect } from '@playwright/test';

test('Home shows the first post text without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  const bounds = await page.evaluate(() => ({
    body: document.querySelector('.post .body')!.getBoundingClientRect().top,
    nav: document.querySelector('.tabs')!.getBoundingClientRect().top,
  }));
  expect(bounds.body + 24).toBeLessThan(bounds.nav);
  await page.getByRole('button', { name: /Timeline options/ }).click();
  await expect(page.getByRole('button', { name: 'Catch up', exact: true })).toBeVisible();
});

test('Settings labels stay within their controls at narrow widths and enlarged text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Settings and privacy', exact: true }).click();
  await page.locator('#previewTextSize').selectOption('largest');
  const widths = await page
    .locator('.settingsRows button')
    .evaluateAll((nodes) =>
      nodes.map((el) => ({ client: el.clientWidth, scroll: el.scrollWidth })),
    );
  expect(widths.length).toBeGreaterThan(2);
  widths.forEach((width) => expect(width.scroll).toBeLessThanOrEqual(width.client + 1));
});

test('Circle tools stay available without repeating every destination above posts', async ({
  page,
}) => {
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.locator('[data-action="openCircle"]').first().click();
  await expect(page.getByRole('button', { name: 'Circle library', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Circle tools', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Circle library', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Circle chat', exact: true })).toBeVisible();
});

test('Message actions and attachment selection preserve the draft and reply context', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  await page.locator('[data-action="openChat"]').first().click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Keep this unsent draft');
  await page
    .getByRole('button', { name: /^Message options:/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(input).toHaveValue('Keep this unsent draft');
  await expect(page.getByRole('button', { name: 'Cancel reply', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Photo or voice note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Attachments', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(input).toHaveValue('Keep this unsent draft');
  await expect(page.getByRole('button', { name: 'Cancel reply', exact: true })).toBeVisible();
});
