#!/usr/bin/env node
/**
 * Solves for the camera of the reference bundle from its rendered card
 * positions, using the recreation's layout (both pages use the same seeded
 * shuffle, so the layouts are identical).
 *
 * Usage: node scripts/solve-camera.mjs [refUrl] [appUrl] [steps]
 */
import { chromium } from 'playwright';

const refUrl = process.argv[2] ?? 'http://localhost:4174/';
const appUrl = process.argv[3] ?? 'http://localhost:5173/?seed=math';
const steps = Number(process.argv[4] ?? 0);

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

const browser = await chromium.launch();

async function open(url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(randomScript);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(8000);
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('-');
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2500);
  return page;
}

const appPage = await open(appUrl);
const appData = await appPage.evaluate(() => {
  const field = window.__atlas;
  return { camera: field.cameraState, layout: field.cameraState.layoutItems };
});

const refPage = await open(refUrl);
const refCards = await refPage.evaluate(() =>
  Array.from(document.querySelectorAll('.spatial-card')).map((el) => {
    const matrix = new DOMMatrixReadOnly(el.style.transform);
    const height = Number(el.style.getPropertyValue('--tile-height').replace('px', ''));
    return [el.dataset.id, matrix.m41 + 328, matrix.m42 + height / 2];
  }),
);

await browser.close();

const { camera, layout } = appData;
const byId = new Map(layout.map((item) => [item.id, item]));
const W = camera.layout.width;
const H = camera.layout.height;
const n = camera.current.zoom * camera.cardScale;

const candidates = [];
for (const [id, worldX, worldY] of refCards) {
  const item = byId.get(id);
  if (!item) continue;
  // world = (item + tile*size - camera) * n  =>  camera = item + tile*size - world/n
  for (let l = -3; l <= 3; l++) {
    for (let f = -3; f <= 3; f++) {
      const cx = item.x + l * W - worldX / n;
      const cy = item.y + f * H - worldY / n;
      candidates.push({ id, l, f, cx, cy });
    }
  }
}

// Cluster the candidates; the true camera is the mode of the distribution.
const key = (c) => `${Math.round(c.cx / 50)}:${Math.round(c.cy / 50)}`;
const clusters = new Map();
for (const c of candidates) {
  const k = key(c);
  if (!clusters.has(k)) clusters.set(k, []);
  clusters.get(k).push(c);
}
const best = Array.from(clusters.values()).sort((a, b) => b.length - a.length)[0];
const avg = (list, field) => list.reduce((s, c) => s + c[field], 0) / list.length;

console.log(
  JSON.stringify(
    {
      matches: best.length,
      referenceCamera: { x: avg(best, 'cx'), y: avg(best, 'cy') },
      mineCamera: camera.current,
      delta: { x: avg(best, 'cx') - camera.current.x, y: avg(best, 'cy') - camera.current.y },
      sampleTiles: best.slice(0, 5).map((c) => ({ id: c.id, l: c.l, f: c.f })),
      zoom: camera.current.zoom,
    },
    null,
    2,
  ),
);
