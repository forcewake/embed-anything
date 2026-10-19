#!/usr/bin/env node
/**
 * Captures the atlas at a given zoom level, so the composition can be compared
 * between the reference bundle and the recreation.
 *
 * Usage: node scripts/shoot-zoom.mjs <url> <out.png> [width] [height] [zoomSteps]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = resolve(root, process.argv[3] ?? 'artifacts/zoom.png');
const width = Number(process.argv[4] ?? 2000);
const height = Number(process.argv[5] ?? 1130);
const steps = Number(process.argv[6] ?? 0);

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(7000);

for (let i = 0; i < steps; i++) {
  await page.keyboard.press('-');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.spatial-card'));
  const rects = cards.map((el) => el.getBoundingClientRect());
  const visible = rects.filter((r) => r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight);
  return {
    cards: cards.length,
    visible: visible.length,
    avgWidth: visible.length ? Math.round(visible.reduce((s, r) => s + r.width, 0) / visible.length) : 0,
    avgHeight: visible.length ? Math.round(visible.reduce((s, r) => s + r.height, 0) / visible.length) : 0,
  };
});

await page.screenshot({ path: out });
console.log(JSON.stringify({ out, ...info, errors: errors.slice(0, 8) }));
await browser.close();
