#!/usr/bin/env node
/**
 * Compares the recreation's layout with the original bundle's layout, on the
 * same catalog, and prints the differences.
 *
 * Usage: node scripts/compare-layout.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const bundlePath = resolve(appRoot, 'reference', 'embeddinggemma-recovery', 'original', 'index-D4Mcwtca.js');

const source = readFileSync(bundlePath, 'utf8');
const at = source.indexOf('29.52');
if (at < 0) throw new Error('Could not find the layout function in the bundle.');

/** Scans forward from `from`, counting braces while skipping string literals. */
function matchBraces(text, from) {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const fnStart = source.lastIndexOf('function', at);
const bodyStart = source.indexOf('{', fnStart);
const bodyEnd = matchBraces(source, bodyStart);
const fnSource = source.slice(fnStart, bodyEnd + 1);
const fnName = fnSource.slice(0, fnSource.indexOf('(')).replace('function', '').trim();
const originalLayout = new Function(`${fnSource}; return ${fnName};`)();

// The search-result layout (`St` in the recovered sources).
const resultAt = source.indexOf('spiralOrder');
let resultFn = null;
if (resultAt >= 0) {
  const start = source.lastIndexOf('function', resultAt);
  const body = source.indexOf('{', start);
  const end = matchBraces(source, body);
  const text = source.slice(start, end + 1);
  const name = text.slice(0, text.indexOf('(')).replace('function', '').trim();
  // `St` calls `ct`, so both are evaluated together.
  resultFn = new Function(`${fnSource}\n${text}; return ${name};`)();
}

// Bundle the recreation's layout module so it can run in plain Node.
const entry = resolve(here, '.layout-entry.mjs');
const out = resolve(here, '.layout-bundle.mjs');
await build({
  stdin: {
    contents: `export { computeMosaicLayout, computeResultLayout } from ${JSON.stringify(resolve(appRoot, 'src/engine/AspectMosaicLayout.ts'))};`,
    resolveDir: appRoot,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'silent',
});
const { computeMosaicLayout, computeResultLayout } = await import(out);

const catalog = JSON.parse(readFileSync(resolve(appRoot, 'public', 'local', 'catalog.json'), 'utf8'));
const items = [
  ...catalog.collections.image.items.map((i) => ({ id: i.id, aspectRatio: i.aspectRatio })),
  ...catalog.collections.audio.items.map((i) => ({ id: i.id, aspectRatio: i.aspectRatio })),
  ...catalog.collections.video.items.map((i) => ({ id: i.id, aspectRatio: i.aspectRatio })),
];

const summary = (layout) => ({
  width: Math.round(layout.width * 100) / 100,
  height: Math.round(layout.height * 100) / 100,
  rows: layout.rows,
  columns: layout.columns,
  count: layout.items.length,
  first: layout.items
    .slice(0, 5)
    .map((i) => ({ x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w), h: Math.round(i.h) })),
  rowCounts: (() => {
    const rows = new Map();
    for (const item of layout.items) rows.set(item.row, (rows.get(item.row) ?? 0) + 1);
    return Array.from(rows.entries())
      .map(([row, count]) => `${row}:${count}`)
      .join(' ');
  })(),
});

const original = summary(originalLayout(items));
const mine = summary(computeMosaicLayout(items));

console.log('items:', items.length);
console.log('ORIGINAL:', JSON.stringify({ ...original, rowCounts: undefined }, null, 2));
console.log('MINE    :', JSON.stringify({ ...mine, rowCounts: undefined }, null, 2));
console.log('row counts equal:', original.rowCounts === mine.rowCounts);
if (original.rowCounts !== mine.rowCounts) {
  console.log('ORIGINAL rows:', original.rowCounts);
  console.log('MINE     rows:', mine.rowCounts);
}
console.log('first items equal:', JSON.stringify(original.first) === JSON.stringify(mine.first));

if (resultFn) {
  // The result layout is fed the items in score order.
  const scored = items.map((item, index) => ({ ...item, score: 0.9 - index * 0.001 }));
  const originalResult = resultFn(scored);
  const mineResult = computeResultLayout(scored);
  const resultSummary = (layout) => ({
    width: Math.round(layout.width * 100) / 100,
    height: Math.round(layout.height * 100) / 100,
    rows: layout.rows,
    count: layout.items.length,
    first: layout.items
      .slice(0, 4)
      .map((i) => ({ x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w), h: Math.round(i.h) })),
  });
  const o = resultSummary(originalResult);
  const m = resultSummary(mineResult);
  console.log('RESULT ORIGINAL:', JSON.stringify(o));
  console.log('RESULT MINE    :', JSON.stringify(m));
  console.log('result layout equal:', JSON.stringify(o) === JSON.stringify(m));
}
