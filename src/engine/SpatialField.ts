/**
 * The spatial field: the interactive glass mosaic.
 *
 * A faithful port of the recovered `Kt` controller. It owns
 *   - the camera and the layout,
 *   - the WebGL2 renderer (or the CSS fallback),
 *   - the DOM nodes used for accessibility and for the fallback,
 *   - the pointer / wheel / keyboard gestures,
 *   - the focus (presentation) transition.
 *
 * The controller never re-renders React: it mutates the DOM and the WebGL
 * state directly, and reports only coarse-grained events to its owner.
 */
import { GlassRenderer, type RendererCard } from './GlassRenderer';
import { MediaPool, mediaKey } from './MediaTexturePool';
import { CameraController, MAX_ZOOM, MIN_ZOOM } from './CameraController';
import { computeMosaicLayout, computeResultLayout, type LayoutItem, type MosaicLayout } from './AspectMosaicLayout';
import { SpatialIndex } from './SpatialIndex';
import {
  applyInverseOrbit,
  applyOrbit,
  cardShape,
  clamp,
  focusShape,
  focusTarget,
  interpolateCard,
  multiplyMat3,
  projectToScreen,
  quaternionToMatrix,
  rotateQuaternion,
  smootherstep,
  spherePlacement,
  toCssMatrix3d,
  type CardPose,
  type CardShape,
} from './geometry';
import type { MediaItem } from '../media/types';

/** The duration of the entrance animation, in milliseconds. */
const ENTRANCE_DURATION = 1100;

/** The golden angle, used to distribute the entrance along a spiral. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** A stable 0..1 hash of a string. */
export function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967295;
}

/** The entrance transform of a card, port of `zt`. */
function entranceTransform(
  id: string,
  index: number,
  progress: number,
  width: number,
  height: number,
): { x: number; y: number; z: number; opacity: number; scale: number } {
  const amount = Number.isNaN(progress) ? 0 : clamp(progress, 0, 1);
  if (amount >= 1) return { x: 0, y: 0, z: 0, opacity: 1, scale: 1 };
  const order = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const delay = Math.min(150, order * 15) / ENTRANCE_DURATION;
  const local = clamp((amount - delay) / (1 - delay), 0, 1);
  const eased = smootherstep(local);
  const remaining = 1 - eased;
  const w = Number.isFinite(width) ? Math.max(1, width) : 1;
  const h = Number.isFinite(height) ? Math.max(1, height) : 1;
  const hash = hashUnit(id);
  const angle = (order - 1) * GOLDEN_ANGLE + (hash - 0.5) * 0.24 + eased * 0.58;
  const distance = order === 0 ? 0 : Math.hypot(w, h) * (0.56 + hash * 0.08) * remaining;
  return {
    x: order === 0 ? 0 : Math.cos(angle) * distance,
    y: order === 0 ? 0 : Math.sin(angle) * distance,
    z: -Math.min(180, Math.min(w, h) * 0.18) * remaining * (order === 0 ? 0.4 : 1),
    opacity: smootherstep(clamp(local / 0.34, 0, 1)),
    scale: 1 - (order === 0 ? 0.04 : 0.14) * remaining,
  };
}

/** The exit transform of a departing card, port of `Bt`. */
function departureTransform(
  id: string,
  progress: number,
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; z: number; opacity: number; scale: number } {
  const eased = smootherstep(clamp(progress, 0, 1));
  const angle = Math.hypot(x, y) > 1 ? Math.atan2(y, x) : hashUnit(id) * Math.PI * 2;
  const distance = Math.hypot(width, height) * 0.24 * eased;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    z: -120 * eased,
    opacity: 1 - smootherstep(clamp(progress / 0.72, 0, 1)),
    scale: 1 - 0.16 * eased,
  };
}

interface PoolNode {
  item: MediaItem;
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  painted: string;
  score: HTMLElement;
  scoreValue: HTMLElement;
  similarity?: number;
  interactive?: boolean;
  opacity?: number;
  cssWidth?: number;
  cssHeight?: number;
  card?: CardPose;
}

interface FocusState {
  item: MediaItem;
  node: PoolNode;
  card: CardPose;
  original: CardPose;
  viewer: HTMLElement;
  progress: number;
  dimProgress: number;
  fromDimProgress: number;
  toDimProgress: number;
  entrance: number;
  closing: boolean;
  from: CardPose;
  to: CardPose;
  fromShape: CardShape;
  toShape: CardShape;
  fromProgress: number;
  toProgress: number;
  fromOpacity: number;
  toOpacity: number;
  fromLens: number;
  toLens: number;
  start: number;
  duration: number;
  departing: {
    node: PoolNode;
    original: CardPose;
    from: CardPose;
    start: number;
  }[];
  done?: () => void;
}

export interface SpatialFieldOptions {
  items: MediaItem[];
  scores?: Map<string, number>;
  onOpen: (item: MediaItem) => void;
  onReady?: (field: SpatialField) => void;
}

export class SpatialField {
  private host: HTMLElement;
  private onOpen: (item: MediaItem) => void;
  private items: MediaItem[];
  private scores?: Map<string, number>;
  private layout: MosaicLayout;
  private layoutIndex: SpatialIndex;
  private width: number;
  private height: number;
  private navigation: CameraController;

  readonly canvas: HTMLCanvasElement;
  readonly labels: HTMLDivElement;
  readonly labelScene: HTMLDivElement;
  readonly focusLayer: HTMLDivElement;

  private renderer: GlassRenderer | null = null;
  private media: MediaPool;
  private pool = new Map<string, PoolNode>();
  private cachedCards: CardPose[] = [];
  private cachedItems = new Map<string, MediaItem>();
  private visibleMedia: { item: MediaItem; distance: number }[] = [];
  private protectedMedia: MediaItem[] = [];
  private visibilityCamera = '';
  private visibleSignature = '';
  private pointers = new Map<number, { x: number; y: number }>();
  private hoverKey = '';
  private detailTimer: number | undefined;
  private downKey = '';
  private downId: string | null = null;
  private openingKey = '';
  private dragStart = { x: 0, y: 0 };
  private previous = { x: 0, y: 0, time: 0 };
  private distance = 0;
  private pinchDistance = 0;
  private pinchWorld = { x: 0, y: 0 };
  private raf = 0;
  private focusRaf = 0;
  private mediaTimer: number | undefined;
  private sceneDirty = true;
  private lastSignature = '';
  private lastRender = 0;
  private revision = 0;
  private appliedHover = '';
  private entranceStart = -Infinity;
  private sceneEntrance = 1;
  private reflowOrigins = new Map<string, CardPose>();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private enabled = true;
  private destroyed = false;
  private fallback = false;
  private focus?: FocusState;
  private pendingItems?: { items: MediaItem[]; scores?: Map<string, number> };
  private observer: ResizeObserver;

  constructor(host: HTMLElement, options: SpatialFieldOptions) {
    this.host = host;
    this.onOpen = options.onOpen;
    this.items = options.items;
    this.scores = options.scores;
    this.width = host.clientWidth;
    this.height = host.clientHeight;
    this.layout = computeMosaicLayout(this.items);
    this.layoutIndex = new SpatialIndex(this.layout.items);

    const first = this.layout.items[0];
    this.navigation = new CameraController({
      width: this.width,
      height: this.height,
      reduced: this.reduced,
      initial: { x: first?.x ?? 0, y: first?.y ?? 0, zoom: 1 },
    });

    this.canvas = document.createElement('canvas');
    this.labels = document.createElement('div');
    this.labelScene = document.createElement('div');
    this.focusLayer = document.createElement('div');
    this.canvas.className = 'field-canvas';
    this.labels.className = 'field-labels';
    this.labelScene.className = 'label-scene';
    this.focusLayer.className = 'atlas-focus-layer';
    this.labels.appendChild(this.labelScene);
    for (const element of [this.canvas, this.labels, this.focusLayer]) host.appendChild(element);

    this.media = new MediaPool({ onChange: this.wake, onFrame: this.wakeMedia });
    try {
      this.renderer = new GlassRenderer(this.canvas, { onContextLost: this.useFallback });
    } catch (error) {
      console.info('Atlas renderer uses the CSS fallback.', error);
      this.renderer = null;
    }
    this.fallback = !this.renderer;
    host.dataset.renderer = this.fallback ? 'css' : 'webgl2-instanced';
    host.classList.toggle('fallback', this.fallback);

    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    host.addEventListener('pointerdown', this.handleDown);
    host.addEventListener('pointermove', this.handleMove);
    host.addEventListener('pointerup', this.handleUp);
    host.addEventListener('pointercancel', this.handleCancel);
    host.addEventListener('pointerleave', this.handleLeave);
    host.addEventListener('wheel', this.handleWheel, { passive: false });
    this.labels.addEventListener('click', this.handleKeyClick);
    this.labels.addEventListener('focusin', this.handleFocusIn);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.resize();
    options.onReady?.(this);
    // Read-only inspection hook: lets the dev tools and the end-to-end tests
    // read the camera and the layout without reaching into React.
    (window as unknown as { __atlas?: SpatialField }).__atlas = this;
  }

