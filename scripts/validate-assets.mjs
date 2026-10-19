#!/usr/bin/env node
/**
 * Validates the binary assets that must be present for real semantic search:
 *   public/local/data/embeddings.f16        5000 x 768 x 2 = 7,680,000 bytes
 *   public/local/data/audio-embeddings.f16  285 x 768 x 2 =   437,760 bytes
 *   public/local/data/video-embeddings.f16  258 x 768 x 2 =   396,288 bytes
 *
 * It also checks the canonical catalog (row counts, ordering) when it exists.
 *
 * Exit code 0 = all good, 1 = something is missing or wrong.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const publicDir = resolve(appRoot, 'public');

const DIMENSIONS = 768;
const EXPECTED = [
  { file: 'local/data/embeddings.f16', rows: 5000, kind: 'image' },
  { file: 'local/data/audio-embeddings.f16', rows: 285, kind: 'audio' },
  { file: 'local/data/video-embeddings.f16', rows: 258, kind: 'video' },
];

let failures = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures++;
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log('Embedding matrix files');
for (const { file, rows, kind } of EXPECTED) {
  const path = resolve(publicDir, file);
  if (!existsSync(path)) {
    fail(`${file} is missing — run "npm run assets:fetch" (needs network access)`);
    continue;
  }
  const bytes = statSync(path).size;
  const expected = rows * DIMENSIONS * 2;
  if (bytes !== expected) {
    fail(`${file} is ${bytes} bytes, expected ${expected} (${rows} x ${DIMENSIONS} float16)`);
    continue;
  }
  // Quick NaN / infinity probe on the first and last rows.
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const readHalf = (offset) => {
    const h = view.getUint16(offset, true);
    const exp = (h >>> 10) & 0x1f;
    const frac = h & 0x3ff;
    let value;
    if (exp === 0) value = frac * 2 ** -24;
    else if (exp === 31) value = frac ? NaN : Infinity;
    else value = (1024 + frac) * 2 ** (exp - 25);
    return h & 0x8000 ? -value : value;
  };
  const probe = (row) => {
    for (let j = 0; j < DIMENSIONS; j++) {
      const v = readHalf(row * DIMENSIONS * 2 + j * 2);
      if (!Number.isFinite(v)) return false;
    }
    return true;
  };
  if (!probe(0) || !probe(rows - 1)) {
    fail(`${file} contains a non-finite value in the first or last row`);
    continue;
  }
  ok(`${file} — ${bytes.toLocaleString('en-US')} bytes, ${rows} rows x ${DIMENSIONS} dims (${kind})`);
}

console.log('\nCanonical catalog');
const catalogPath = resolve(publicDir, 'local', 'catalog.json');
if (!existsSync(catalogPath)) {
  fail('public/local/catalog.json is missing — run "npm run assets:build"');
} else {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const expectedCounts = { image: 5000, audio: 285, video: 258 };
  let row = 0;
  for (const [key, expected] of Object.entries(expectedCounts)) {
    const collection = catalog.collections?.[key];
    if (!collection) {
      fail(`catalog is missing the "${key}" collection`);
      continue;
    }
    if (collection.count !== expected) fail(`catalog ${key} count is ${collection.count}, expected ${expected}`);
    else ok(`catalog ${key} — ${collection.count} items`);
    collection.items?.forEach((item, i) => {
      if (item.embeddingIndex !== i) fail(`catalog ${key}[${i}].embeddingIndex is ${item.embeddingIndex}`);
      if (item.row !== row++) fail(`catalog ${key}[${i}].row is ${item.row}, expected ${row - 1}`);
    });
  }
  if (catalog.total !== 5543) fail(`catalog total is ${catalog.total}, expected 5543`);
  else ok(`catalog total — ${catalog.total} items`);
}

console.log('\nOptional assets');
for (const optional of ['studio.hdr', 'fonts/inter-400.ttf', 'fonts/inter-600.ttf']) {
  const path = resolve(publicDir, optional);
  if (existsSync(path)) ok(`${optional} — ${statSync(path).size.toLocaleString('en-US')} bytes`);
  else console.log(`  · ${optional} missing (the app degrades gracefully without it)`);
}

if (failures) {
  console.error(`\n${failures} asset check(s) failed.`);
  process.exit(1);
}
console.log('\nAll asset checks passed.');
