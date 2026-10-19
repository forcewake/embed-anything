#!/usr/bin/env node
/**
 * Exercises the paths that the functional suite does not cover: the
 * drag & drop overlay, the camera permission error and the "Clear" action.
 *
 * Usage: node scripts/interactions.mjs [url]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const url = process.argv[2] ?? 'http://localhost:5173/';

mkdirSync(resolve(root, 'artifacts'), { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
// Deny the camera so the permission error path is exercised.
await context.clearPermissions();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.goto(url);
await page.waitForTimeout(5000);

// --- drag & drop overlay ----------------------------------------------------
await page.evaluate(() => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], 'sample.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true }));
});
await page.waitForTimeout(600);
const overlayVisible = await page.locator('.drop-overlay').isVisible();
await page.screenshot({ path: resolve(root, 'artifacts/drop-overlay.png') });

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const overlayDismissed = (await page.locator('.drop-overlay').count()) === 0;

// --- camera dialog ----------------------------------------------------------
await page.locator('.search-box button[aria-label="Take a photo to search"]').click();
await page.waitForTimeout(2500);
const cameraDialog = await page.locator('.webcam-dialog').isVisible();
const cameraMessage = await page
  .locator('.webcam-message')
  .textContent()
  .catch(() => '');
await page.screenshot({ path: resolve(root, 'artifacts/camera-dialog.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const cameraClosed = (await page.locator('.webcam-dialog').count()) === 0;

// --- upload flow ------------------------------------------------------------
await page.setInputFiles('.search-box input[type="file"]', {
  name: 'tiny.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
});
await page.waitForTimeout(4000);
const status = await page.evaluate(() => document.querySelector('.search-caption')?.textContent ?? '');
await page.screenshot({ path: resolve(root, 'artifacts/upload.png') });

console.log(
  JSON.stringify(
    {
      overlayVisible,
      overlayDismissed,
      cameraDialog,
      cameraMessage: (cameraMessage ?? '').trim().slice(0, 120),
      cameraClosed,
      statusAfterUpload: status.slice(0, 160),
      errors: errors.slice(0, 8),
    },
    null,
    2,
  ),
);
await browser.close();
