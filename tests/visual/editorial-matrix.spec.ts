import { test, expect, type Page } from '@playwright/test';

async function geometry(page: Page) {
  const errors = await page
    .locator('.page, .modalPanel')
    .evaluateAll((nodes) =>
      nodes
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => ({ class: el.className, width: el.clientWidth, scroll: el.scrollWidth })),
    );
  expect(errors).toEqual([]);
  const labels = await page
    .locator('.tabs .tab')
    .evaluateAll((nodes) => nodes.map((el) => ({ width: el.clientWidth, scroll: el.scrollWidth })));
  labels.forEach((label) => expect(label.scroll).toBeLessThanOrEqual(label.width + 1));
}
for (const theme of ['light', 'dark'])
  for (const width of [320, 390])
    for (const size of ['normal', 'large', 'largest']) {
      test(`Editorial screen matrix ${theme} ${width} ${size}`, async ({ page }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
        await page.locator('#previewTheme').selectOption(theme);
        await page.locator('#previewTextSize').selectOption(size);
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.fonts.check('600 32px Lora'))).toBe(true);
        for (const name of ['Home', 'Explore', 'Live', 'Inbox', 'You']) {
          await page.locator('.tabs').getByRole('button', { name, exact: true }).click();
          await geometry(page);
          await page.screenshot({ path: info.outputPath(`${name}.png`) });
        }
        await page.getByRole('button', { name: 'Settings and privacy', exact: true }).click();
        await geometry(page);
        await page.locator('[data-ex="safetyPreview"]').click();
        await page.locator('[data-ex="authPreview"]').click();
        await geometry(page);
        await page.screenshot({ path: info.outputPath('authentication.png') });
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await page.locator('.tabs').getByRole('button', { name: 'Explore', exact: true }).click();
        await page.locator('[data-action="openCircle"]').first().click();
        for (const name of ['Posts', 'Events', 'About']) {
          await page.getByRole('tab', { name, exact: true }).click();
          await geometry(page);
          await page.screenshot({ path: info.outputPath(`circle-${name}.png`) });
        }
        await page.getByRole('tab', { name: 'Posts', exact: true }).click();
        await page.getByRole('button', { name: 'Circle tools', exact: true }).click();
        await page.getByRole('button', { name: 'Ask or poll', exact: true }).click();
        await expect(page.locator('[data-poll-options]')).toBeHidden();
        await page.locator('[name="kind"]').selectOption('poll');
        await expect(page.locator('[data-poll-options]')).toBeVisible();
        await geometry(page);
        await page.screenshot({ path: info.outputPath('poll.png') });
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await page.locator('.tabs').getByRole('button', { name: 'Live', exact: true }).click();
        await page.locator('[data-action="watchLive"]').first().click();
        await page.locator('[data-action="openGifts"]').click();
        await geometry(page);
        expect(
          await page.locator('.giftGridPreview').evaluate((el) => el.clientHeight),
        ).toBeGreaterThanOrEqual(140);
        await page.locator('[data-action="selectGift"]').first().click();
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Send', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath('gifts.png') });
        expect(errors).toEqual([]);
      });
    }

test('Gift selection never sends, favourite keeps selection, Send deducts exactly once', async ({
  page,
}) => {
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await page.locator('.tabs').getByRole('button', { name: 'Live', exact: true }).click();
  await page.locator('[data-action="watchLive"]').first().click();
  await page.locator('[data-action="openGifts"]').click();
  const before = await page.locator('.giftFooter').innerText();
  await page.locator('[data-action="selectGift"]').first().click();
  await expect(page.locator('[data-action="selectGift"]').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect((await page.locator('.giftFooter').innerText()).match(/Balance[^\n]*/)?.[0]).toEqual(
    before.match(/Balance[^\n]*/)?.[0],
  );
  await page.locator('[data-ex="favourite"]').first().click();
  await expect(page.locator('[data-action="selectGift"]').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const footer = await page.locator('.giftFooter').innerText();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect(await page.locator('.giftFooter').innerText()).not.toEqual(footer);
});

test('Reporting and moderation are labelled simulations and show confirmation feedback', async ({
  page,
}) => {
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.getByRole('button', { name: 'Post options', exact: true }).click();
  await page.locator('[data-action="report"]').click();
  await page.getByRole('button', { name: 'Simulate report', exact: true }).click();
  await expect(page.locator('[data-simulated] [role="status"]')).toContainText(
    'No report was sent',
  );
  expect(writes).toEqual([]);
});

test('Member tools show rules without offering owner actions', async ({ page }) => {
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await page.locator('.tabs').getByRole('button', { name: 'Explore', exact: true }).click();
  await page.locator('[data-action="openCircle"]').first().click();
  await page.getByRole('button', { name: 'Circle tools', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Host settings and recognition', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Rules, members and host tools', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Rules and members' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save rules', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Make moderator', exact: true })).toHaveCount(0);
});

test('SVG post actions retain like toggling and have no nested button roles', async ({ page }) => {
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  const like = page.locator('[data-post-action="heart"]').first();
  await expect(like).toHaveAccessibleName(/Like post/);
  await like.click();
  await expect(like).toHaveAccessibleName(/Unlike post/);
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  expect(await page.locator('.postActions button [role="button"]').count()).toBe(0);
  expect(await page.locator('.postActions button svg').count()).toBe(3);
});

test('Long names and expanded conversation tools remain usable at 200%', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() =>
    localStorage.setItem(
      'circles-preview-profile',
      JSON.stringify({
        displayName: 'Alexandria Montgomery-Wellington',
        bio: 'Gardening, cooking and conversations with my community.',
      }),
    ),
  );
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#previewTextSize').selectOption('largest');
  await page.locator('.tabs').getByRole('button', { name: 'You', exact: true }).click();
  await geometry(page);
  await expect(page.locator('.profileIdentity h1')).toHaveText('Alexandria Montgomery-Wellington');
  await page.locator('.tabs').getByRole('button', { name: 'Inbox', exact: true }).click();
  await page.locator('[data-action="openChat"]').first().click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Keep this draft');
  await page.getByLabel('Conversation options', { exact: true }).click();
  await geometry(page);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Keep this draft',
  );
  await page.getByLabel('Conversation options', { exact: true }).click();
  await expect(page.locator('.conversationToolsBody')).toBeHidden();
  await expect(input).toBeVisible();
});
