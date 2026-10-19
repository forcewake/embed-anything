#!/usr/bin/env node
/**
 * A quick visual probe: opens the app in Chromium, waits for the mosaic to
 * settle, and writes a screenshot. Used during development.
 *
 * Usage: node scripts/shoot.mjs [url] [out] [width] [height] [waitMs]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = resolve(root, process.argv[3] ?? 'artifacts/shot.png');
const width = Number(process.argv[4] ?? 1440);
const height = Number(process.argv[5] ?? 900);
const wait = Number(process.argv[6] ?? 6000);

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);

const info = await page.evaluate(() => ({
  renderer: document.querySelector('.atlas-host')?.dataset.renderer,
  cards: document.querySelectorAll('.spatial-card').length,
  caption: document.querySelector('.search-caption')?.textContent ?? '',
  webgl2: !!document.createElement('canvas').getContext('webgl2'),
  webgpu: 'gpu' in navigator,
}));

await page.screenshot({ path: out });
console.log(JSON.stringify({ out, ...info, errors: errors.slice(0, 12) }, null, 2));
await browser.close();
