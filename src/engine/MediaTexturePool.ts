/**
 * The media pool: it owns the bitmaps, the video elements and the generated
 * waveform canvases, and keeps the GPU texture cache fed.
 *
 * Port of the recovered `bt` class. The pool is deliberately independent from
 * React: it exposes callbacks (`onChange`, `onFrame`) and never touches the
 * component tree.
 */
import { paintWaveform } from '../media/waveform';
import type { MediaItem } from '../media/types';

export interface MediaPoolOptions {
  onChange?: () => void;
  onFrame?: () => void;
  videoLimit?: number;
  posterLimit?: number;
}

interface ImageJob {
  image: HTMLImageElement;
  src: string;
  priority: number;
  valid: () => boolean;
  commit: () => void;
  settle: () => void;
  order: number;
  started: boolean;
  finished: boolean;
  cancelled: boolean;
}

interface DetailEntry {
  image: HTMLImageElement;
  ready: boolean;
  job?: ImageJob;
}

interface Entry {
  key: string;
  item: MediaItem;
  posterReady: boolean;
  revision: number;
  videoRevision: number;
  videoUsed: number;
  frameBucket: number;
  lastFrameTime: number;
  image?: HTMLImageElement;
  canvas?: HTMLCanvasElement;
  video?: HTMLVideoElement;
  posterJob?: ImageJob;
  desiredPlaying?: boolean;
  playPending?: Promise<void> | undefined;
  playBlocked?: boolean;
  watchedPlay?: Promise<void> | undefined;
  disposed?: boolean;
  audioProgress?: number;
  removeVideoEvents?: () => void;
  frameRequest?: number;
}

/** The cache key of a media item. */
export function mediaKey(item: MediaItem): string {
  const still = item.type === 'image' ? (item.thumbnail ?? item.src) : item.poster;
  const motion = item.type === 'video' ? item.src : undefined;
  return still || motion ? `${item.type}:${still ?? ''}|${motion ?? ''}` : `${item.type}:${item.id}`;
}

/** Plays or pauses a video, tracking the asynchronous play() promise. */
function syncPlayback(entry: Entry, playing: boolean) {
  const wasPlaying = entry.desiredPlaying;
  entry.desiredPlaying = playing;
  const video = entry.video;
  if (!playing) {
    entry.playBlocked = false;
    if (video && !video.paused) video.pause();
    return;
  }
  if (wasPlaying) entry.playBlocked = false;
  if (!video || entry.playPending || entry.playBlocked || !video.paused) return;
  let raw: Promise<void>;
  try {
    raw = video.play();
  } catch {
    entry.playBlocked = true;
    return;
  }
  // The *derived* promise is stored, so that neither the raw rejection nor the
  // derived one can become an unhandled rejection.
  const pending = raw
    .then(
      () => {
        if (entry.disposed || !entry.desiredPlaying || entry.video !== video) video.pause();
      },
      () => {
        if (!entry.disposed && entry.desiredPlaying && entry.video === video) entry.playBlocked = true;
      },
    )
    .finally(() => {
      if (entry.playPending === pending) entry.playPending = undefined;
    });
  entry.playPending = pending;
}

export class MediaPool {
  private options: MediaPoolOptions;
  private entries = new Map<string, Entry>();
  private details = new Map<string, DetailEntry>();
  private queue: ImageJob[] = [];
  private jobs = new Set<ImageJob>();
  private imageLoads = 0;
  private sequence = 0;
  private videoSequence = 0;
  private protectedKeys = new Set<string>();
  private nearby: { item: MediaItem; distance: number }[] = [];
  private active = true;
  private focused: { key: string; playing: boolean } | null = null;
  private disposed = false;
  private changePending = false;
  private frameNotification = 0;
  private fallbackTimer = 0;
  private audioTimer = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private videoLimit: number;
  private posterLimit: number;

