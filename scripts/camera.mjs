#!/usr/bin/env node
/**
 * Prints the camera state of the recreation after a number of zoom-out steps.
 *
 * Usage: node scripts/camera.mjs [url] [steps]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/?seed=math';
const steps = Number(process.argv[3] ?? 0);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(7000);
for (let i = 0; i < steps; i++) {
  await page.keyboard.press('-');
  await page.waitForTimeout(150);
}
await page.waitForTimeout(2500);
const state = await page.evaluate(() => {
  const field = window.__atlas;
  if (!field) return { error: 'no __atlas hook' };
  return field.cameraState;
});
console.log(JSON.stringify(state, null, 2));
await browser.close();
