#!/usr/bin/env node
/**
 * Side-by-side comparison of the recreation and the reference bundle.
 *
 * Both pages get the *same* deterministic `Math.random`, and the recreation is
 * asked to shuffle with `Math.random` (`?seed=math`), so both produce the
 * exact same catalog order, the same layout and therefore the same camera.
 * Any remaining difference in the rendered result is a real difference.
 *
 * Usage: node scripts/compare.mjs [refUrl] [appUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const refUrl = process.argv[2] ?? 'http://localhost:4174/';
const appUrl = process.argv[3] ?? 'http://localhost:5173/';
const width = Number(process.argv[4] ?? 1440);
const height = Number(process.argv[5] ?? 900);
const zoomSteps = Number(process.argv[6] ?? 0);

mkdirSync(resolve(root, 'artifacts'), { recursive: true });

/** A deterministic Math.random, identical in both pages. */
const randomScript = `
  let a = 0x2f6e2b1 >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
`;

async function capture(browser, url, out) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.addInitScript(randomScript);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(8000);
  for (let i = 0; i < zoomSteps; i++) {
    await page.keyboard.press('-');
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.spatial-card'));
    const rects = cards.map((el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    });
    const field = window.__atlas;
    return {
      renderer: document.querySelector('.atlas-host')?.dataset.renderer,
      count: cards.length,
      ids: cards.map((el) => el.dataset.id).sort(),
      camera: field ? field.cameraState : null,
      world: cards
        .map((el) => {
          const matrix = new DOMMatrixReadOnly(el.style.transform);
          const height = Number(el.style.getPropertyValue('--tile-height').replace('px', ''));
          return [el.dataset.id, Math.round(matrix.m41 + 328), Math.round(matrix.m42 + height / 2)];
        })
        .sort((a, b) => a[0].localeCompare(b[0])),
      rects: rects.sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    };
  });
  await page.screenshot({ path: out });
  await page.close();
  return { ...info, errors };
}

const browser = await chromium.launch();
const ref = await capture(browser, refUrl, resolve(root, 'artifacts/compare-reference.png'));
const mine = await capture(browser, appUrl, resolve(root, 'artifacts/compare-mine.png'));
await browser.close();

const sameIds = JSON.stringify(ref.ids) === JSON.stringify(mine.ids);
const sameRects = JSON.stringify(ref.rects) === JSON.stringify(mine.rects);
let maxDelta = 0;
for (let i = 0; i < Math.min(ref.rects.length, mine.rects.length); i++) {
  for (let k = 0; k < 4; k++) maxDelta = Math.max(maxDelta, Math.abs(ref.rects[i][k] - mine.rects[i][k]));
}

console.log(
  JSON.stringify(
    {
      reference: { renderer: ref.renderer, count: ref.count, errors: ref.errors.slice(0, 5) },
      mine: { renderer: mine.renderer, count: mine.count, errors: mine.errors.slice(0, 5) },
      sameIds,
      sameRects,
      maxRectDelta: maxDelta,
      referenceRects: ref.rects.slice(0, 6),
      mineRects: mine.rects.slice(0, 6),
      referenceWorld: ref.world.slice(0, 6),
      mineWorld: mine.world.slice(0, 6),
      mineCamera: mine.camera,
      referenceHasFirstItems: ref.ids.filter((id) => mine.camera?.firstItems?.some((f) => f.id === id)),
      commonIds: ref.ids.filter((id) => mine.ids.includes(id)).length,
    },
    null,
    2,
  ),
);