  constructor(options: MediaPoolOptions = {}) {
    this.options = options;
    this.videoLimit = Math.max(0, options.videoLimit ?? (matchMedia('(pointer: coarse)').matches ? 4 : 8));
    this.posterLimit = Math.max(1, options.posterLimit ?? 192);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.reducedMotion.addEventListener('change', this.handleReducedMotion);
  }

  /** Loads (or refreshes) the media entry of an item. */
  load(item: MediaItem, priority = 2): Entry {
    const key = mediaKey(item);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.item !== item) this.updateItem(item);
      this.entries.delete(key);
      this.entries.set(key, existing);
      if (existing.posterJob && !existing.posterJob.started) {
        existing.posterJob.priority = Math.max(existing.posterJob.priority, priority);
      }
      return existing;
    }

    const entry: Entry = {
      key,
      item,
      posterReady: false,
      revision: 0,
      videoRevision: 0,
      videoUsed: 0,
      frameBucket: -1,
      lastFrameTime: -Infinity,
    };
    if (this.disposed) {
      entry.disposed = true;
      return entry;
    }
    this.entries.set(key, entry);

    const still = item.type === 'image' ? (item.thumbnail ?? item.src) : item.poster;
    if (still) {
      const image = this.createImage();
      entry.image = image;
      entry.posterJob = this.enqueueImage(
        image,
        still,
        priority,
        () => !entry.disposed && this.entries.get(key) === entry,
        () => {
          entry.posterReady = true;
          entry.revision++;
          this.changed();
        },
        () => {
          entry.posterJob = undefined;
        },
      );
      this.pumpImages();
    } else if (item.type !== 'image' && item.type !== 'video') {
      const canvas = document.createElement('canvas');
      canvas.width = item.type === 'audio' ? 640 : 768;
      const height = canvas.width / (item.aspectRatio ?? 4 / 3);
      canvas.height = item.type === 'audio' ? Math.max(2, 2 * Math.round(height / 2)) : Math.round(height);
      const context = canvas.getContext('2d');
      if (context) {
        const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, item.color ?? '#426679');
        gradient.addColorStop(1, '#05131f');
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (item.type === 'audio') paintWaveform(canvas, item);
        entry.canvas = canvas;
        entry.posterReady = true;
        entry.revision++;
      }
    }
    this.trim();
    return entry;
  }

  /** Refreshes the metadata of an already loaded item. */
  updateItem(item: MediaItem) {
    const entry = this.entries.get(mediaKey(item));
    if (!entry) return;
    const previous = entry.item;
    entry.item = item;
    if (item.type === 'audio' && entry.canvas && previous.waveform !== item.waveform) {
      paintWaveform(entry.canvas, item, entry.audioProgress);
      entry.revision++;
      this.changed();
    }
  }

  /** Updates the playback progress of the focused audio item. */
  setAudioProgress(item: MediaItem, time: number, duration: number) {
    if (this.focused?.key !== mediaKey(item)) return;
    const entry = this.entries.get(mediaKey(item));
    if (!entry?.canvas) return;
    const progress = duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0;
    if (entry.audioProgress === progress) return;
    entry.audioProgress = progress;
    paintWaveform(entry.canvas, entry.item, progress);
    entry.revision++;
    this.changed();
  }

  /** Tells the pool which items are near the viewport. */
  updateVisible(
    visible: { item: MediaItem; distance: number }[],
    options: { active?: boolean; protected?: MediaItem[] } = {},
  ) {
    if (this.disposed) return;
    const nearest = new Map<string, { item: MediaItem; distance: number }>();
    for (const entry of visible) {
      const key = mediaKey(entry.item);
      if (entry.distance < (nearest.get(key)?.distance ?? Infinity)) nearest.set(key, entry);
    }
    this.nearby = Array.from(nearest.values()).sort((a, b) => a.distance - b.distance);
    this.active = options.active ?? true;
    this.protectedKeys.clear();
    for (const { item } of this.nearby) this.protectedKeys.add(mediaKey(item));
    for (const item of options.protected ?? []) this.protectedKeys.add(mediaKey(item));
    for (const { item } of this.nearby) this.load(item, 3);
    this.reconcileVideos();
    this.trim();
  }

  /** The bitmap source of an entry. */
  static source(entry: Entry | undefined): CanvasImageSource | undefined {
    if (!entry) return undefined;
    if (entry.video && entry.video.readyState >= 2) return entry.video;
    if (entry.posterReady) return entry.image ?? entry.canvas;
    return undefined;
  }

  /** A version string that changes whenever the bitmap changes. */
  static sourceVersion(entry: Entry | undefined): string {
    if (!entry) return '';
    if (entry.video && entry.video.readyState >= 2) {
      return `${entry.key}:video:${entry.videoRevision}:${Math.floor(entry.video.currentTime * 30)}`;
    }
    return `${entry.key}:poster:${entry.revision}`;
  }

  /** The aspect ratio of an entry. */
  static aspect(entry: Entry | undefined): number {
    if (!entry) return 4 / 3;
    if (entry.video?.videoWidth && entry.video?.videoHeight) {
      return entry.video.videoWidth / entry.video.videoHeight;
    }
    if (entry.posterReady && entry.image?.naturalWidth && entry.image?.naturalHeight) {
      return entry.image.naturalWidth / entry.image.naturalHeight;
    }
    return entry.item.aspectRatio ?? 4 / 3;
  }

  /** Focuses an item, giving it the high-resolution texture. */
  focus(item: MediaItem | null): HTMLVideoElement | undefined {
    const previous = this.focused && this.entries.get(this.focused.key);
    if (previous?.video) {
      previous.video.muted = true;
      previous.video.loop = true;
    }
    if (previous) this.resizeAudio(previous, 1536);
    this.focused = item ? { key: mediaKey(item), playing: true } : null;
    if (item) {
      const entry = this.load(item, 4);
      this.resizeAudio(entry, 1536);
      if (item.type === 'video') {
        this.activateVideo(entry);
        if (entry.video) entry.video.loop = false;
      }
    }
    this.reconcileVideos();
    return item ? this.entries.get(mediaKey(item))?.video : undefined;
  }

  /** Resizes the generated waveform of an audio entry. */
  private resizeAudio(entry: Entry, width: number) {
    if (entry.item.type !== 'audio' || !entry.canvas) return;
    if (entry.canvas.width === width) return;
    entry.canvas.width = width;
    entry.canvas.height = Math.max(2, 2 * Math.round(width / (entry.item.aspectRatio || 4 / 3) / 2));
    paintWaveform(entry.canvas, entry.item, entry.audioProgress);
    entry.revision++;
    this.changed();
  }

  /** Sets whether the focused media should be playing. */
  setFocusedPlaying(playing: boolean) {
    if (!this.focused) return;
    this.focused.playing = playing;
    if (playing) {
      const entry = this.entries.get(this.focused.key);
      if (entry) entry.playBlocked = false;
    }
    this.reconcileVideos();
  }

  /** Preloads the full-resolution bitmap of an image. */
  preloadDetail(item: MediaItem, priority = 0): HTMLImageElement | undefined {
    if (this.disposed || item.type !== 'image' || !item.src) return undefined;
    const src = item.src;
    if (!item.thumbnail || src === item.thumbnail) return this.load(item, 1).image;
    const existing = this.details.get(src);
    if (existing) {
      this.details.delete(src);
      this.details.set(src, existing);
      if (existing.job) {
        existing.job.priority = Math.max(existing.job.priority, priority);
        if (priority > 1) existing.image.fetchPriority = 'high';
      }
      return existing.image;
    }
    const detail: DetailEntry = { image: this.createImage(), ready: false };
    this.details.set(src, detail);
    detail.job = this.enqueueImage(
      detail.image,
      src,
      priority,
      () => this.details.get(src) === detail,
      () => {
        detail.ready = true;
        this.changed();
      },
      () => {
        detail.job = undefined;
        if (!detail.ready && this.details.get(src) === detail) this.details.delete(src);
      },
    );
    while (this.details.size > 6) {
      const oldest = this.details.entries().next().value as [string, DetailEntry] | undefined;
      if (!oldest) break;
      this.details.delete(oldest[0]);
      this.cancelJob(oldest[1].job);
      oldest[1].image.removeAttribute('src');
    }
    this.pumpImages();
    return detail.image;
  }

  /** The full-resolution bitmap of an image, when it is ready. */
  getDetail(item: MediaItem): HTMLImageElement | undefined {
    if (item.type !== 'image' || !item.src) return undefined;
    if (!item.thumbnail || item.src === item.thumbnail) {
      const entry = this.entries.get(mediaKey(item));
      return entry?.posterReady ? entry.image : undefined;
    }
    const detail = this.details.get(item.src);
    return detail?.ready ? detail.image : undefined;
  }

  private createImage(): HTMLImageElement {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    return image;
  }

  private enqueueImage(
    image: HTMLImageElement,
    src: string,
    priority: number,
    valid: () => boolean,
    commit: () => void,
    settle: () => void,
  ): ImageJob {
    const job: ImageJob = {
      image,
      src,
      priority,
      valid,
      commit,
      settle,
      order: ++this.sequence,
      started: false,
      finished: false,
      cancelled: false,
    };
    image.onload = () => {
      void (async () => {
        try {
          await image.decode?.();
          if (!this.disposed && !job.cancelled && job.valid() && image.naturalWidth > 0) job.commit();
        } catch {
          /* the bitmap could not be decoded */
        } finally {
          this.finishJob(job);
        }
      })();
    };
    image.onerror = () => this.finishJob(job);
    this.queue.push(job);
    this.jobs.add(job);
    return job;
  }

  private finishJob(job: ImageJob) {
    if (job.finished) return;
    job.finished = true;
    if (job.started) this.imageLoads--;
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    job.image.onload = job.image.onerror = null;
    this.jobs.delete(job);
    job.settle();
    this.pumpImages();
  }

  private cancelJob(job: ImageJob | undefined) {
    if (!job || job.finished) return;
    job.cancelled = true;
    job.image.onload = job.image.onerror = null;
    job.image.removeAttribute('src');
    this.finishJob(job);
  }

  private pumpImages() {
    if (this.disposed) return;
    this.queue.sort((a, b) => b.priority - a.priority || a.order - b.order);
    while (this.imageLoads < 6 && this.queue.length) {
      const job = this.queue.shift()!;
      if (job.finished || job.cancelled || !job.valid()) {
        this.cancelJob(job);
        continue;
      }
      job.started = true;
      this.imageLoads++;
      job.image.fetchPriority = job.priority > 1 ? 'high' : 'low';
      job.image.src = job.src;
    }
  }

  private handleVisibilityChange = () => {
    if (!this.disposed) this.reconcileVideos();
  };

  private handleReducedMotion = () => {
    if (!this.disposed) this.updateAudioAnimation();
  };

  /** Starts and stops the videos that are on screen. */
  reconcileVideos() {
    const active = new Set<string>();
    if (this.focused) {
      const entry = this.entries.get(this.focused.key);
      if (entry?.item.type === 'video') {
        active.add(entry.key);
        this.activateVideo(entry);
        entry.videoUsed = ++this.videoSequence;
      }
    } else if (this.active && !document.hidden) {
      for (const { item } of this.nearby) {
        if (item.type !== 'video' || !item.src) continue;
        if (active.size >= this.videoLimit) break;
        const entry = this.entries.get(mediaKey(item));
        if (!entry) continue;
        active.add(entry.key);
        this.activateVideo(entry);
        entry.videoUsed = ++this.videoSequence;
      }
    }

    for (const entry of this.entries.values()) {
      const shouldPlay = active.has(entry.key) && !document.hidden && (!this.focused || this.focused.playing);
      const changed = entry.desiredPlaying !== shouldPlay;
      this.applyPlayback(entry, shouldPlay);
      if (shouldPlay && entry.video && !entry.video.paused) this.startFrames(entry);
      else this.stopFrames(entry);
      if (changed) this.changed();
    }

    const stale = Array.from(this.entries.values())
      .filter((entry) => entry.video && !active.has(entry.key))
      .sort((a, b) => b.videoUsed - a.videoUsed);
    for (const entry of stale.slice(2)) this.releaseVideo(entry);
    this.updateFallbackTimer();
    this.updateAudioAnimation();
  }

  private animatedAudio(): Entry[] {
    if (!this.active || this.focused || document.hidden || this.reducedMotion.matches) return [];
    return this.nearby
      .filter(({ item }) => item.type === 'audio')
      .map(({ item }) => this.entries.get(mediaKey(item)))
      .filter((entry): entry is Entry => !!entry?.canvas && !entry.disposed);
  }

  private updateAudioAnimation() {
    if (this.disposed) return;
    if (this.animatedAudio().length) {
      this.audioTimer ||= window.setTimeout(this.audioFrame, 50);
    } else {
      clearTimeout(this.audioTimer);
      this.audioTimer = 0;
    }
  }

  private audioFrame = () => {
    this.audioTimer = 0;
    if (this.disposed) return;
    const entries = this.animatedAudio();
    const time = performance.now() / 1000;
    for (const entry of entries) {
      paintWaveform(entry.canvas!, entry.item, 0, time);
      entry.revision++;
    }
    if (entries.length) (this.options.onFrame ?? this.options.onChange)?.();
    this.updateAudioAnimation();
  };

  private applyPlayback(entry: Entry, playing: boolean) {
    syncPlayback(entry, playing);
    const promise = entry.playPending;
    if (promise && entry.watchedPlay !== promise) {
      entry.watchedPlay = promise;
      promise.then(() => {
        if (entry.watchedPlay === promise) entry.watchedPlay = undefined;
        if (this.disposed || entry.disposed || !entry.video) return;
        this.applyPlayback(entry, entry.desiredPlaying ?? false);
        if (entry.video.paused) return;
        this.startFrames(entry);
        this.changed();
      });
    }
  }

  private activateVideo(entry: Entry) {
    if (entry.video || entry.disposed || !entry.item.src) return;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    entry.video = video;
    entry.videoRevision++;
    entry.playBlocked = false;

    const isCurrent = () => !this.disposed && !entry.disposed && entry.video === video;
    const onData = () => {
      if (!isCurrent()) return;
      this.changed();
      if (entry.desiredPlaying && !video.paused) this.startFrames(entry);
    };
    const onPlaying = () => {
      if (!isCurrent() || !entry.desiredPlaying || document.hidden) {
        video.pause();
        return;
      }
      this.startFrames(entry);
      this.changed();
    };
    const onPause = () => {
      if (!isCurrent()) return;
      this.stopFrames(entry);
      this.updateFallbackTimer();
      this.changed();
    };
    const onEnded = () => {
      if (this.focused?.key === entry.key) this.focused.playing = false;
      this.reconcileVideos();
      this.changed();
    };
    video.addEventListener('loadeddata', onData);
    video.addEventListener('seeked', onData);
    video.addEventListener('ended', onEnded);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onPause);
    entry.removeVideoEvents = () => {
      video.removeEventListener('loadeddata', onData);
      video.removeEventListener('seeked', onData);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onPause);
    };
    video.src = entry.item.src;
  }

  private startFrames(entry: Entry) {
    const video = entry.video;
    if (!video || !entry.desiredPlaying || video.paused || document.hidden || this.disposed) return;
    if (typeof video.requestVideoFrameCallback !== 'function') {
      this.updateFallbackTimer();
      return;
    }
    if (entry.frameRequest !== undefined) return;
    const onFrame = (now: number, metadata: { mediaTime: number }) => {
      entry.frameRequest = undefined;
      if (entry.video !== video || !entry.desiredPlaying || video.paused || document.hidden || this.disposed) return;
      const bucket = Math.floor(metadata.mediaTime * 30);
      if (bucket !== entry.frameBucket && now - entry.lastFrameTime >= 1000 / 30 - 1) {
        entry.frameBucket = bucket;
        entry.lastFrameTime = now;
        this.videoFrame();
      }
      entry.frameRequest = video.requestVideoFrameCallback(onFrame);
    };
    entry.frameRequest = video.requestVideoFrameCallback(onFrame);
  }

  private stopFrames(entry: Entry) {
    if (entry.frameRequest === undefined) return;
    entry.video?.cancelVideoFrameCallback?.(entry.frameRequest);
    entry.frameRequest = undefined;
  }

  private updateFallbackTimer() {
    if (this.disposed) return;
    const needsFallback =
      !document.hidden &&
      Array.from(this.entries.values()).some(
        (entry) =>
          entry.desiredPlaying &&
          entry.video &&
          !entry.video.paused &&
          typeof entry.video.requestVideoFrameCallback !== 'function',
      );
    if (!needsFallback) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = 0;
      return;
    }
    this.fallbackTimer ||= window.setTimeout(this.fallbackFrames, 1000 / 30);
  }

  private fallbackFrames = () => {
    this.fallbackTimer = 0;
    if (this.disposed || document.hidden) return;
    for (const entry of this.entries.values()) {
      const video = entry.video;
      if (
        !entry.desiredPlaying ||
        !video ||
        video.paused ||
        video.readyState < 2 ||
        typeof video.requestVideoFrameCallback === 'function'
      ) {
        continue;
      }
      const bucket = Math.floor(video.currentTime * 30);
      if (bucket !== entry.frameBucket) {
        entry.frameBucket = bucket;
        this.videoFrame();
      }
    }
    this.updateFallbackTimer();
  };

  private videoFrame() {
    if (this.disposed || this.frameNotification) return;
    this.frameNotification = requestAnimationFrame(() => {
      this.frameNotification = 0;
      if (this.disposed || document.hidden) return;
      (this.options.onFrame ?? this.options.onChange)?.();
    });
  }

  private changed() {
    if (this.disposed || this.changePending) return;
    this.changePending = true;
    queueMicrotask(() => {
      this.changePending = false;
      if (!this.disposed) this.options.onChange?.();
    });
  }

  private releaseVideo(entry: Entry) {
    const video = entry.video;
    if (!video) return;
    syncPlayback(entry, false);
    this.stopFrames(entry);
    entry.removeVideoEvents?.();
    entry.removeVideoEvents = undefined;
    entry.video = undefined;
    entry.playPending = undefined;
    entry.playBlocked = false;
    entry.videoRevision++;
    video.removeAttribute('src');
    video.load();
    this.changed();
  }

  private trim() {
    if (this.entries.size <= this.posterLimit) return;
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.posterLimit) break;
      if (this.protectedKeys.has(key) || this.focused?.key === key || entry.desiredPlaying) continue;
      this.entries.delete(key);
      this.disposeEntry(entry);
    }
  }

  private disposeEntry(entry: Entry) {
    entry.disposed = true;
    this.cancelJob(entry.posterJob);
    this.releaseVideo(entry);
    entry.image?.removeAttribute('src');
    entry.canvas = undefined;
    entry.posterReady = false;
  }

  /** Releases every resource held by the pool. */
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.reducedMotion.removeEventListener('change', this.handleReducedMotion);
    cancelAnimationFrame(this.frameNotification);
    clearTimeout(this.fallbackTimer);
    clearTimeout(this.audioTimer);
    this.frameNotification = this.fallbackTimer = this.audioTimer = 0;
    for (const job of Array.from(this.jobs)) this.cancelJob(job);
    this.queue = [];
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    for (const detail of this.details.values()) detail.image.removeAttribute('src');
    this.entries.clear();
    this.details.clear();
    this.nearby = [];
    this.protectedKeys.clear();
  }
}
