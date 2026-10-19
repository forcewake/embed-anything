import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_ID, SEARCH_TASK_PREFIX, WARMUP_QUERY, DIMENSIONS } from '../src/ml/protocol';
import { buildCatalogItems, formatDuration, unsplashUrl, type RawCatalog } from '../src/media/catalog';
import { seededShuffle, mulberry32, hashSeed } from '../src/media/shuffle';
import { detectMediaType, isSupportedDataTransfer } from '../src/media/file-ingest';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = resolve(appRoot, 'public', 'local', 'catalog.json');

describe('protocol constants', () => {
  it('uses the reference model and prompt', () => {
    expect(MODEL_ID).toBe('onnx-community/embeddinggemma-2-ONNX');
    expect(SEARCH_TASK_PREFIX).toBe('task: search result | query: ');
    expect(WARMUP_QUERY).toBe('task: search result | query: a photograph');
    expect(DIMENSIONS).toBe(768);
  });
});

describe('catalog', () => {
  const exists = existsSync(catalogPath);
  const catalog = exists ? (JSON.parse(readFileSync(catalogPath, 'utf8')) as RawCatalog) : null;

  it.skipIf(!exists)('contains 5,000 images, 285 audio items and 258 videos', () => {
    expect(catalog!.collections.image.count).toBe(5000);
    expect(catalog!.collections.audio.count).toBe(285);
    expect(catalog!.collections.video.count).toBe(258);
    expect(catalog!.total).toBe(5543);
  });

  it.skipIf(!exists)('keeps the embedding rows in the canonical order', () => {
    let row = 0;
    for (const key of ['image', 'audio', 'video'] as const) {
      const collection = catalog!.collections[key];
      collection.items.forEach((item, index) => {
        expect(item.embeddingIndex).toBe(index);
        expect(item.row).toBe(row++);
      });
    }
    expect(row).toBe(5543);
  });

  it.skipIf(!exists)('normalizes the catalog into the media model', () => {
    const items = buildCatalogItems(catalog!);
    expect(items).toHaveLength(5543);
    expect(items.filter((i) => i.type === 'image')).toHaveLength(5000);
    expect(items.filter((i) => i.type === 'audio')).toHaveLength(285);
    expect(items.filter((i) => i.type === 'video')).toHaveLength(258);
    const image = items.find((i) => i.type === 'image')!;
    expect(image.thumbnail).toContain('images.unsplash.com');
    expect(image.src).toContain('w=3840');
    const audio = items.find((i) => i.type === 'audio')!;
    expect(audio.src).toBeTruthy();
    expect(audio.waveform!.length).toBeGreaterThan(0);
    const video = items.find((i) => i.type === 'video')!;
    expect(video.poster).toBeTruthy();
  });

  it.skipIf(!exists)('never lets the display order influence the index', () => {
    const items = buildCatalogItems(catalog!);
    const shuffled = seededShuffle(items, 12345);
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const item of shuffled) {
      expect(byId.get(item.id)!.embeddingId).toBe(item.embeddingId);
    }
  });
});

describe('formatting helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('builds Unsplash CDN URLs', () => {
    expect(unsplashUrl('photo-123', 640)).toBe('https://images.unsplash.com/photo-123?fm=jpg&fit=max&w=640&h=640&q=90');
  });
});

describe('seeded shuffle', () => {
  it('is deterministic for a given seed', () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    expect(seededShuffle(items, 7)).toEqual(seededShuffle(items, 7));
  });

  it('produces a different order for a different seed', () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    expect(seededShuffle(items, 7)).not.toEqual(seededShuffle(items, 8));
  });

  it('does not modify the source array', () => {
    const items = [1, 2, 3, 4, 5];
    seededShuffle(items, 3);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  it('is a permutation', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect(seededShuffle(items, 11).sort((a, b) => a - b)).toEqual(items);
  });

  it('produces a uniform distribution', () => {
    const random = mulberry32(99);
    const values = Array.from({ length: 5000 }, () => random());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });

  it('hashes strings deterministically', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });
});

describe('file ingestion', () => {
  const file = (name: string, type: string) => new File(['x'], name, { type });

  it('detects the media type from the mime type', () => {
    expect(detectMediaType(file('a.jpg', 'image/jpeg'))).toBe('image');
    expect(detectMediaType(file('a.mp4', 'video/mp4'))).toBe('video');
    expect(detectMediaType(file('a.mp3', 'audio/mpeg'))).toBe('audio');
    expect(detectMediaType(file('a.txt', 'text/plain'))).toBe('text');
  });

  it('falls back to the file extension', () => {
    expect(detectMediaType(file('a.webp', ''))).toBe('image');
    expect(detectMediaType(file('a.mov', 'application/octet-stream'))).toBe('video');
    expect(detectMediaType(file('a.flac', 'application/octet-stream'))).toBe('audio');
  });

  it('rejects unsupported files', () => {
    expect(detectMediaType(file('a.bin', 'application/octet-stream'))).toBeUndefined();
    expect(detectMediaType(file('a.exe', 'application/x-msdownload'))).toBeUndefined();
  });

  it('rejects a data transfer without files', () => {
    expect(isSupportedDataTransfer(null)).toBe(false);
    expect(isSupportedDataTransfer({ types: ['text/plain'], items: [] } as unknown as DataTransfer)).toBe(false);
  });

  it('accepts a data transfer with a usable file', () => {
    const transfer = {
      types: ['Files'],
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file('a.png', 'image/png') }],
    } as unknown as DataTransfer;
    expect(isSupportedDataTransfer(transfer)).toBe(true);
  });
});
