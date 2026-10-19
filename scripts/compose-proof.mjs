#!/usr/bin/env node
/**
 * Builds the side-by-side proof image: the reference bundle on the left, the
 * recreation on the right.
 *
 * Usage: node scripts/compose-proof.mjs <reference.png> <mine.png> <out.png>
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [a, b, out] = process.argv.slice(2);
if (!a || !b || !out) throw new Error('Usage: node scripts/compose-proof.mjs <ref.png> <mine.png> <out.png>');

const toDataUrl = (path) => `data:image/png;base64,${readFileSync(resolve(path)).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 560 } });
await page.setContent(
  `<style>
     body { margin: 0; background: #070b11; font-family: ui-sans-serif, system-ui, sans-serif; }
     .row { display: flex; gap: 12px; padding: 12px; }
     figure { margin: 0; flex: 1; }
     img { width: 100%; display: block; border-radius: 8px; }
     figcaption { color: #9fb0bd; font-size: 13px; padding: 8px 2px 0; letter-spacing: .02em; }
     b { color: #eaf2f8; font-weight: 600; }
   </style>
   <div class="row">
     <figure><img src="${toDataUrl(a)}"><figcaption><b>Reference</b> — the deployed bundle of the Space</figcaption></figure>
     <figure><img src="${toDataUrl(b)}"><figcaption><b>Recreation</b> — this repository, same camera, same catalog order</figcaption></figure>
   </div>`,
);
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(out) });
await browser.close();
console.log(resolve(out));
