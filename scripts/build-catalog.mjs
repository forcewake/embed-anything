#!/usr/bin/env node
/**
 * Normalizes the three collection manifests into ONE canonical catalog
 * (`public/local/catalog.json`).
 *
 * The canonical catalog keeps the *stable row order* of the embedding matrices:
 *
 *   images (0 .. 4999)  ->  local/data/embeddings.f16
 *   audio  (0 ..  284)  ->  local/data/audio-embeddings.f16   (rows 5000 .. 5284)
 *   video  (0 ..  257)  ->  local/data/video-embeddings.f16   (rows 5285 .. 5542)
 *
 * `embeddingIndex` is always the *per-collection* index and is therefore the
 * offset into that collection's own `.f16` matrix. `row` is the offset into the
 * combined matrix (images ++ audio ++ video) and is what the ranker scans.
 *
 * The display order (the seeded shuffle) is applied at runtime and never
 * influences indexing.
 *
 * The manifests are not published as a file by the Space — they are embedded
 * in the deployed bundle as object literals. This script therefore extracts them
 * from the bundle with the TypeScript parser (no `eval`, the AST is walked and
 * the literals are read directly).
 *
 * Usage:
 *   node scripts/build-catalog.mjs [--recovery <dir>] [--out <file>] [--offline]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const recoveryDir = resolve(
  arg('--recovery', process.env.EMBED_RECOVERY_DIR ?? resolve(appRoot, 'reference', 'embeddinggemma-recovery')),
);
const outFile = resolve(arg('--out', resolve(appRoot, 'public', 'local', 'catalog.json')));
const offline = process.argv.includes('--offline');

const SPACE = 'https://huggingface.co/spaces/webml-community/embeddinggemma-2-webgpu';
const SPACE_API = 'https://huggingface.co/api/spaces/webml-community/embeddinggemma-2-webgpu';
const MANIFEST_KEYS = ['dimensions', 'count', 'dtype', 'byte_order', 'normalized', 'embedding_file', 'assets'];

/** Reads a JavaScript literal out of the AST. */
function literalValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return -literalValue(node.operand);
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => literalValue(element));
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = property.name;
      if (!name || (!ts.isIdentifier(name) && !ts.isStringLiteral(name))) continue;
      out[name.text] = literalValue(property.initializer);
    }
    return out;
  }
  return undefined;
}

function propertyName(property) {
  const name = property.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

/** Finds the three manifest object literals inside the deployed bundle. */
function extractManifests(code) {
  const source = ts.createSourceFile('bundle.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties.map(propertyName);
      if (MANIFEST_KEYS.every((key) => names.includes(key))) {
        const value = literalValue(node);
        if (value && Array.isArray(value.assets)) found.push(value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Discovers the current file name of the deployed bundle on the Space. */
async function discoverBundleUrl() {
  const response = await fetch(`${SPACE_API}/tree/main/assets`);
  if (!response.ok) throw new Error(`Could not list the Space assets (${response.status}).`);
  const entries = await response.json();
  const bundle = entries.find((entry) => /(^|\/)index-[^/]*\.js$/.test(entry.path));
  if (!bundle) throw new Error('Could not find the deployed bundle on the Space.');
  return `${SPACE}/resolve/main/${bundle.path}`;
}

async function loadManifests() {
  // 1. A local copy of the recovery kit (fast, offline).
  const local = resolve(recoveryDir, 'catalog.manifests.json');
  if (existsSync(local)) {
    console.log(`[build-catalog] source      : ${local}`);
    const parsed = JSON.parse(readFileSync(local, 'utf8'));
    return [parsed.Sn, parsed.Cn, parsed.wn];
  }

  // 2. Extract them from the deployed bundle.
  if (offline) throw new Error(`No local manifest at ${local} and --offline was requested.`);
  console.log('[build-catalog] source      : the deployed bundle on the Space');
  const url = await discoverBundleUrl();
  console.log(`[build-catalog] bundle      : ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the bundle (${response.status}).`);
  const code = await response.text();
  const manifests = extractManifests(code);
  if (manifests.length < 3) {
    throw new Error(`Expected three collection manifests in the bundle, found ${manifests.length}.`);
  }
  const byCount = new Map(manifests.map((manifest) => [manifest.count, manifest]));
  return [byCount.get(5000), byCount.get(285), byCount.get(258)];
}

const [imageManifest, audioManifest, videoManifest] = await loadManifests();
if (!imageManifest || !audioManifest || !videoManifest) {
  console.error('[build-catalog] FATAL: could not identify the three collection manifests.');
  process.exit(1);
}

const collections = [
  { key: 'image', manifest: imageManifest, file: 'embeddings.f16' },
  { key: 'audio', manifest: audioManifest, file: 'audio-embeddings.f16' },
  { key: 'video', manifest: videoManifest, file: 'video-embeddings.f16' },
];

const out = { dimensions: 768, generatedFrom: 'catalog.manifests.json', collections: {} };
let row = 0;

for (const { key, manifest, file } of collections) {
  // Keep the manifest order but verify that `embedding_index` is a 0-based
  // permutation, so that matrix rows can never be addressed by visual order.
  const assets = manifest.assets.slice();
  assets.forEach((asset, i) => {
    if (asset.embedding_index !== i) {
      throw new Error(
        `Collection ${key}: asset ${i} has embedding_index ${asset.embedding_index}; the manifest is not in row order.`,
      );
    }
  });

  out.collections[key] = {
    embeddingFile: file,
    count: assets.length,
    items: assets.map((asset) => {
      const base = {
        embeddingIndex: asset.embedding_index,
        row: row++,
        id: asset.catalog_id ?? asset.id,
        type: key,
        title: asset.description || (key === 'image' ? 'Unsplash photo' : 'Untitled'),
        description: asset.photographer_description ?? asset.description ?? '',
        topic: asset.category ?? (key === 'audio' ? 'Sounds' : (asset.topic ?? '')),
        aspectRatio: asset.aspect_ratio ?? (asset.width && asset.height ? asset.width / asset.height : 3 / 2),
        source: asset.photo_page ?? asset.source ?? '',
        color: asset.dominant_color ? `#${asset.dominant_color}` : key === 'audio' ? '#12363d' : undefined,
      };
      if (key === 'image') {
        return { ...base, unsplashId: asset.url, photoPage: asset.photo_page ?? '' };
      }
      if (key === 'audio') {
        return {
          ...base,
          url: asset.url ?? null,
          localFile: asset.local_file ?? null,
          durationSeconds: asset.duration_seconds ?? 0,
          clipEndSeconds: asset.clip_end_seconds ?? null,
          waveform: asset.waveform ?? [],
        };
      }
      return {
        ...base,
        url: asset.url ?? null,
        poster: asset.poster ?? null,
        durationSeconds: asset.duration_seconds ?? 0,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
      };
    }),
  };
  console.log(`[build-catalog] ${key.padEnd(5)} : ${assets.length} items, rows ${row - assets.length}..${row - 1}`);
}

const total = Object.values(out.collections).reduce((n, c) => n + c.count, 0);
if (total !== 5543) {
  console.error(`[build-catalog] FATAL: expected 5543 items, got ${total}.`);
  process.exit(1);
}
out.total = total;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(out));
console.log(`[build-catalog] wrote ${outFile} (${total} items, ${(JSON.stringify(out).length / 1e6).toFixed(2)} MB)`);
