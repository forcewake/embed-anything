#!/usr/bin/env node
/**
 * Compresses the documentation images so the repository stays small.
 *
 * The photographs are re-encoded as JPEG (they are photographic content), the
 * diagrams stay PNG. The *visual-regression baselines* are never touched —
 * they must stay pixel-exact.
 *
 * Usage: node scripts/optimize-images.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const dir = resolve(root, 'docs', 'images');
const MAX_WIDTH = 1400;

const browser = await chromium.launch();
const page = await browser.newPage();

for (const name of [
  'hero.png',
  'search.png',
  'zoomed-out.png',
  'drop-overlay.png',
  'mobile.png',
  'reference-vs-recreation.png',
]) {
  const path = join(dir, name);
  const dataUrl = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
  const { data, type } = await page.evaluate(
    async ([url, maxWidth]) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      const scale = Math.min(1, maxWidth / image.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { data: canvas.toDataURL('image/jpeg', 0.86), type: 'image/jpeg' };
    },
    [dataUrl, MAX_WIDTH],
  );
  const out = join(dir, name.replace(/\.png$/, '.jpg'));
  writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log(
    `${name} (${(statSync(path).size / 1024).toFixed(0)} KB) -> ${out.split('/').pop()} (${(statSync(out).size / 1024).toFixed(0)} KB)`,
  );
}

await browser.close();
