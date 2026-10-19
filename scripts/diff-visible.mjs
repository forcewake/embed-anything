#!/usr/bin/env node
/**
 * Diffs the visible card sets of the reference bundle and the recreation.
 *
 * Usage: node scripts/diff-visible.mjs [refUrl] [appUrl] [steps]
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
const app = await appPage.evaluate(() => {
  const field = window.__atlas;
  const items = new Map(field.cameraState.layoutItems.map((i) => [i.id, i]));
  const cards = Array.from(document.querySelectorAll('.spatial-card')).map((el) => el.dataset.id);
  return {
    camera: field.cameraState,
    ids: cards,
    itemInfo: cards.map((id) => {
      const item = items.get(id);
      return { id, x: item?.x, y: item?.y, row: item?.row };
    }),
  };
});

const refPage = await open(refUrl);
const refIds = await refPage.evaluate(() =>
  Array.from(document.querySelectorAll('.spatial-card')).map((el) => el.dataset.id),
);
await browser.close();

const refSet = new Set(refIds);
const appSet = new Set(app.ids);
const onlyRef = refIds.filter((id) => !appSet.has(id));
const onlyApp = app.ids.filter((id) => !refSet.has(id));
const info = new Map(app.itemInfo.map((i) => [i.id, i]));

console.log(
  JSON.stringify(
    {
      refCount: refIds.length,
      appCount: app.ids.length,
      common: refIds.filter((id) => appSet.has(id)).length,
      onlyRefCount: onlyRef.length,
      onlyAppCount: onlyApp.length,
      onlyRef: onlyRef.slice(0, 10).map((id) => info.get(id)),
      onlyApp: onlyApp.slice(0, 10).map((id) => info.get(id)),
      camera: app.camera.current,
      layoutWidth: app.camera.layout.width,
    },
    null,
    2,
  ),
);