  /** The live camera state (development aid and test hook). */
  get cameraState() {
    return {
      current: { ...this.navigation.current },
      target: { ...this.navigation.target },
      cardScale: this.navigation.cardScale,
      radius: this.navigation.camera.radius,
      perspective: this.navigation.camera.perspective,
      shift: this.navigation.camera.shift,
      layout: { width: this.layout.width, height: this.layout.height, rows: this.layout.rows },
      firstItem: this.layout.items[0]
        ? { id: this.layout.items[0].id, x: this.layout.items[0].x, y: this.layout.items[0].y }
        : null,
      firstItems: this.layout.items.slice(0, 8).map((item) => ({
        id: item.id,
        x: Math.round(item.x),
        y: Math.round(item.y),
        row: item.row,
      })),
      layoutItems: this.layout.items.map((item) => ({
        id: item.id,
        x: Math.round(item.x * 100) / 100,
        y: Math.round(item.y * 100) / 100,
        row: item.row,
      })),
    };
  }

  /** Whether the CSS fallback is active. */
  get isFallback(): boolean {
    return this.fallback;
  }

  private resize = () => {
    if (this.destroyed) return;
    const focused = this.focus && applyOrbit(this.focus.card, this.navigation.camera);
    const departing = this.focus?.departing.map((entry) => ({
      tile: entry,
      pose: applyOrbit(entry.node.card!, this.navigation.camera),
    }));
    const previousPerspective = this.navigation.camera.perspective;

    this.width = this.host.clientWidth;
    this.height = this.host.clientHeight;
    this.navigation.resize(this.width, this.height);
    this.renderer?.resize(this.width, this.height, Math.min(window.devicePixelRatio || 1, 1.5));
    this.labels.style.perspective = `${this.navigation.camera.perspective}px`;
    this.focusLayer.style.perspective = `${this.navigation.camera.perspective}px`;
    this.lastSignature = '';

    if (this.focus && focused) {
      const ratio = this.navigation.camera.perspective / previousPerspective;
      focused.z *= ratio;
      Object.assign(this.focus.card, applyInverseOrbit(focused, this.navigation.camera));
      this.focus.original = this.fieldCard(this.focus.node, this.focus.original);
      for (const entry of departing ?? []) {
        entry.pose.z *= ratio;
        Object.assign(entry.tile.node.card!, applyInverseOrbit(entry.pose, this.navigation.camera));
        entry.tile.original = this.fieldCard(entry.tile.node, entry.tile.original);
        entry.tile.from = { ...entry.tile.node.card!, shape: { ...entry.tile.node.card!.shape! } };
        entry.tile.start = performance.now();
      }
      const keep = new Set<PoolNode>([this.focus.node, ...this.focus.departing.map((entry) => entry.node)]);
      for (const node of this.pool.values()) {
        if (node.card && !keep.has(node)) this.restoreNode(node, this.fieldCard(node, node.card));
      }
      const camera = this.navigation.camera;
      this.labelScene.style.transform = `translateZ(${camera.shift}px) ${toCssMatrix3d(camera.orbit)}`;
      this.animateFocus(this.focus, this.focus.closing);
    }
    this.wake();
  };

  private useFallback = () => {
    this.fallback = true;
    this.host.dataset.renderer = 'css';
    this.host.classList.add('fallback');
    this.lastSignature = '';
    for (const node of this.pool.values()) node.button.style.setProperty('--card-scale', '1');
    this.wake();
  };

  /** Schedules a frame. */
  wake = () => {
    this.sceneDirty = true;
    if (this.destroyed || !this.enabled || document.hidden) return;
    clearTimeout(this.mediaTimer);
    this.mediaTimer = undefined;
    if (!this.raf && !this.focusRaf) this.raf = requestAnimationFrame(this.frame);
  };

  /** Schedules a frame for a media change (a video frame, an animated waveform). */
  wakeMedia = () => {
    if (
      this.destroyed ||
      !this.enabled ||
      document.hidden ||
      this.focusRaf ||
      this.raf ||
      this.mediaTimer !== undefined
    ) {
      return;
    }
    const wait = 1000 / 30 - (performance.now() - this.lastRender);
    if (wait <= 0) {
      this.raf = requestAnimationFrame(this.frame);
    } else {
      this.mediaTimer = window.setTimeout(() => {
        this.mediaTimer = undefined;
        if (!this.destroyed && this.enabled && !document.hidden && !this.focusRaf && !this.raf) {
          this.raf = requestAnimationFrame(this.frame);
        }
      }, wait);
    }
  };

