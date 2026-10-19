import { expect, test } from '@playwright/test';

/**
 * Visual regression.
 *
 * The baseline captures the initial composition at three viewports. The seed is
 * fixed so the *layout* is deterministic; the image content comes from the
 * public CDN, which is why the tolerated difference is generous.
 */
const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
  { name: 'mobile-390x844', width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  test(`initial composition at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?seed=424242');
    await page.waitForTimeout(9000);

    await expect(page.locator('.spatial-card').first()).toBeVisible();
    await expect(await page.screenshot({ animations: 'disabled' })).toMatchSnapshot(`${viewport.name}.png`, {
      maxDiffPixelRatio: 0.22,
    });
  });
}

test('the zoomed-out mosaic stays dense', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?seed=424242');
  await page.waitForTimeout(8000);

  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('-');
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(3000);

  const cards = await page.evaluate(() => {
    const rects = Array.from(document.querySelectorAll('.spatial-card')).map((el) => el.getBoundingClientRect());
    const visible = rects.filter((r) => r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight);
    return { total: rects.length, visible: visible.length };
  });
  // The mosaic must not collapse into a few slivers.
  expect(cards.visible).toBeGreaterThan(40);

  await expect(await page.screenshot({ animations: 'disabled' })).toMatchSnapshot('desktop-1440x900-zoomed-out.png', {
    maxDiffPixelRatio: 0.22,
  });
});
