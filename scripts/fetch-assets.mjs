#!/usr/bin/env node
/**
 * Downloads the public runtime assets that the original Space serves and that
 * are NOT part of the JavaScript bundles:
 *
 *   local/data/embeddings.f16         5000 x 768 float16
 *   local/data/audio-embeddings.f16    285 x 768 float16
 *   local/data/video-embeddings.f16    258 x 768 float16
 *   local/runtime/ort-wasm-simd-threaded.asyncify.{mjs,wasm}
 *   fonts/inter-400.ttf, fonts/inter-600.ttf
 *   studio.hdr                        optional HDR environment map
 *
 * Only public Hugging Face Space files are fetched. No credentials are used.
 *
 * Usage:
 *   node scripts/fetch-assets.mjs            # core assets
 *   node scripts/fetch-assets.mjs --all      # also local media (23 mp3 + 10 posters)
 *   node scripts/fetch-assets.mjs --list
 */
import { mkdirSync, existsSync, statSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const publicDir = resolve(appRoot, 'public');
const SPACE = 'https://huggingface.co/spaces/webml-community/embeddinggemma-2-webgpu/resolve/main';

const CORE = [
  'local/data/embeddings.f16',
  'local/data/audio-embeddings.f16',
  'local/data/video-embeddings.f16',
  'local/runtime/ort-wasm-simd-threaded.asyncify.mjs',
  'local/runtime/ort-wasm-simd-threaded.asyncify.wasm',
  'fonts/inter-400.ttf',
  'fonts/inter-600.ttf',
  'studio.hdr',
];

function arg(name) {
  return process.argv.includes(name);
}

async function fetchOne(relative) {
  const target = join(publicDir, relative);
  if (existsSync(target) && statSync(target).size > 0) {
    console.log(`SKIP ${relative} (${statSync(target).size.toLocaleString('en-US')} B)`);
    return true;
  }
  mkdirSync(dirname(target), { recursive: true });
  const url = `${SPACE}/${relative}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'EmbedAnything/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw new Error('empty response');
    writeFileSync(target, buffer);
    console.log(`OK   ${relative} (${buffer.length.toLocaleString('en-US')} B)`);
    return true;
  } catch (err) {
    console.error(`FAIL ${relative}: ${err.message}`);
    return false;
  }
}

function localMediaPaths() {
  const catalogPath = join(publicDir, 'local', 'catalog.json');
  if (!existsSync(catalogPath)) return [];
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const files = [];
  for (const item of catalog.collections.audio.items) {
    if (item.localFile) files.push(`local/data/${item.localFile}`);
  }
  for (const item of catalog.collections.video.items) {
    if (item.poster && !item.poster.startsWith('https://')) files.push(`local/data/${item.poster}`);
  }
  return [...new Set(files)];
}

const paths = [...CORE];
if (arg('--all')) paths.push(...localMediaPaths());

if (arg('--list')) {
  for (const p of paths) console.log(p);
  console.log(`Total: ${paths.length} files`);
  process.exit(0);
}

let failed = 0;
for (const p of paths) if (!(await fetchOne(p))) failed++;
if (failed) {
  console.error(`\n${failed}/${paths.length} files failed. Check connectivity to huggingface.co.`);
  process.exit(1);
}
console.log(`\nFetched ${paths.length} files into public/.`);
