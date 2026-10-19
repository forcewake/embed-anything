/**
 * The camera of the glass field.
 *
 * Port of the recovered `st` class. It keeps a *target* and a *current* state,
 * interpolates between them with exponential smoothing, supports an anchored
 * zoom, inertial panning, and a subtle mouse-driven orbit.
 */
import { clamp, orbitMatrix, screenToSphere, type CameraState, type Mat3 } from './geometry';

/** Minimum zoom factor. */
export const MIN_ZOOM = 0.18;
/** Maximum zoom factor. */
export const MAX_ZOOM = 2.5;
/** The frame budget the inertia and the easing are normalized against. */
export const FRAME_MS = 16.67;

export interface CameraOptions {
  width: number;
  height: number;
  reduced?: boolean;
  initial?: { x?: number; y?: number; zoom?: number };
}

export interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

export class CameraController {
  current: ViewState;
  target: ViewState;
  velocity = { x: 0, y: 0 };
  anchor: { x: number; y: number; px: number; py: number } | null = null;
  orbitTarget = { pitch: 0, yaw: 0 };
  cardScale = 1;
  camera: CameraState = { perspective: 1200, radius: 5000, orbit: orbitMatrix(0, 0), shift: 0 };
  width = 1;
  height = 1;
  pitch = 0;
  yaw = 0;
  shift = 0;
  private lastTime: number | undefined;
  private initial: ViewState;
  readonly reduced: boolean;

  constructor(options: CameraOptions) {
    this.initial = {
      x: options.initial?.x ?? 0,
      y: options.initial?.y ?? 0,
      zoom: clamp(options.initial?.zoom ?? 1, MIN_ZOOM, MAX_ZOOM),
    };
    this.current = { ...this.initial };
    this.target = { ...this.initial };
    this.reduced = options.reduced ?? false;
    this.resize(options.width, options.height);
  }

  /** Recomputes the derived camera parameters for a new viewport size. */
  resize(width: number, height: number) {
    this.width = Math.max(1, Number.isFinite(width) ? width : 1);
    this.height = Math.max(1, Number.isFinite(height) ? height : 1);
    this.cardScale = (this.width * (this.height > this.width ? 0.72 : 0.38)) / 656;
    const scale = Math.max(this.width, this.height) / 1728;
    this.camera = {
      perspective: 1200 * scale,
      radius: 5000 * scale,
      orbit: orbitMatrix(this.pitch, this.yaw),
      shift: this.shift,
    };
    this.anchor = null;
  }

  /** Zooms towards a screen point (relative to the viewport centre). */
  zoomAt(zoom: number, screenX = 0, screenY = 0) {
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const [px, py] = screenToSphere(screenX, screenY, this.camera);
    this.anchor = {
      x: this.target.x + px / (this.target.zoom * this.cardScale),
      y: this.target.y + py / (this.target.zoom * this.cardScale),
      px,
      py,
    };
    this.target.zoom = next;
    this.target.x = this.anchor.x - px / (next * this.cardScale);
    this.target.y = this.anchor.y - py / (next * this.cardScale);
    this.velocity = { x: 0, y: 0 };
  }

  /** Pans by a screen-space delta. */
  panBy(dx: number, dy: number) {
    this.stop();
    this.target.x += dx / (this.target.zoom * this.cardScale);
    this.target.y += dy / (this.target.zoom * this.cardScale);
  }

  /** Sets the target view. */
  setView(view: Partial<ViewState>) {
    this.stop();
    for (const key of ['x', 'y', 'zoom'] as const) {
      const value = view[key];
      if (value !== undefined && Number.isFinite(value)) this.target[key] = value;
    }
    this.target.zoom = clamp(this.target.zoom, MIN_ZOOM, MAX_ZOOM);
  }

  /** The subtle orbit follows the pointer. */
  setOrbit(x: number, y: number) {
    if (this.reduced) return;
    this.orbitTarget.pitch = ((y / this.height) * 2 - 1) * 0.05;
    this.orbitTarget.yaw = -((x / this.width) * 2 - 1) * 0.05;
  }

  /** Stops the inertia and drops the zoom anchor. */
  stop() {
    this.velocity = { x: 0, y: 0 };
    this.anchor = null;
  }

  /**
   * Advances the camera by one frame.
   *
   * @param time The current timestamp in milliseconds.
   * @param dragging Whether a pointer is currently down (freezes the inertia).
   * @returns `true` when the camera is still moving.
   */
  step(time: number, dragging = false): boolean {
    const elapsed = this.lastTime === undefined ? FRAME_MS : time - this.lastTime;
    const ratio = Math.min(2, Math.max(0.2, elapsed / FRAME_MS || 1));
    this.lastTime = time;

    if (!dragging && Math.hypot(this.velocity.x, this.velocity.y) > 0.05) {
      this.target.x += this.velocity.x * ratio;
      this.target.y += this.velocity.y * ratio;
      this.velocity.x *= 0.88 ** ratio;
      this.velocity.y *= 0.88 ** ratio;
      this.anchor = null;
    }

    const zoomEase = this.reduced ? 1 : 1 - 0.84 ** ratio;
    const orbitEase = this.reduced ? 1 : 1 - 0.89 ** ratio;

    this.current.zoom = Math.exp(
      Math.log(this.current.zoom) + (Math.log(this.target.zoom) - Math.log(this.current.zoom)) * zoomEase,
    );
    if (this.anchor) {
      this.current.x = this.anchor.x - this.anchor.px / (this.current.zoom * this.cardScale);
      this.current.y = this.anchor.y - this.anchor.py / (this.current.zoom * this.cardScale);
    } else {
      this.current.x += (this.target.x - this.current.x) * zoomEase;
      this.current.y += (this.target.y - this.current.y) * zoomEase;
    }

    // The field leans away from the direction of travel.
    const shiftTarget = this.reduced
      ? 0
      : -this.camera.perspective *
        0.095 *
        Math.tanh((Math.hypot(this.velocity.x, this.velocity.y) * this.cardScale) / (this.camera.perspective * 0.065));
    this.pitch += (this.orbitTarget.pitch - this.pitch) * orbitEase;
    this.yaw += (this.orbitTarget.yaw - this.yaw) * orbitEase;
    this.shift += (shiftTarget - this.shift) * orbitEase;

    const moving =
      Math.abs(this.current.x - this.target.x) +
        Math.abs(this.current.y - this.target.y) +
        Math.abs(this.current.zoom - this.target.zoom) * 1e3 +
        Math.hypot(this.velocity.x, this.velocity.y) >
      0.09;
    const orbitMoving =
      Math.abs(this.pitch - this.orbitTarget.pitch) + Math.abs(this.yaw - this.orbitTarget.yaw) > 2e-5 ||
      Math.abs(this.shift - shiftTarget) > 0.025;

    if (!moving) {
      Object.assign(this.current, this.target);
      this.anchor = null;
      this.velocity = { x: 0, y: 0 };
    }
    if (!orbitMoving) {
      this.pitch = this.orbitTarget.pitch;
      this.yaw = this.orbitTarget.yaw;
      this.shift = shiftTarget;
    }

    this.camera = { ...this.camera, orbit: orbitMatrix(this.pitch, this.yaw), shift: this.shift };
    return moving || orbitMoving;
  }

  /** Resets the view. */
  reset(view: Partial<ViewState> = this.initial) {
    this.setView({ ...this.initial, ...view });
    this.orbitTarget = { pitch: 0, yaw: 0 };
  }

  /** The current orbit matrix, for callers that need it directly. */
  get orbit(): Mat3 {
    return this.camera.orbit;
  }
}
