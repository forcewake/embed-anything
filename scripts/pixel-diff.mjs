#!/usr/bin/env node
/**
 * Computes the pixel difference between two PNG files (used to compare the
 * recreation with the reference bundle).
 *
 * Usage: node scripts/pixel-diff.mjs <a.png> <b.png>
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('Usage: node scripts/pixel-diff.mjs <a.png> <b.png>');

const toDataUrl = (path) => `data:image/png;base64,${readFileSync(resolve(path)).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const result = await page.evaluate(
  async ([urlA, urlB]) => {
    const load = (url) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = url;
      });
    const [imgA, imgB] = await Promise.all([load(urlA), load(urlB)]);
    const width = Math.min(imgA.width, imgB.width);
    const height = Math.min(imgA.height, imgB.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgA, 0, 0);
    const a = ctx.getImageData(0, 0, width, height).data;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(imgB, 0, 0);
    const b = ctx.getImageData(0, 0, width, height).data;
    let differing = 0;
    let total = 0;
    let maxDelta = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(a[i + k] - b[i + k]);
        maxDelta = Math.max(maxDelta, d);
        total += d;
      }
      if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) {
        differing++;
      }
    }
    const pixels = width * height;
    return {
      width,
      height,
      differingPixels: differing,
      differingRatio: differing / pixels,
      meanChannelDelta: total / (pixels * 3),
      maxChannelDelta: maxDelta,
      heatmap: (() => {
        // 16x16 blocks with the share of differing pixels.
        const blocks = [];
        const block = 32;
        for (let by = 0; by < height; by += block) {
          for (let bx = 0; bx < width; bx += block) {
            let n = 0;
            for (let y = by; y < Math.min(by + block, height); y++) {
              for (let x = bx; x < Math.min(bx + block, width); x++) {
                const i = (y * width + x) * 4;
                if (
                  Math.abs(a[i] - b[i]) > 8 ||
                  Math.abs(a[i + 1] - b[i + 1]) > 8 ||
                  Math.abs(a[i + 2] - b[i + 2]) > 8
                ) {
                  n++;
                }
              }
            }
            if (n > 0) blocks.push([bx, by, Math.round((n / (block * block)) * 100)]);
          }
        }
        return blocks.sort((p, q) => q[2] - p[2]).slice(0, 12);
      })(),
    };
  },
  [toDataUrl(a), toDataUrl(b)],
);
await browser.close();
console.log(JSON.stringify(result, null, 2));
