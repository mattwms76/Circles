import { test, expect, type Page, type TestInfo } from '@playwright/test';

async function capture(page: Page, info: TestInfo, name: string) {
  const overflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.page,.modalPanel')).map((el) => ({
      width: el.clientWidth,
      scroll: el.scrollWidth,
    })),
  );
  overflow.forEach((size) => expect(size.scroll).toBeLessThanOrEqual(size.width + 1));
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
}
async function tab(page: Page, name: string) {
  await page.locator('.tabs').getByRole('button', { name, exact: true }).click();
}
async function close(page: Page) {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}
for (const theme of ['light', 'dark'])
  for (const width of [320, 390]) {
    test(`Main screens and dialogs: ${theme}, ${width}px`, async ({ page }, info) => {
      test.setTimeout(90000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/preview.html');
      await page.locator('#previewTheme').selectOption(theme);
      await expect(page.locator('.storyTray')).toBeVisible();
      for (const name of ['Home', 'Explore', 'Live', 'Inbox', 'You']) {
        await tab(page, name);
        await capture(page, info, name.toLowerCase());
      }
      await expect(page.locator('.communityDetails[open]')).toHaveCount(0);
      await page.locator('.communityDetails summary').first().click();
      await capture(page, info, 'profile-community');
      await page.locator('[data-action="editProfile"]').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await capture(page, info, 'edit-profile');
      await close(page);
      await page.locator('[data-action="buyCoins"]').click();
      await capture(page, info, 'wallet');
      await close(page);
      await page.locator('[data-ex="activity"]').click();
      await capture(page, info, 'activity');
      await close(page);
      await page.locator('.profileToolbar summary').filter({hasText:/^Settings$/}).click();
      await page.locator('[data-ex="preferences"]').click();
      await capture(page, info, 'preferences');
      await close(page);
      await page.locator('[data-ex="onboarding"]').click();
      await capture(page, info, 'onboarding');
      await close(page);
      await tab(page, 'Inbox');
      await page.locator('[data-action="openChat"]').first().click();
      await page
        .getByRole('textbox', { name: 'Message', exact: true })
        .fill('A draft\nwith a second line');
      await capture(page, info, 'conversation');
      await page.getByLabel('Conversation options', { exact: true }).click();
      await capture(page, info, 'conversation-tools');
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
        'A draft\nwith a second line',
      );
      await close(page);
      await tab(page, 'Explore');
      await page.locator('[data-action="createCircle"]').click();
      await capture(page, info, 'create-circle');
      await close(page);
      await page.locator('[data-action="openCircle"]').first().click();
      for (const name of ['Posts', 'Events', 'About']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await capture(page, info, `circle-${name.toLowerCase()}`);
      }
      await tab(page, 'Live');
      await page.locator('[data-ex="scheduleRoom"]').click();
      await capture(page, info, 'schedule-room');
      await close(page);
      await tab(page, 'Home');
      await page.locator('[data-story="create"]').click();
      await capture(page, info, 'create-story');
      await expect(page.locator('#storyPublish')).toBeDisabled();
      await close(page);
      await page.getByRole('button', { name: 'Share a thought', exact: true }).click();
      await capture(page, info, 'post-composer');
      await close(page);
      expect(errors).toEqual([]);
    });
  }

test('Large text, empty search and composing preserve usable controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/preview.html');
  // Exercise text growth independently of OS settings; native dynamic type remains a device check.
  await page.addStyleTag({
    content:
      '.device p,.device label,.device button,.device summary,.device input,.device textarea { font-size: 22px !important; line-height: 1.4 !important }',
  });
  await tab(page, 'Explore');
  await page.locator('#circleSearch').fill('no-such-circle-938421');
  await expect(page.locator('#circleCount')).toHaveText('0 circles to explore');
  await capture(page, info, 'large-text-empty-search');
  await tab(page, 'Inbox');
  await page.locator('[data-action="openChat"]').first().click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('   ');
  await capture(page, info, 'large-text-composer');
  await expect(input).toHaveValue('   ');
});

test('Story viewer keeps compact controls and expiry removes the story', async ({ page }, info) => {
  await page.clock.install();
  await page.goto('/preview.html');
  await page.locator('[data-story="create"]').click();
  await page.locator('#storyFile').setInputFiles('tests/fixtures/story.png');
  await page.locator('#storyPublish').click();
  await page.locator('[data-story="view"]').first().click();
  await page.getByRole('button', { name: 'Pause story', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete story', exact: true })).not.toBeVisible();
  await capture(page, info, 'story-viewer');
  await page.getByLabel('Story options', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete story', exact: true })).toBeVisible();
  await close(page);
  await page.clock.fastForward('24:00:01');
  await expect(page.locator('[data-story="view"]')).toHaveCount(0);
});
