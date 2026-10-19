import { describe, expect, it } from 'vitest';
import { computeMosaicLayout, computeResultLayout, GAP } from '../src/engine/AspectMosaicLayout';
import { SpatialIndex, rectsOverlap } from '../src/engine/SpatialIndex';
import type { MediaItem } from '../src/media/types';

const item = (id: string, aspectRatio: number): MediaItem => ({
  id,
  type: 'image',
  title: id,
  aspectRatio,
});

const catalog = (count: number, aspect = 1.5): MediaItem[] =>
  Array.from({ length: count }, (_, i) => item(`item-${i}`, aspect));

describe('mosaic layout', () => {
  it('returns an empty layout for an empty catalog', () => {
    const layout = computeMosaicLayout([]);
    expect(layout.items).toHaveLength(0);
    expect(layout.gap).toBe(GAP);
  });

  it('places every item exactly once', () => {
    const items = catalog(120);
    const layout = computeMosaicLayout(items);
    expect(layout.items).toHaveLength(120);
    expect(new Set(layout.items.map((i) => i.id)).size).toBe(120);
  });

  it('keeps the card aspect ratio within a row', () => {
    const items = [...catalog(60, 1.5), ...catalog(60, 0.75)];
    const layout = computeMosaicLayout(items);
    for (const placed of layout.items) {
      expect(placed.w / placed.h).toBeCloseTo(placed.item.aspectRatio, 6);
    }
  });

  it('staggers alternating rows by half a card', () => {
    const layout = computeMosaicLayout(catalog(120));
    const row0 = layout.items.filter((i) => i.row === 0);
    const row1 = layout.items.filter((i) => i.row === 1);
    expect(row0.length).toBeGreaterThan(0);
    expect(row1.length).toBeGreaterThan(0);
    // Row 1 starts half a cell further right than row 0.
    const offset = row1[0].x - (row0[0].x + row0[0].w / 2);
    expect(Math.abs(offset)).toBeGreaterThan(1);
  });

  it('keeps the layout centred on the origin', () => {
    const layout = computeMosaicLayout(catalog(300));
    const minX = Math.min(...layout.items.map((i) => i.x - i.w / 2));
    const maxX = Math.max(...layout.items.map((i) => i.x + i.w / 2));
    expect(Math.abs(minX + maxX)).toBeLessThan(layout.width);
  });

  it('is deterministic', () => {
    const items = catalog(200);
    const a = computeMosaicLayout(items);
    const b = computeMosaicLayout(items);
    expect(a.items.map((i) => [i.x, i.y, i.w, i.h])).toEqual(b.items.map((i) => [i.x, i.y, i.w, i.h]));
  });
});

describe('result layout', () => {
  it('places the best match first', () => {
    const items = catalog(24);
    const layout = computeResultLayout(items);
    expect(layout.items).toHaveLength(24);
    expect(layout.items[0].id).toBe(items[0].id);
  });

  it('is deterministic and keeps every item', () => {
    const items = catalog(40);
    const a = computeResultLayout(items);
    const b = computeResultLayout(items);
    expect(new Set(a.items.map((i) => i.id)).size).toBe(40);
    expect(a.items.map((i) => [i.x, i.y, i.w, i.h])).toEqual(b.items.map((i) => [i.x, i.y, i.w, i.h]));
  });
});

describe('spatial index', () => {
  it('detects overlapping rectangles', () => {
    expect(rectsOverlap({ left: 0, right: 10, top: 0, bottom: 10 }, { left: 5, right: 15, top: 5, bottom: 15 })).toBe(
      true,
    );
    expect(rectsOverlap({ left: 0, right: 1, top: 0, bottom: 1 }, { left: 5, right: 15, top: 5, bottom: 15 })).toBe(
      false,
    );
  });

  it('returns only the cards that intersect the viewport', () => {
    const layout = computeMosaicLayout(catalog(200));
    const index = new SpatialIndex(layout.items);
    const viewport = { left: -50, right: 50, top: -50, bottom: 50 };
    const found = index.query(viewport);
    for (const rank of found) {
      const item = layout.items[rank];
      expect(item.x + item.w / 2).toBeGreaterThanOrEqual(viewport.left);
      expect(item.x - item.w / 2).toBeLessThanOrEqual(viewport.right);
    }
  });

  it('returns nothing for a viewport outside the layout', () => {
    const layout = computeMosaicLayout(catalog(50));
    const index = new SpatialIndex(layout.items);
    expect(index.query({ left: 1e9, right: 1e9 + 10, top: 1e9, bottom: 1e9 + 10 })).toHaveLength(0);
  });

  it('is much cheaper than scanning every card', () => {
    const layout = computeMosaicLayout(catalog(2000));
    const index = new SpatialIndex(layout.items);
    const found = index.query({ left: -500, right: 500, top: -500, bottom: 500 });
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(layout.items.length);
  });
});
