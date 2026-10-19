#!/usr/bin/env node
/**
 * Dumps the on-screen geometry of the visible cards, so the recreation and the
 * reference bundle can be compared numerically.
 *
 * Usage: node scripts/probe.mjs [url]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(7000);
for (let i = 0; i < Number(process.argv[3] ?? 0); i++) {
  await page.keyboard.press('-');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(2500);

const probe = await page.evaluate(() => {
  const host = document.querySelector('.atlas-host');
  const scene = document.querySelector('.label-scene');
  const cards = Array.from(document.querySelectorAll('.spatial-card'));
  const sample = cards.slice(0, 8).map((el) => {
    const style = el.style;
    const matrix = new DOMMatrixReadOnly(style.transform);
    const rect = el.getBoundingClientRect();
    return {
      id: el.dataset.id,
      key: el.dataset.key,
      type: el.dataset.type,
      tileWidth: style.getPropertyValue('--tile-width'),
      tileHeight: style.getPropertyValue('--tile-height'),
      translate: [Math.round(matrix.m41), Math.round(matrix.m42)],
      scale: Number(matrix.a.toFixed(4)),
      // The world pose of the card: x = translate[0] + 328, y = translate[1] + height/2
      world: [
        Math.round(matrix.m41 + 328),
        Math.round(matrix.m42 + Number(style.getPropertyValue('--tile-height').replace('px', '')) / 2),
      ],
      rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
    };
  });
  return {
    renderer: host?.dataset.renderer,
    sceneTransform: scene?.style.transform,
    cardCount: cards.length,
    sample,
  };
});

console.log(JSON.stringify(probe, null, 2));
await browser.close();
