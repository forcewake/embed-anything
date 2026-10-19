/**
 * Loads and normalizes the canonical catalog.
 *
 * The catalog file (`public/local/catalog.json`) is produced by
 * `scripts/build-catalog.mjs` from the recovered collection manifests. Its row
 * order matches the embedding matrices exactly:
 *
 *   images (rows 0..4999) -> local/data/embeddings.f16
 *   audio  (rows 5000..5284) -> local/data/audio-embeddings.f16
 *   video  (rows 5285..5542) -> local/data/video-embeddings.f16
 *
 * The *display* order (the seeded shuffle) is applied afterwards and never
 * influences which embedding row an item is addressed by.
 */
import type { AudioItem, ImageItem, MediaItem, VideoItem } from './types';
import { seededShuffle } from './shuffle';

export interface RawCatalogItem {
  embeddingIndex: number;
  row: number;
  id: string;
  type: 'image' | 'audio' | 'video';
  title: string;
  description?: string;
  topic?: string;
  aspectRatio: number;
  source?: string;
  color?: string;
  unsplashId?: string;
  photoPage?: string;
  url?: string | null;
  localFile?: string | null;
  poster?: string | null;
  durationSeconds?: number;
  clipEndSeconds?: number | null;
  waveform?: number[];
  width?: number;
  height?: number;
}

export interface RawCatalog {
  dimensions: number;
  total: number;
  collections: {
    image: { embeddingFile: string; count: number; items: RawCatalogItem[] };
    audio: { embeddingFile: string; count: number; items: RawCatalogItem[] };
    video: { embeddingFile: string; count: number; items: RawCatalogItem[] };
  };
}

/**
 * Base URL of the locally hosted assets.
 *
 * Resolved lazily so the module can also be imported in a non-DOM context
 * (the unit tests and the Node scripts).
 */
export function assetBase(): string {
  const base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI;
  return new URL('./local/', base).href;
}

/** Formats a duration in seconds as `m:ss` (or `h:mm:ss`). */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return minutes < 60
    ? `${minutes}:${rest}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}`;
}

/** The Unsplash CDN URL for a photo id at the given box size. */
export function unsplashUrl(photoId: string, size: number): string {
  return `https://images.unsplash.com/${photoId}?fm=jpg&fit=max&w=${size}&h=${size}&q=90`;
}

/** Converts the raw catalog into the typed media model. */
export function buildCatalogItems(catalog: RawCatalog): MediaItem[] {
  const items: MediaItem[] = [];

  for (const raw of catalog.collections.image.items) {
    const item: ImageItem = {
      id: raw.id,
      embeddingId: raw.id,
      type: 'image',
      title: raw.title || 'Unsplash photo',
      description: raw.description,
      topic: raw.topic,
      aspectRatio: raw.aspectRatio || 4 / 3,
      source: raw.photoPage ?? raw.source,
      color: raw.color,
    };
    if (raw.unsplashId) {
      item.thumbnail = unsplashUrl(raw.unsplashId, 640);
      item.src = unsplashUrl(raw.unsplashId, 3840);
    }
    items.push(item);
  }

  for (const raw of catalog.collections.audio.items) {
    const item: AudioItem = {
      id: raw.id,
      embeddingId: raw.id,
      type: 'audio',
      title: raw.title || 'Sound',
      description: raw.description,
      topic: raw.topic ?? 'Sounds',
      aspectRatio: 3 / 2,
      source: raw.source,
      color: raw.color ?? '#12363d',
      durationSeconds: raw.durationSeconds ?? 0,
      duration: formatDuration(raw.durationSeconds ?? 0),
      waveform: raw.waveform ?? [],
      waveformStatus: 'ready',
    };
    if (raw.url) item.src = raw.url;
    else if (raw.localFile) {
      item.localFile = raw.localFile;
      item.src = new URL(`data/${raw.localFile}`, assetBase()).href;
    }
    if (raw.clipEndSeconds != null) item.playbackEndSeconds = raw.clipEndSeconds;
    items.push(item);
  }

  for (const raw of catalog.collections.video.items) {
    const item: VideoItem = {
      id: raw.id,
      embeddingId: raw.id,
      type: 'video',
      title: raw.title || 'Video',
      description: raw.description,
      topic: raw.topic,
      aspectRatio: raw.aspectRatio || 16 / 9,
      source: raw.source,
      durationSeconds: raw.durationSeconds ?? 0,
      duration: formatDuration(raw.durationSeconds ?? 0),
    };
    if (raw.url) item.src = raw.url;
    if (raw.poster) {
      item.poster = raw.poster.startsWith('https://') ? raw.poster : new URL(`data/${raw.poster}`, assetBase()).href;
    }
    items.push(item);
  }

  return items;
}

/** Downloads and normalizes the catalog. */
export async function loadCatalog(signal?: AbortSignal): Promise<{ items: MediaItem[]; catalog: RawCatalog }> {
  const response = await fetch(new URL('catalog.json', assetBase()), { signal });
  if (!response.ok) throw new Error(`The catalog could not be loaded (${response.status}).`);
  const catalog = (await response.json()) as RawCatalog;
  return { items: buildCatalogItems(catalog), catalog };
}

/**
 * Produces the initial display order.
 *
 * The reference shuffles the whole catalog with `Math.random()`. This build
 * uses a seeded shuffle so the composition is reproducible; pass `?seed=` in
 * the URL to change it.
 */
export function displayOrder(items: readonly MediaItem[], seed: number): MediaItem[] {
  return seededShuffle(items, seed);
}
