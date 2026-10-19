#!/usr/bin/env node
/**
 * Drives a real semantic search in the browser and reports the outcome.
 *
 * Usage: node scripts/search.mjs [url] [query] [waitSeconds] [outName]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const url = process.argv[2] ?? 'http://localhost:5173/';
const query = process.argv[3] ?? 'a snowy mountain landscape';
const wait = Number(process.argv[4] ?? 240);
const outName = process.argv[5] ?? 'search-result';

mkdirSync(resolve(root, 'artifacts'), { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  else if (m.text().startsWith('[gemma]')) console.log(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2000);

const caption = () => page.textContent('.search-caption').catch(() => '');

// The reference shows an empty caption once the model is ready; wait until the
// "Loading" text disappears.
const started = Date.now();
let status = '';
while (Date.now() - started < wait * 1000) {
  status = (await caption()) ?? '';
  if (!/Loading/i.test(status)) break;
  await page.waitForTimeout(1000);
}
console.log('model status:', JSON.stringify(status));

await page.fill('.search-box input', query);
await page.press('.search-box input', 'Enter');

const searchStarted = Date.now();
let result = '';
while (Date.now() - searchStarted < 180_000) {
  result = (await caption()) ?? '';
  if (/^\d+ connections|No matches|error|Could not/i.test(result)) break;
  await page.waitForTimeout(500);
}

await page.waitForTimeout(8000);

const cards = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.spatial-card'))
    .slice(0, 8)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.id,
        type: el.dataset.type,
        title: el.getAttribute('aria-label'),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      };
    }),
);

await page.screenshot({ path: resolve(root, `artifacts/${outName}.png`) });
console.log(
  JSON.stringify(
    {
      status: result,
      elapsedSeconds: Math.round((Date.now() - searchStarted) / 1000),
      cards,
      errors: errors.slice(0, 8),
    },
    null,
    2,
  ),
);
await browser.close();
