import { expect, test } from '@playwright/test';

/**
 * Functional smoke tests for the atlas: rendering, chrome, interaction and the
 * error states.
 */

const SETTLE = 6000;
const SEARCH_INPUT = '.search-box input[type="text"]';

test.beforeEach(async ({ page }) => {
  page.on('console', (message) => {
    if (message.type() === 'error') console.warn(`[console.error] ${message.text()}`);
  });
});

test('renders the glass mosaic with WebGL2', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?seed=42');
  await page.waitForTimeout(SETTLE);

  const host = page.locator('.atlas-host');
  await expect(host).toHaveAttribute('data-renderer', 'webgl2-instanced');
  await expect(page.locator('.spatial-card').first()).toBeVisible();

  // The canvas must have a real drawing buffer.
  const size = await page.evaluate(() => {
    const canvas = document.querySelector('.field-canvas') as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
  expect(size.width).toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('shows the compact brand and the floating omnibox', async ({ page }) => {
  await page.goto('/?seed=42');
  await page.waitForTimeout(2000);

  await expect(page.locator('.brand')).toContainText('Embed Anything');
  await expect(page.locator('.brand-subtitle')).toHaveText('w/ EmbeddingGemma 2');

  const box = await page.locator('.search-box').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(560);
  expect(box!.height).toBeGreaterThanOrEqual(54);
  expect(box!.height).toBeLessThanOrEqual(60);
  await expect(page.locator(SEARCH_INPUT)).toHaveAttribute('placeholder', 'Search anything…');
  // The five controls of the omnibox.
  await expect(page.locator('.search-box button')).toHaveCount(4);
  await expect(page.locator('.search-box input[type="file"]')).toHaveCount(1);
});

test('focuses the search field with / and with Cmd/Ctrl+K', async ({ page }) => {
  await page.goto('/?seed=42');
  await page.waitForTimeout(2000);

  await page.keyboard.press('/');
  await expect(page.locator(SEARCH_INPUT)).toBeFocused();

  await page.locator(SEARCH_INPUT).blur();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator(SEARCH_INPUT)).toBeFocused();
});

test('zooms with the keyboard and resets with 0', async ({ page }) => {
  await page.goto('/?seed=42');
  await page.waitForTimeout(SETTLE);

  const zoom = () => page.evaluate(() => window.__atlas?.cameraState.current.zoom ?? 0);
  const before = await zoom();
  await page.keyboard.press('=');
  await page.waitForTimeout(800);
  expect(await zoom()).toBeGreaterThan(before);

  await page.keyboard.press('0');
  await page.waitForTimeout(1200);
  expect(await zoom()).toBeCloseTo(before, 2);
});

test('pans with a drag and keeps the cards on screen', async ({ page }) => {
  await page.goto('/?seed=42');
  await page.waitForTimeout(SETTLE);

  const before = await page.evaluate(() => window.__atlas?.cameraState.current.x ?? 0);
  await page.mouse.move(900, 500);
  await page.mouse.down();
  await page.mouse.move(500, 500, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => window.__atlas?.cameraState.current.x ?? 0);
  expect(after).not.toBeCloseTo(before, 0);
  await expect(page.locator('.spatial-card').first()).toBeVisible();
});

test('zooms towards the pointer with the wheel', async ({ page }) => {
  await page.goto('/?seed=42');
  await page.waitForTimeout(SETTLE);

  const zoom = () => page.evaluate(() => window.__atlas?.cameraState.current.zoom ?? 0);
  const before = await zoom();
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(1000);
  expect(await zoom()).toBeGreaterThan(before);
});

test('opens a card in the viewer and closes it again', async ({ page }) => {
  await page.goto('/?seed=42');
  await page.waitForTimeout(SETTLE);

  // Click the centre of a card that is fully inside the viewport.
  const target = await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('.spatial-card'))) {
      const rect = el.getBoundingClientRect();
      if (rect.left > 80 && rect.right < innerWidth - 80 && rect.top > 120 && rect.bottom < innerHeight - 160) {
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: (el as HTMLElement).dataset.id };
      }
    }
    return null;
  });
  expect(target).not.toBeNull();

  await page.mouse.click(target!.x, target!.y);
  await page.waitForTimeout(1800);

  await expect(page.locator('.viewer-surface')).toBeVisible();
  await expect(page.locator('.viewer-details h2')).not.toBeEmpty();
  await expect(page.locator('.viewer-toolbar')).toBeVisible();
  // The chrome disappears while a card is presented.
  await expect(page.locator('.atlas-app')).toHaveClass(/is-presenting/);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1800);
  await expect(page.locator('.viewer-surface')).toHaveCount(0);
  await expect(page.locator('.atlas-app')).not.toHaveClass(/is-presenting/);
});

test('falls back to the CSS renderer when WebGL2 is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (original as never as (t: string, ...r: unknown[]) => unknown).call(this, type, ...rest);
    } as never;
  });
  await page.goto('/?seed=42');
  await page.waitForTimeout(SETTLE);

  await expect(page.locator('.atlas-host')).toHaveAttribute('data-renderer', 'css');
  await expect(page.locator('.spatial-card').first()).toBeVisible();
  // The omnibox must stay usable without a GPU.
  await page.locator(SEARCH_INPUT).click();
  await expect(page.locator(SEARCH_INPUT)).toBeFocused();
});

test('reports an honest status when the model cannot be loaded', async ({ page }) => {
  // Block the model host so the worker fails to download the weights.
  await page.route('**://huggingface.co/**', (route) => route.abort());
  await page.goto('/?seed=42');
  await page.waitForTimeout(20_000);

  const caption = page.locator('.search-caption');
  await expect(caption).toBeVisible();
  await expect(caption).toContainText(/Loading|Could not|Retry/i);
  // The mosaic still works without the model.
  await expect(page.locator('.spatial-card').first()).toBeVisible();
});

test('keeps the mosaic usable on a small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=42');
  await page.waitForTimeout(SETTLE);

  await expect(page.locator('.atlas-host')).toHaveAttribute('data-renderer', 'webgl2-instanced');
  const box = await page.locator('.search-box').boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390 - 28);
  await expect(page.locator('.spatial-card').first()).toBeVisible();
});
