import { test, expect } from '@playwright/test';
for (const mode of ['light', 'dark'])
  test(`Explore layout and contrast stay usable in ${mode}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#previewTheme').selectOption(mode);
    await page.getByRole('button', { name: 'Explore', exact: true }).click();
    await expect(page.locator('.discoveryDetails')).not.toHaveAttribute('open', '');
    const geometry = await page.evaluate(() => {
      const chip = document.querySelector('.demoFilters .demoChip.on')!,
        card = document.querySelector('.demoCircle')!,
        nav = document.querySelector('.tabs')!;
      const luminance = (rgb: string) => {
        const values = rgb
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((v) => Number(v) / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const a = luminance(getComputedStyle(chip).color),
        b = luminance(getComputedStyle(chip).backgroundColor);
      return {
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        cardTop: card.getBoundingClientRect().top,
        navTop: nav.getBoundingClientRect().top,
        scrollWidth: document.documentElement.scrollWidth,
        width: innerWidth,
      };
    });
    expect(geometry.contrast).toBeGreaterThanOrEqual(4.5);
    expect(geometry.cardTop + 100).toBeLessThan(geometry.navTop);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    await page.screenshot({ path: info.outputPath(`explore-${mode}.png`) });
    await page.locator('.discoveryDetails button').click();
    await page.locator('#exPrivacy').selectOption('private');
    await expect(page.locator('.discoveryDetails button')).toHaveText('Filters · 1 active');
    await expect(page.locator('#circleCount')).toHaveText('1 circles to explore');
    expect(errors).toEqual([]);
  });
test('Post saving and author editing stay functional', async ({ page }) => {
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Post options', exact: true }).click();
  await page.getByRole('button', { name: 'Save post', exact: true }).click();
  await page.getByRole('button', { name: 'Saved posts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove saved post', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Share a thought', exact: true }).click();
  await page.getByRole('textbox', { name: 'Post text', exact: true }).fill('Visual test post');
  await page.getByRole('button', { name: 'Share with your circle', exact: true }).click();
  await page
    .locator('.post')
    .filter({ hasText: 'Visual test post' })
    .getByRole('button', { name: 'Post options' })
    .click();
  await page
    .getByRole('textbox', { name: 'Edit post text', exact: true })
    .fill('Updated test post');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.post .body').filter({ hasText: 'Updated test post' })).toBeVisible();
});