  private cancelScheduled() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.mediaTimer);
    this.mediaTimer = undefined;
  }

  /** Creates the accessible DOM node of a card. */
  private makeButton(item: MediaItem, key: string): PoolNode {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'spatial-card';
    Object.assign(button.dataset, { id: item.id, key, type: item.type });
    button.style.width = 'var(--tile-width, 656px)';
    button.style.height = 'var(--tile-height, 492px)';
    button.style.padding = 'calc(var(--tile-width, 656px) * .07)';
    button.style.borderRadius = 'calc(var(--tile-width, 656px) * .163)';
    button.setAttribute('aria-label', `Open ${item.title}, ${item.type}`);

    const still = item.thumbnail ?? item.poster ?? (item.type === 'image' ? item.src : undefined);
    if (still) button.style.setProperty('--card-image', `url(${JSON.stringify(still)})`);

    const bitmap = document.createElement('canvas');
    bitmap.className = 'tile-bitmap';
    bitmap.setAttribute('aria-hidden', 'true');
    bitmap.hidden = true;
    button.appendChild(bitmap);

    if (item.type === 'text') {
      const bottom = document.createElement('div');
      bottom.className = 'card-bottom';
      const paragraph = document.createElement('p');
      paragraph.textContent = (item as { text?: string }).text ?? '';
      bottom.appendChild(paragraph);
      button.appendChild(bottom);
    }

    if (item.type === 'audio' || item.type === 'video') {
      const meta = document.createElement('div');
      meta.className = 'media-card-meta';
      const kind = document.createElement('span');
      kind.className = 'media-card-kind';
      kind.textContent = item.type === 'audio' ? 'Audio' : 'Video';
      const duration = document.createElement('span');
      duration.className = 'media-card-duration';
      duration.textContent = item.duration ?? '';
      meta.append(kind, duration);
      button.appendChild(meta);
      if (item.type === 'audio') {
        const status = document.createElement('span');
        status.className = 'audio-card-status';
        const waveformStatus = (item as { waveformStatus?: string }).waveformStatus;
        status.textContent =
          waveformStatus === 'loading' ? 'Reading waveform…' : waveformStatus === 'unavailable' ? 'Audio' : '';
        button.appendChild(status);
      }
    }

    const score = document.createElement('span');
    score.className = 'tile-similarity';
    const value = this.scores?.get(item.id);
    score.hidden = value === undefined || !Number.isFinite(value);
    const label = document.createElement('span');
    label.className = 'tile-similarity-label';
    label.textContent = 'Relevance ';
    const number = document.createElement('span');
    number.textContent = value === undefined ? '' : value.toFixed(3);
    score.append(label, number);
    button.appendChild(score);

    this.labelScene.appendChild(button);
    const node: PoolNode = { item, button, canvas: bitmap, painted: '', score, scoreValue: number, similarity: value };
    this.pool.set(key, node);
    return node;
  }

  private frame = (time: number) => {
    this.raf = 0;
    if (this.destroyed || !this.enabled || document.hidden) return;
    if (this.focus) {
      this.renderFocus(this.focus);
      this.lastRender = time;
      return;
    }
    if (!this.sceneDirty) {
      this.renderMedia();
      this.lastRender = time;
      return;
    }
    this.sceneDirty = false;

    const moving = this.navigation.step(time, this.pointers.size > 0);
    const current = this.navigation.current;
    const camera = this.navigation.camera;
    this.labelScene.style.transform = `translateZ(${camera.shift}px) ${toCssMatrix3d(camera.orbit)}`;

    const entrance = this.reduced ? 1 : clamp((time - this.entranceStart) / ENTRANCE_DURATION, 0, 1);
    const signature = [
      current.x.toFixed(3),
      current.y.toFixed(3),
      current.zoom.toFixed(5),
      this.revision,
      this.width,
      this.height,
      entrance.toFixed(5),
    ].join('|');
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.buildScene(entrance);
    }
    this.updateHover();
    this.renderMedia();
    this.lastRender = time;
    if (moving || entrance < 1) this.wake();
  };

  /** The layout for the current state: the spiral layout when there are scores. */
  private makeCurrentLayout(): MosaicLayout {
    const scores = this.scores;
    return scores
      ? computeResultLayout(
          [...this.items].sort((a, b) => (scores.get(b.id) ?? -Infinity) - (scores.get(a.id) ?? -Infinity)),
        )
      : computeMosaicLayout(this.items);
  }

  /** Rebuilds the visible card set. */
  private buildScene(entrance: number) {
    this.sceneEntrance = entrance;
    const current = this.navigation.current;
    const scale = current.zoom * this.navigation.cardScale;
    const layout = this.layout;
    const used = new Set<string>();
    const cards: CardPose[] = [];
    const nearest = new Map<string, { item: MediaItem; distance: number }>();

    this.cachedItems.clear();
    const cardSize = 656 * scale;
    const columns = layout.items.length ? Math.ceil(this.width / (scale * layout.width) / 2) + 1 : -1;
    const rows = layout.items.length ? Math.ceil(this.height / (scale * layout.height) / 2) + 1 : -1;
    const columnOffset = Math.round(current.x / layout.width);
    const rowOffset = Math.round(current.y / layout.height);

    this.labels.classList.toggle('compact-labels', current.zoom < 0.46);
    this.labels.classList.toggle('micro-labels', current.zoom < 0.28);

    for (let row = rowOffset - rows; row <= rowOffset + rows; row++) {
      for (let column = columnOffset - columns; column <= columnOffset + columns; column++) {
        const viewport = {
          left: current.x - column * layout.width - (this.width / 2 + cardSize) / scale,
          right: current.x - column * layout.width + (this.width / 2 + cardSize) / scale,
          top: current.y - row * layout.height - (this.height / 2 + cardSize) / scale,
          bottom: current.y - row * layout.height + (this.height / 2 + cardSize) / scale,
        };
        for (const rank of this.layoutIndex.query(viewport)) {
          const placed = layout.items[rank];
          const x = (placed.x + column * layout.width - current.x) * scale;
          const y = (placed.y + row * layout.height - current.y) * scale;
          const w = placed.w * scale;
          const h = placed.h * scale;
          const distance = x * x + y * y;
          if (Math.abs(x) > this.width / 2 + cardSize + w / 2) continue;
          if (Math.abs(y) > this.height / 2 + cardSize + h / 2) continue;
          if (cards.length >= 1000) continue;

          const key = mediaKey(placed.item);
          const existing = nearest.get(key);
          if (!existing || distance < existing.distance) nearest.set(key, { item: placed.item, distance });

          const instanceKey = `${placed.id}:${column}:${row}`;
          const node = this.pool.get(instanceKey) ?? this.makeButton(placed.item, instanceKey);
          used.add(instanceKey);
          node.item = placed.item;

          const pose = spherePlacement(x, y, this.navigation.camera.radius);
          const origin = this.reflowOrigins.get(instanceKey);
          const card = this.applyEntrance(
            {
              id: key,
              instanceKey,
              x: pose.position[0],
              y: pose.position[1],
              z: pose.position[2],
              w,
              h,
              q: pose.q,
              opacity: 1,
              depthWrite: entrance >= 1,
              hover: +(instanceKey === this.hoverKey && !this.pointers.size),
              dispersion: placed.item.type === 'audio' ? 0.12 : 1,
              shape: cardShape(w, h),
              sphereRadius: this.navigation.camera.radius,
            },
            placed.item.id,
            rank,
            entrance,
            this.width,
            this.height,
            origin,
          );
          this.updateSimilarity(node);
          cards.push(this.updateFieldNode(node, card));
          this.cachedItems.set(key, placed.item);
        }
      }
    }

    for (const [key, node] of this.pool) {
      if (used.has(key)) continue;
      const origin = this.reflowOrigins.get(key);
      const departure =
        origin && entrance < 1
          ? departureTransform(node.item.id, entrance, origin.x, origin.y, this.width, this.height)
          : undefined;
      const originOpacity = origin?.opacity ?? 1;
      if (origin && departure && originOpacity * departure.opacity > 0.001 && cards.length < 1000) {
        const card: CardPose = {
          ...origin,
          x: origin.x + departure.x,
          y: origin.y + departure.y,
          z: origin.z + departure.z,
          w: origin.w * departure.scale,
          h: origin.h * departure.scale,
          opacity: originOpacity * departure.opacity,
          depthWrite: false,
          hover: 0,
        };
        card.shape = cardShape(card.w, card.h);
        cards.push(this.updateFieldNode(node, card, true));
        this.cachedItems.set(card.id!, node.item);
        nearest.set(card.id!, { item: node.item, distance: card.x ** 2 + card.y ** 2 });
      } else {
        node.button.remove();
        this.pool.delete(key);
      }
    }
    if (entrance >= 1) this.reflowOrigins.clear();
    this.cachedCards = cards;

    const ordered = Array.from(nearest.values()).sort((a, b) => a.distance - b.distance);
    this.protectedMedia = ordered.map((entry) => entry.item);
    this.reconcileVisibility(true);
    const visibleKeys = new Set(this.visibleMedia.map((entry) => mediaKey(entry.item)));
    for (const { item } of ordered.slice(0, 48)) {
      this.media.load(item, visibleKeys.has(mediaKey(item)) ? 3 : 1);
    }
  }

  /** Applies the entrance (or reflow) transform to a card. */
  private applyEntrance(
    card: CardPose,
    id: string,
    index: number,
    entrance: number,
    width: number,
    height: number,
    origin?: CardPose,
  ): CardPose {
    if (entrance >= 1) return card;
    if (origin) {
      const eased = smootherstep(entrance);
      const mixed = interpolateCard(origin, card, eased);
      return {
        ...card,
        ...mixed,
        opacity: (origin.opacity ?? 1) + (1 - (origin.opacity ?? 1)) * eased,
        shape: cardShape(mixed.w, mixed.h),
      };
    }
    const transform = entranceTransform(id, index, entrance, width, height);
    const w = card.w * transform.scale;
    const h = card.h * transform.scale;
    return {
      ...card,
      x: card.x + transform.x,
      y: card.y - transform.y,
      z: card.z + transform.z,
      w,
      h,
      opacity: transform.opacity,
      shape: cardShape(w, h),
    };
  }

  private updateHover() {
    const key = this.pointers.size ? '' : this.hoverKey;
    if (key !== this.appliedHover) {
      const previous = this.pool.get(this.appliedHover);
      previous?.button.classList.remove('hovered');
      if (previous?.card) previous.card.hover = 0;
      this.appliedHover = key;
    }
    const node = this.pool.get(key);
    if (!node?.card) return;
    node.button.classList.add('hovered');
    node.button.style.setProperty('--card-scale', String(this.fallback ? 1 : node.card.w / 656));
    node.card.hover = 1;
  }

  private cancelDetailPrefetch() {
    clearTimeout(this.detailTimer);
    this.detailTimer = undefined;
  }

  private prefetchHoveredDetail(key: string) {
    this.cancelDetailPrefetch();
    const node = this.pool.get(key);
    if (node?.item.type !== 'image') return;
    if (this.media.getDetail(node.item)) return;
    this.detailTimer = window.setTimeout(() => {
      this.detailTimer = undefined;
      if (
        !this.destroyed &&
        this.enabled &&
        !document.hidden &&
        !this.focus &&
        !this.pointers.size &&
        this.hoverKey === key &&
        node.interactive
      ) {
        this.media.preloadDetail(node.item, 1);
      }
    }, 100);
  }

  /** Projects a card into screen space. */
  private projectCard(card: CardPose): { left: number; top: number; right: number; bottom: number } | null {
    const rotation = quaternionToMatrix(card.q);
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const x of [-card.w / 2, card.w / 2]) {
      for (const y of [-card.h / 2, card.h / 2]) {
        const rotated = multiplyMat3(rotation, [x, y, 0]);
        const point = projectToScreen(
          [card.x + rotated[0], card.y + rotated[1], card.z + rotated[2]],
          this.navigation.camera,
          this.width,
          this.height,
        );
        if (point.depth < 1) return null;
        bounds.left = Math.min(bounds.left, point.x);
        bounds.right = Math.max(bounds.right, point.x);
        bounds.top = Math.min(bounds.top, point.y);
        bounds.bottom = Math.max(bounds.bottom, point.y);
      }
    }
    return bounds;
  }

  /** Recomputes the set of visible media. */
  private reconcileVisibility(force = false) {
    const camera = this.navigation.camera;
    const signature = [this.width, this.height, camera.shift, ...camera.orbit].join('|');
    if (!force && signature === this.visibilityCamera) return;
    this.visibilityCamera = signature;

    const nearest = new Map<string, { item: MediaItem; distance: number }>();
    for (const card of this.cachedCards) {
      const bounds = this.projectCard(card);
      if (
        !bounds ||
        bounds.right <= 0 ||
        bounds.left >= this.width ||
        bounds.bottom <= 0 ||
        bounds.top >= this.height
      ) {
        continue;
      }
      const item = this.cachedItems.get(card.id!);
      if (!item) continue;
      const point = projectToScreen([card.x, card.y, card.z], camera, this.width, this.height);
      const distance = (point.x - this.width / 2) ** 2 + (point.y - this.height / 2) ** 2;
      const existing = nearest.get(card.id!);
      if (!existing || distance < existing.distance) nearest.set(card.id!, { item, distance });
    }
    this.visibleMedia = Array.from(nearest.values()).sort((a, b) => a.distance - b.distance);

    const next = JSON.stringify([
      this.visibleMedia.map((entry) => mediaKey(entry.item)),
      this.protectedMedia.map((item) => mediaKey(item)).sort(),
      this.enabled && !this.focus && !document.hidden,
    ]);
    if (next !== this.visibleSignature) {
      this.visibleSignature = next;
      this.media.updateVisible(this.visibleMedia, {
        active: this.enabled && !this.focus && !document.hidden,
        protected: this.protectedMedia,
      });
    }
  }

  /** Feeds the renderer with the current bitmaps. */
  private renderMedia() {
    this.reconcileVisibility();
    const entries = new Map<string, ReturnType<MediaPool['load']>>();
    for (const card of this.cachedCards) {
      let entry = entries.get(card.id!);
      if (!entry) {
        const item = this.cachedItems.get(card.id!);
        if (!item) continue;
        entry = this.media.load(item, 1);
        entries.set(card.id!, entry);
      }
      card.source = MediaPool.source(entry);
      card.sourceVersion = MediaPool.sourceVersion(entry);
      card.aspect = MediaPool.aspect(entry);
    }

    if (!this.fallback && this.renderer) {
      const camera = this.navigation.camera;
      const needsDepthSort =
        performance.now() - this.entranceStart < 1100 ||
        this.cachedCards.some((card) => (card.opacity ?? 1) < 1 || card.depthWrite === false);
      const ordered = needsDepthSort
        ? [...this.cachedCards]
            .map((card) => ({
              card,
              depth: camera.orbit[2] * card.x + camera.orbit[5] * card.y + camera.orbit[8] * card.z,
            }))
            .sort((a, b) => a.depth - b.depth || (a.card.instanceKey ?? '').localeCompare(b.card.instanceKey ?? ''))
            .map((entry) => entry.card)
        : this.cachedCards;
      this.renderer.render(ordered as RendererCard[], camera, this.width, this.height);
    }

    if (this.fallback) {
      let painted = 0;
      for (const node of this.pool.values()) {
        const entry = entries.get(mediaKey(node.item));
        const source = MediaPool.source(entry);
        if (
          !source ||
          !(source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement) ||
          painted++ >= 24
        ) {
          node.canvas.hidden = true;
          continue;
        }
        this.paintBitmap(node, source, MediaPool.sourceVersion(entry));
      }
    }

    for (const node of this.pool.values()) {
      if (node.item.type !== 'video') continue;
      const video = entries.get(mediaKey(node.item))?.video;
      const state = String(!!video && !video.paused && !video.ended);
      if (node.button.dataset.playing !== state) node.button.dataset.playing = state;
    }
  }

  /** Paints a card bitmap into the DOM canvas (CSS fallback). */
  private paintBitmap(node: PoolNode, source: CanvasImageSource, version: string) {
    const ratio = (node.card?.w ?? 656) / (node.card?.h ?? 492);
    const presenting = node.button.dataset.presenting === 'true';
    const isImage = source instanceof HTMLImageElement;
    const bounds = presenting && node.card ? this.projectCard(node.card) : undefined;
    const scale = presenting ? Math.min(window.devicePixelRatio || 1, isImage ? 2 : 1.5) : 1;
    const targetWidth = Math.max(32, Math.round((bounds ? bounds.right - bounds.left : (node.card?.w ?? 656)) * scale));
    const maxWidth = presenting ? (isImage ? 4096 : 2048) : 656;
    const fit = Math.min(1, maxWidth / Math.max(targetWidth, targetWidth / ratio));
    const width = Math.max(1, Math.round(targetWidth * fit));
    const height = Math.max(1, Math.round(width / ratio));
    const signature = `${version}:${width}:${height}`;
    node.canvas.hidden = false;
    if (node.painted === signature) return;
    node.painted = signature;
    const canvas = node.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    const sized = source as HTMLVideoElement & HTMLImageElement & HTMLCanvasElement;
    const sourceWidth =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : source instanceof HTMLImageElement
          ? source.naturalWidth
          : sized.width;
    const sourceHeight =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : source instanceof HTMLImageElement
          ? source.naturalHeight
          : sized.height;
    let drawWidth = sourceWidth;
    let drawHeight = sourceHeight;
    if (drawWidth / drawHeight > width / height) drawWidth = drawHeight * (width / height);
    else drawHeight = drawWidth * (height / width);
    try {
      context.drawImage(
        source,
        (sourceWidth - drawWidth) / 2,
        (sourceHeight - drawHeight) / 2,
        drawWidth,
        drawHeight,
        0,
        0,
        width,
        height,
      );
    } catch {
      /* the frame could not be read */
    }
  }

  /** Replaces the item set (e.g. after a search). */
  setItems(items: MediaItem[], scores?: Map<string, number>) {
    if (this.destroyed) return;
    const unchanged =
      scores === this.scores ||
      (scores &&
        this.scores &&
        scores.size === this.scores.size &&
        Array.from(scores).every(([id, value]) => this.scores!.get(id) === value));
    const sameItems =
      items.length === this.items.length &&
      items.every((item, index) => {
        const previous = this.items[index];
        return (
          item.id === previous.id &&
          item.type === previous.type &&
          item.src === previous.src &&
          item.thumbnail === previous.thumbnail &&
          item.poster === previous.poster &&
          item.aspectRatio === previous.aspectRatio
        );
      });
    if (unchanged && sameItems) {
      items.forEach((item, index) => {
        if (item !== this.items[index]) this.updateItemMetadata(item);
      });
      this.items = items;
      this.scores = scores;
      return;
    }

    if (this.focus) {
      const current = items.find((item) => item.id === this.focus!.item.id);
      if (current && current !== this.focus.item) this.updateItemMetadata(current);
      this.pendingItems = { items, scores };
      return;
    }

    this.cancelDetailPrefetch();
    this.reflowOrigins.clear();
    if (!this.reduced) {
      for (const [key, node] of this.pool) {
        if (node.card) this.reflowOrigins.set(key, { ...node.card, shape: { ...node.card.shape! } });
      }
    }

    this.entranceStart = this.reduced ? -Infinity : performance.now();
    this.items = items;
    this.scores = scores;
    this.revision++;
    this.layout = this.makeCurrentLayout();
    this.layoutIndex = new SpatialIndex(this.layout.items);
    this.pool.get(this.appliedHover)?.button.classList.remove('hovered');
    this.appliedHover = this.hoverKey = this.downKey = '';
    this.navigation.stop();

    if (scores?.size && items.length) {
      this.frameResults();
    } else {
      const first = this.layout.items[0];
      this.navigation.reset({ x: first?.x ?? 0, y: first?.y ?? 0, zoom: 1 });
    }
    this.wake();
  }

  private updateSimilarity(node: PoolNode) {
    const score = this.scores?.get(node.item.id);
    if (score === node.similarity) return;
    node.similarity = score;
    node.score.hidden = score === undefined || !Number.isFinite(score);
    node.scoreValue.textContent = score === undefined ? '' : score.toFixed(3);
  }

  private updateFieldNode(node: PoolNode, card: CardPose, departing = false): CardPose {
    const button = node.button;
    if (departing) button.dataset.departing = 'true';
    else delete button.dataset.departing;
    button.inert = departing;
    if (node.opacity !== card.opacity) {
      button.style.opacity = String(card.opacity);
      node.opacity = card.opacity;
    }
    const interactive = !departing && (card.opacity ?? 1) > 0.8;
    if (node.interactive !== interactive) {
      button.tabIndex = interactive ? 0 : -1;
      button.disabled = !interactive;
      node.interactive = interactive;
    }
    this.placeFieldNode(node, card);
    node.card = Object.assign(node.card ?? {}, card);
    return node.card;
  }

  private updateItemMetadata(item: MediaItem) {
    this.media.updateItem(item);
    for (const entry of this.layout.items) if (entry.item.id === item.id) entry.item = item;
    for (const entry of this.visibleMedia) if (entry.item.id === item.id) entry.item = item;
    this.protectedMedia = this.protectedMedia.map((entry) => (entry.id === item.id ? item : entry));
    for (const [key, value] of this.cachedItems) if (value.id === item.id) this.cachedItems.set(key, item);
    for (const node of this.pool.values()) {
      if (node.item.id !== item.id) continue;
      node.item = item;
      node.button.setAttribute('aria-label', `Open ${item.title}, ${item.type}`);
      const paragraph = node.button.querySelector('.card-bottom p');
      const duration = node.button.querySelector('.media-card-duration');
      const status = node.button.querySelector('.audio-card-status');
      if (paragraph) paragraph.textContent = (item as { text?: string }).text ?? '';
      if (duration) duration.textContent = item.duration ?? '';
      if (status) {
        const waveformStatus = (item as { waveformStatus?: string }).waveformStatus;
        status.textContent =
          waveformStatus === 'loading' ? 'Reading waveform…' : waveformStatus === 'unavailable' ? 'Audio' : '';
      }
    }
    if (this.focus?.item.id === item.id) {
      this.focus.item = item;
      this.focusLayer.setAttribute('aria-label', item.title);
    }
    this.wake();
  }

  /**
   * Picks how many of the top results to frame, using the score distribution
   * (the "elbow" of the curve). Port of `xt`.
   */
  private pickResultCount(scores: number[]): number | null {
    const finite = scores.filter(Number.isFinite).sort((a, b) => b - a);
    if (!finite.length) return null;
    if (finite.length === 1) return 1;
    const middle = finite.slice(Math.floor(finite.length / 2));
    const midIndex = Math.floor(middle.length / 2);
    const median = middle.length % 2 ? middle[midIndex] : (middle[midIndex - 1] + middle[midIndex]) / 2;
    const spread = finite[0] - median;
    if (spread < 0.08) return null;
    const gaps = finite.slice(0, Math.min(6, finite.length - 1)).map((value, index) => value - finite[index + 1]);
    const threshold = Math.max(0.035, spread * 0.25, Math.max(...gaps) * 0.9);
    const index = gaps.findIndex((gap) => gap >= threshold - 1e-9);
    return index < 0 ? null : index + 1;
  }

  /** Frames the best search results in the viewport. */
  private frameResults() {
    const count =
      this.pickResultCount(this.items.map((item) => this.scores?.get(item.id) ?? NaN)) ??
      Math.min(this.width < 650 ? 4 : 6, this.items.length);
    const targets = this.layout.items.slice(0, Math.max(1, count));
    if (!targets.length) return;
    const originX = targets[0].x;
    const originY = targets[0].y;
    const cardScale = this.navigation.cardScale;
    const camera = this.navigation.camera;
    const marginX = this.width < 650 ? 24 : 50;
    const marginTop = this.width < 650 ? 100 : 96;
    const marginBottom = this.height - (this.width < 650 ? 124 : 112);

    const solve = (zoom: number): number | null => {
      const y = originY - (marginTop + marginBottom) / 2 / (zoom * cardScale) + this.height / 2 / (zoom * cardScale);
      for (const target of targets) {
        const pose = spherePlacement(
          (target.x - originX) * zoom * cardScale,
          (target.y - y) * zoom * cardScale,
          camera.radius,
        );
        const bounds = this.projectCard({
          id: target.id,
          x: pose.position[0],
          y: pose.position[1],
          z: pose.position[2],
          w: target.w * zoom * cardScale,
          h: target.h * zoom * cardScale,
          q: pose.q,
          opacity: 1,
          hover: 0,
        });
        if (!bounds || bounds.left < marginX || bounds.right > this.width - marginX) return null;
        if (bounds.top < marginTop || bounds.bottom > marginBottom) return null;
      }
      return y;
    };

    let low = MIN_ZOOM;
    let high = MAX_ZOOM;
    let best = solve(low) ?? originY;
    for (let i = 0; i < 22; i++) {
      const middle = (low + high) / 2;
      const result = solve(middle);
      if (result === null) high = middle;
      else {
        low = middle;
        best = result;
      }
    }
    this.navigation.setView({ x: originX, y: best, zoom: low });
  }

  /** Enables or disables the interaction. */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.cancelPointers();
    this.media.updateVisible(this.visibleMedia, {
      active: enabled && !this.focus && !document.hidden,
      protected: this.protectedMedia,
    });
    if (enabled) this.wake();
    else this.cancelScheduled();
  }

  /** Resets the view. */
  reset() {
    if (this.focus) return;
    const first = this.layout.items[0];
    this.navigation.reset({ x: first?.x ?? 0, y: first?.y ?? 0, zoom: 1 });
    this.wake();
  }

  /** Zooms by a factor around the viewport centre. */
  zoomBy(factor: number, x = 0, y = 0) {
    if (this.focus) return;
    this.navigation.zoomAt(this.navigation.target.zoom * factor, x, y);
    this.wake();
  }

  /** Pans by a screen-space delta. */
  panBy(dx: number, dy: number) {
    if (this.focus) return;
    this.navigation.panBy(dx, dy);
    this.wake();
  }

  /** Opens a card in the presentation viewer. */
  open(item: MediaItem): HTMLElement {
    this.cancelDetailPrefetch();
    this.media.preloadDetail(item, 4);
    const current = this.focus;
    if (current?.item.id === item.id && !current.closing) return current.viewer;

    const node = this.focusNode(item);
    if (current?.node === node) {
      current.closing = false;
      current.done = undefined;
      this.media.focus(item);
      this.animateFocus(current, false);
      return current.viewer;
    }

    const departingEntry = current?.departing.find((entry) => entry.node === node);
    const original: CardPose = departingEntry?.original ?? { ...node.card!, shape: { ...node.card!.shape! } };
    if (departingEntry && current) current.departing.splice(current.departing.indexOf(departingEntry), 1);

    if (current) {
      current.departing.push({
        node: current.node,
        original: current.original,
        from: { ...current.card, shape: { ...current.card.shape! } },
        start: performance.now(),
      });
      current.item = item;
      current.node = node;
      current.card = node.card!;
      current.original = original;
      current.progress = 0;
      current.closing = false;
      current.done = undefined;
      this.presentNode(node, current.card);
      this.media.focus(item);
      this.focusLayer.setAttribute('aria-label', item.title);
      this.animateFocus(current, false);
      return current.viewer;
    }

    this.navigation.stop();
    Object.assign(this.navigation.target, this.navigation.current);
    this.cancelPointers();
    this.cancelScheduled();
    this.media.focus(item);
    this.labels.inert = true;
    this.labels.setAttribute('aria-hidden', 'true');
    this.focusLayer.style.perspective = `${this.navigation.camera.perspective}px`;
    this.focusLayer.setAttribute('role', 'dialog');
    this.focusLayer.setAttribute('aria-modal', 'true');
    this.focusLayer.setAttribute('aria-label', item.title);

    const viewer = document.createElement('div');
    viewer.className = 'tile-viewer-host';
    this.focusLayer.appendChild(viewer);

    const shape = original.shape!;
    const focus: FocusState = {
      item,
      node,
      card: node.card!,
      original,
      viewer,
      progress: 0,
      dimProgress: 0,
      fromDimProgress: 0,
      toDimProgress: 1,
      entrance: this.sceneEntrance,
      closing: false,
      from: original,
      to: original,
      fromShape: shape,
      toShape: shape,
      fromProgress: 0,
      toProgress: 1,
      fromOpacity: original.opacity ?? 1,
      toOpacity: 1,
      fromLens: original.lens ?? 1,
      toLens: 0,
      start: 0,
      duration: 0,
      departing: [],
    };
    this.focus = focus;
    this.openingKey = '';
    this.presentNode(node, focus.card);
    this.animateFocus(focus, false);
    return viewer;
  }

  /** Finds (or creates) the DOM node of a card. */
  private focusNode(item: MediaItem): PoolNode {
    const opening = this.pool.get(this.openingKey);
    if (opening?.item.id === item.id && opening.card) return opening;
    const departing = this.focus?.departing.findLast((entry) => entry.node.item.id === item.id);
    if (departing) return departing.node;

    let best: PoolNode | undefined;
    let bestDistance = Infinity;
    for (const node of this.pool.values()) {
      if (node.item.id !== item.id || !node.card) continue;
      const bounds = this.projectCard(node.card);
      if (!bounds) continue;
      const distance = Math.hypot(
        (bounds.left + bounds.right - this.width) / 2,
        (bounds.top + bounds.bottom - this.height) / 2,
      );
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    if (best) return best;

    const placed = this.layout.items.find((entry) => entry.id === item.id);
    const current = this.navigation.current;
    const scale = current.zoom * this.navigation.cardScale;
    const column = Math.round((current.x - (placed?.x ?? 0)) / this.layout.width);
    const row = Math.round((current.y - (placed?.y ?? 0)) / this.layout.height);
    const key = `${item.id}:${column}:${row}`;
    const node = this.pool.get(key) ?? this.makeButton(item, key);
    const width = placed?.w ?? 656;
    const height = placed?.h ?? width / (item.aspectRatio ?? 4 / 3);
    const pose = spherePlacement(
      ((placed?.x ?? 0) + column * this.layout.width - current.x) * scale,
      ((placed?.y ?? 0) + row * this.layout.height - current.y) * scale,
      this.navigation.camera.radius,
    );
    const card: CardPose = {
      id: mediaKey(item),
      instanceKey: key,
      x: pose.position[0],
      y: pose.position[1],
      z: pose.position[2],
      w: width * scale,
      h: height * scale,
      q: pose.q,
      opacity: 1,
      hover: 0,
      sphereRadius: this.navigation.camera.radius,
      shape: cardShape(width * scale, height * scale),
    };
    node.card = card;
    this.cachedCards.push(card);
    this.cachedItems.set(card.id!, item);
    return node;
  }

  /** Moves a card into the focus layer. */
  private presentNode(node: PoolNode, card: CardPose) {
    if (node.button.parentElement !== this.focusLayer) this.focusLayer.appendChild(node.button);
    const camera = this.navigation.camera;
    const world = multiplyMat3(camera.orbit, [card.x, card.y, card.z]);
    world[2] += camera.shift;
    const rotation = rotateQuaternion(camera.orbit, quaternionToMatrix(card.q));
    node.button.dataset.presenting = 'true';
    node.button.inert = true;
    node.button.setAttribute('aria-hidden', 'true');
    node.button.style.setProperty('--tile-width', `${card.w}px`);
    node.button.style.height = `${card.h}px`;
    node.button.style.setProperty('--tile-label-opacity', '0');
    node.button.style.setProperty('--tile-lens', String(card.lens ?? 1));
    node.button.style.transform = `translate3d(calc(-50% + ${world[0]}px),calc(-50% + ${world[1]}px),${world[2]}px) ${toCssMatrix3d(rotation)}`;
    node.button.style.borderRadius = `${card.shape?.radius ?? card.w * 0.163}px`;
    node.button.style.opacity = String(card.opacity);
    node.button.style.setProperty('--card-scale', '1');
  }

  /** Moves a card back into the field. */
  private restoreNode(node: PoolNode, card: CardPose) {
    Object.assign(node.card!, card);
    node.card!.focused = false;
    node.card!.lens = card.lens;
    this.labelScene.appendChild(node.button);
    delete node.button.dataset.presenting;
    node.button.inert = false;
    node.button.removeAttribute('aria-hidden');
    node.button.style.removeProperty('--tile-label-opacity');
    node.button.style.removeProperty('--tile-lens');
    node.button.style.height = 'var(--tile-height, 492px)';
    node.button.style.opacity = String(card.opacity);
    node.opacity = card.opacity;
    node.cssWidth = node.cssHeight = undefined;
    this.placeFieldNode(node, card);
  }

  private placeFieldNode(node: PoolNode, card: CardPose) {
    const width = this.fallback ? card.w : 656;
    const height = (width * card.h) / card.w;
    const changed = node.cssWidth !== width || node.cssHeight !== height;
    if (node.cssWidth !== width) {
      node.button.style.setProperty('--tile-width', `${width}px`);
      node.cssWidth = width;
    }
    if (node.cssHeight !== height) {
      node.button.style.setProperty('--tile-height', `${height}px`);
      node.cssHeight = height;
    }
    node.button.style.transform = `translate3d(${card.x - width / 2}px,${card.y - height / 2}px,${card.z}px) ${toCssMatrix3d(
      quaternionToMatrix(card.q),
    )} scale(${card.w / width})`;
    if (changed) node.button.style.borderRadius = `${cardShape(width, height).radius}px`;
  }

  /** Recomputes the field pose of a card. */
  private fieldCard(node: PoolNode, card: CardPose): CardPose {
    const index = this.layout.items.findIndex((entry) => entry.id === node.item.id);
    const placed = this.layout.items[index];
    if (!placed) return card;
    const parts = (node.button.dataset.key ?? '').split(':');
    const row = Number(parts.pop());
    const column = Number(parts.pop());
    const current = this.navigation.current;
    const scale = current.zoom * this.navigation.cardScale;
    const pose = spherePlacement(
      (placed.x + column * this.layout.width - current.x) * scale,
      (placed.y + row * this.layout.height - current.y) * scale,
      this.navigation.camera.radius,
    );
    const entrance = this.focus?.entrance ?? 1;
    const w = placed.w * scale;
    const h = placed.h * scale;
    return this.applyEntrance(
      {
        ...card,
        x: pose.position[0],
        y: pose.position[1],
        z: pose.position[2],
        w,
        h,
        q: pose.q,
        sphereRadius: this.navigation.camera.radius,
        shape: cardShape(w, h),
        opacity: 1,
        focused: false,
      },
      node.item.id,
      index,
      entrance,
      this.width,
      this.height,
      this.reflowOrigins.get(node.button.dataset.key ?? ''),
    );
  }

  /** The video element of the focused video. */
  getFocusedVideo(item: MediaItem): HTMLVideoElement | undefined {
    return this.media.load(item, 4).video;
  }

  /** Updates the waveform progress of the focused audio. */
  setFocusedAudioProgress(item: MediaItem, time: number, duration: number) {
    this.media.setAudioProgress(item, time, duration);
  }

  /** Plays or pauses the focused media. */
  playFocused(playing: boolean) {
    this.media.setFocusedPlaying(playing);
  }

  /** True when a screen point is over the focused card. */
  containsFocusPoint(clientX: number, clientY: number): boolean {
    if (!this.focus) return false;
    const bounds = this.projectCard(this.focus.card);
    const rect = this.host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return !!bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }

  private animateFocus(focus: FocusState, closing: boolean) {
    cancelAnimationFrame(this.focusRaf);
    focus.from = { ...focus.card };
    focus.to = closing
      ? focus.original
      : focusTarget(
          this.navigation.camera,
          this.width,
          this.height,
          undefined,
          this.media.load(focus.item, 4).item.aspectRatio,
        );
    focus.fromShape = { ...focus.card.shape! };
    focus.toShape = closing ? focus.original.shape! : focusShape(this.navigation.camera, this.width < 650);
    focus.fromProgress = focus.progress;
    focus.toProgress = closing ? 0 : 1;
    focus.fromDimProgress = focus.dimProgress;
    focus.toDimProgress = closing ? 0 : 1;
    focus.fromOpacity = focus.card.opacity ?? 1;
    focus.toOpacity = closing ? (focus.original.opacity ?? 1) : 1;
    focus.fromLens = focus.card.lens ?? 1;
    focus.toLens = closing ? (focus.original.lens ?? 1) : 0;
    focus.start = performance.now();
    focus.duration = this.reduced ? 0 : closing ? 620 : 840;
    this.tickFocus(focus);
  }

  private tickFocus(focus: FocusState) {
    this.focusRaf = 0;
    if (this.destroyed || this.focus !== focus || document.hidden) return;
    const now = performance.now();
    const raw = focus.duration ? clamp((now - focus.start) / focus.duration, 0, 1) : 1;
    const progress = 1 - (1 - raw) ** 4;

    Object.assign(focus.card, interpolateCard(focus.from, focus.to, progress));
    focus.card.shape = this.interpolateShape(focus.fromShape, focus.toShape, progress);
    focus.card.opacity = focus.fromOpacity + (focus.toOpacity - focus.fromOpacity) * progress;

    const lensRaw = focus.closing ? clamp(raw / 0.45, 0, 1) : clamp((raw - 0.45) / 0.55, 0, 1);
    const lens = lensRaw * lensRaw * (3 - 2 * lensRaw);
    focus.card.lens = focus.fromLens + (focus.toLens - focus.fromLens) * lens;
    focus.progress = focus.fromProgress + (focus.toProgress - focus.fromProgress) * progress;
    focus.dimProgress = focus.fromDimProgress + (focus.toDimProgress - focus.fromDimProgress) * progress;

    for (const entry of [...focus.departing]) {
      const local = this.reduced ? 1 : clamp((now - entry.start) / 620, 0, 1);
      const eased = 1 - (1 - local) ** 4;
      Object.assign(entry.node.card!, interpolateCard(entry.from, entry.original, eased));
      entry.node.card!.shape = this.interpolateShape(entry.from.shape!, entry.original.shape!, eased);
      entry.node.card!.opacity =
        (entry.from.opacity ?? 1) +
        ((entry.original.opacity ?? 1) * (1 - focus.dimProgress) - (entry.from.opacity ?? 1)) * eased;
      entry.node.card!.lens = (entry.from.lens ?? 1) + ((entry.original.lens ?? 1) - (entry.from.lens ?? 1)) * eased;
      this.presentNode(entry.node, entry.node.card!);
      if (local >= 1) {
        this.restoreNode(entry.node, entry.original);
        focus.departing.splice(focus.departing.indexOf(entry), 1);
      }
    }

    this.presentNode(focus.node, focus.card);
    this.focusLayer.style.setProperty('--focus', String(focus.progress));
    this.labels.style.opacity = String(1 - focus.dimProgress);
    this.renderFocus(focus);
    this.lastRender = now;
    if (raw < 1 || focus.departing.length) {
      this.focusRaf = requestAnimationFrame(() => this.tickFocus(focus));
    } else if (focus.closing) {
      this.finishClose(focus);
    }
  }

  private interpolateShape(from: CardShape, to: CardShape, t: number): CardShape {
    return {
      radius: from.radius + (to.radius - from.radius) * t,
      bevel: from.bevel + (to.bevel - from.bevel) * t,
      thickness: from.thickness + (to.thickness - from.thickness) * t,
      rim: from.rim + (to.rim - from.rim) * t,
    };
  }

  private renderFocus(focus: FocusState) {
    const entry = this.media.load(focus.item, 4);
    const detail = this.media.getDetail(focus.item);
    const card = focus.card;
    card.source = detail ?? MediaPool.source(entry);
    card.sourceVersion = detail ? `${entry.key}:detail` : MediaPool.sourceVersion(entry);
    card.aspect =
      detail?.naturalWidth && detail?.naturalHeight
        ? detail.naturalWidth / detail.naturalHeight
        : MediaPool.aspect(entry);
    card.focused = true;

    const departing = new Set(focus.departing.map((entry) => entry.node.card));
    const camera = this.navigation.camera;
    const cards: CardPose[] =
      focus.dimProgress === 1 && !focus.departing.length
        ? [card]
        : this.cachedCards.map((entry) =>
            entry === card
              ? { ...entry, depthWrite: false }
              : {
                  ...entry,
                  opacity: (entry.opacity ?? 1) * (departing.has(entry) ? 1 : 1 - focus.dimProgress),
                  depthWrite: false,
                  focused: false,
                },
          );
    cards.sort(
      (a, b) =>
        camera.orbit[2] * (a.x - b.x) + camera.orbit[5] * (a.y - b.y) + camera.orbit[8] * (a.z - b.z) ||
        (a.instanceKey ?? '').localeCompare(b.instanceKey ?? ''),
    );

    if (!this.fallback && this.renderer) {
      this.renderer.render(cards as RendererCard[], camera, this.width, this.height);
    } else {
      const source = card.source;
      if (
        (source instanceof HTMLImageElement && detail) ||
        source instanceof HTMLVideoElement ||
        source instanceof HTMLCanvasElement
      ) {
        this.paintBitmap(focus.node, source, detail ? `${entry.key}:detail` : MediaPool.sourceVersion(entry));
      } else {
        focus.node.canvas.hidden = true;
      }
      for (const node of this.pool.values()) {
        if (node !== focus.node && !departing.has(node.card)) node.canvas.hidden = true;
      }
    }
  }

  /** Closes the presentation viewer. */
  close(done?: () => void) {
    const focus = this.focus;
    if (!focus) {
      done?.();
      return;
    }
    if (focus.closing) {
      if (done) focus.done = done;
      return;
    }
    focus.closing = true;
    focus.done = done;
    this.media.setFocusedPlaying(false);
    for (const element of focus.viewer.querySelectorAll('audio')) element.pause();
    this.animateFocus(focus, true);
  }

  private finishClose(focus: FocusState) {
    this.restoreNode(focus.node, focus.original);
    for (const entry of focus.departing) this.restoreNode(entry.node, entry.original);
    focus.viewer.remove();
    this.focusLayer.removeAttribute('role');
    this.focusLayer.removeAttribute('aria-modal');
    this.focusLayer.removeAttribute('aria-label');
    if (this.scores || this.reflowOrigins.size) {
      this.entranceStart = performance.now() - focus.entrance * ENTRANCE_DURATION;
    }
    this.labels.style.opacity = '1';
    this.labels.inert = false;
    this.labels.removeAttribute('aria-hidden');
    this.lastSignature = '';
    focus.node.button.focus({ preventScroll: true });
    this.focus = undefined;
    this.media.focus(null);
    const pending = this.pendingItems;
    this.pendingItems = undefined;
    if (pending) this.setItems(pending.items, pending.scores);
    this.wake();
    focus.done?.();
  }

  private localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.host.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private handleDown = (event: PointerEvent) => {
    if (!this.enabled || this.focus || event.button !== 0) return;
    const target = (event.target as HTMLElement | null)?.closest?.('.spatial-card') as HTMLElement | null;
    this.downId = target?.dataset.id ?? null;
    this.downKey = target?.dataset.key ?? '';
    this.cancelDetailPrefetch();
    const node = this.pool.get(this.downKey);
    if (node?.interactive && !this.pointers.size) this.media.preloadDetail(node.item, 4);
    event.preventDefault();
    this.host.setPointerCapture(event.pointerId);

    const point = this.localPoint(event);
    if (
      (this.pointers.set(event.pointerId, point),
      this.navigation.stop(),
      (this.dragStart = point),
      (this.previous = { ...point, time: performance.now() }),
      (this.distance = 0),
      this.pointers.size === 2)
    ) {
      const [first, second] = Array.from(this.pointers.values());
      this.pinchDistance = Math.hypot(first.x - second.x, first.y - second.y);
      this.navigation.zoomAt(
        this.navigation.target.zoom,
        (first.x + second.x) / 2 - this.width / 2,
        (first.y + second.y) / 2 - this.height / 2,
      );
      const anchor = this.navigation.anchor;
      this.pinchWorld = anchor
        ? { x: anchor.x, y: anchor.y }
        : { x: this.navigation.current.x, y: this.navigation.current.y };
    }
    this.host.classList.add('dragging');
    this.wake();
  };

  private handleMove = (event: PointerEvent) => {
    if (!this.enabled || this.focus) return;
    const point = this.localPoint(event);
    this.navigation.setOrbit(point.x, point.y);
    if (!this.pointers.has(event.pointerId)) {
      const target = (event.target as HTMLElement | null)?.closest?.('.spatial-card') as HTMLElement | null;
      const key = target?.dataset.key ?? '';
      if (key !== this.hoverKey) {
        this.hoverKey = key;
        if (event.pointerType !== 'touch') this.prefetchHoveredDetail(key);
        this.wake();
      }
      if (!this.reduced) this.wake();
      return;
    }
    this.pointers.set(event.pointerId, point);
    this.distance = Math.max(this.distance, Math.hypot(point.x - this.dragStart.x, point.y - this.dragStart.y));

    if (this.pointers.size === 2) {
      const [first, second] = Array.from(this.pointers.values());
      const span = Math.hypot(first.x - second.x, first.y - second.y);
      const centerX = (first.x + second.x) / 2 - this.width / 2;
      const centerY = (first.y + second.y) / 2 - this.height / 2;
      this.navigation.zoomAt((this.navigation.target.zoom * span) / Math.max(this.pinchDistance, 1), centerX, centerY);
      const anchor = this.navigation.anchor;
      if (anchor) {
        anchor.x = this.pinchWorld.x;
        anchor.y = this.pinchWorld.y;
        this.navigation.target.x = anchor.x - anchor.px / (this.navigation.target.zoom * this.navigation.cardScale);
        this.navigation.target.y = anchor.y - anchor.py / (this.navigation.target.zoom * this.navigation.cardScale);
      }
      this.pinchDistance = span;
      this.wake();
      return;
    }

    const now = performance.now();
    const elapsed = Math.max(8, now - this.previous.time);
    const scale = this.navigation.target.zoom * this.navigation.cardScale;
    const dx = (point.x - this.previous.x) / scale;
    const dy = (point.y - this.previous.y) / scale;
    this.navigation.target.x -= dx;
    this.navigation.target.y -= dy;
    this.navigation.velocity = { x: (-dx * 16.67) / elapsed, y: (-dy * 16.67) / elapsed };
    this.previous = { ...point, time: now };
    this.wake();
  };

  private handleUp = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return;
    const wasMultiTouch = this.pointers.size > 1;
    this.pointers.delete(event.pointerId);
    if (this.host.hasPointerCapture(event.pointerId)) this.host.releasePointerCapture(event.pointerId);
    if (wasMultiTouch) {
      this.downId = null;
      this.navigation.velocity = { x: 0, y: 0 };
      this.distance = 10;
      if (this.pointers.size) {
        const first = Array.from(this.pointers.values())[0];
        this.previous = { ...first, time: performance.now() };
      }
    }
    if (!this.pointers.size) {
      this.host.classList.remove('dragging');
      if (this.distance < 5 && this.downId !== null) {
        this.navigation.velocity = { x: 0, y: 0 };
        this.pool.get(this.downKey)?.button.focus({ preventScroll: true });
        const item = this.items.find((entry) => entry.id === this.downId);
        if (item) {
          this.openingKey = this.downKey;
          this.onOpen(item);
        }
      } else if (performance.now() - this.previous.time > 100) {
        this.navigation.velocity = { x: 0, y: 0 };
      }
      this.wake();
    }
  };

  private handleCancel = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    if (this.host.hasPointerCapture(event.pointerId)) this.host.releasePointerCapture(event.pointerId);
    this.downId = null;
    this.navigation.velocity = { x: 0, y: 0 };
    if (!this.pointers.size) this.host.classList.remove('dragging');
    this.wake();
  };

  private cancelPointers() {
    this.cancelDetailPrefetch();
    for (const id of this.pointers.keys()) {
      if (this.host.hasPointerCapture(id)) this.host.releasePointerCapture(id);
    }
    this.pointers.clear();
    this.downId = null;
    this.host.classList.remove('dragging');
    this.navigation.stop();
  }

  private handleWheel = (event: WheelEvent) => {
    if (!this.enabled || this.focus) return;
    this.cancelDetailPrefetch();
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
    if (event.shiftKey || (Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.3 && !event.ctrlKey)) {
      this.navigation.panBy(event.deltaX * unit, event.deltaY * unit);
    } else {
      const point = this.localPoint(event as unknown as PointerEvent);
      this.navigation.zoomAt(
        this.navigation.target.zoom * Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.012 : 0.0015)),
        point.x - this.width / 2,
        point.y - this.height / 2,
      );
    }
    this.wake();
  };

  private handleKeyClick = (event: MouseEvent) => {
    if (event.detail !== 0 || !this.enabled || this.focus) return;
    const target = (event.target as HTMLElement | null)?.closest?.('.spatial-card') as HTMLElement | null;
    const item = this.items.find((entry) => entry.id === target?.dataset.id);
    if (item) {
      this.openingKey = target?.dataset.key ?? '';
      this.onOpen(item);
    }
  };

  private handleFocusIn = (event: FocusEvent) => {
    if (!this.enabled || this.focus) return;
    const target = (event.target as HTMLElement | null)?.closest?.('.spatial-card') as HTMLElement | null;
    const node = this.pool.get(target?.dataset.key ?? '');
    if (node?.interactive) this.media.preloadDetail(node.item, 1);
  };

  private handleLeave = () => {
    this.cancelDetailPrefetch();
    this.hoverKey = '';
    this.navigation.setOrbit(this.width / 2, this.height / 2);
    this.wake();
  };

  private handleVisibility = () => {
    this.media.updateVisible(this.visibleMedia, {
      active: this.enabled && !this.focus && !document.hidden,
      protected: this.protectedMedia,
    });
    if (document.hidden) {
      this.cancelDetailPrefetch();
      this.cancelScheduled();
      cancelAnimationFrame(this.focusRaf);
      this.focusRaf = 0;
    } else if (this.focus) {
      this.tickFocus(this.focus);
    } else {
      this.wake();
    }
  };

  /** Releases every resource. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelDetailPrefetch();
    this.cancelScheduled();
    cancelAnimationFrame(this.focusRaf);
    this.observer.disconnect();
    this.host.removeEventListener('pointerdown', this.handleDown);
    this.host.removeEventListener('pointermove', this.handleMove);
    this.host.removeEventListener('pointerup', this.handleUp);
    this.host.removeEventListener('pointercancel', this.handleCancel);
    this.host.removeEventListener('pointerleave', this.handleLeave);
    this.host.removeEventListener('wheel', this.handleWheel);
    this.labels.removeEventListener('click', this.handleKeyClick);
    this.labels.removeEventListener('focusin', this.handleFocusIn);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    for (const element of this.focus?.viewer.querySelectorAll('video,audio') ?? []) {
      (element as HTMLMediaElement).pause();
    }
    this.media.destroy();
    this.renderer?.dispose();
    this.canvas.remove();
    this.labels.remove();
    this.focusLayer.remove();
    this.pool.clear();
    this.reflowOrigins.clear();
    this.cachedCards = [];
  }
}

export type { LayoutItem };
