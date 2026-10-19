import { describe, expect, it } from 'vitest';
import { CameraController, MAX_ZOOM, MIN_ZOOM } from '../src/engine/CameraController';
import { orbitMatrix, projectToScreen, screenToSphere } from '../src/engine/geometry';

const create = (width = 1440, height = 900) =>
  new CameraController({ width, height, initial: { x: 0, y: 0, zoom: 1 } });

describe('camera controller', () => {
  it('derives the card scale from the viewport', () => {
    const camera = create(1440, 900);
    expect(camera.cardScale).toBeCloseTo((1440 * 0.38) / 656, 10);
  });

  it('uses a larger card scale on a portrait viewport', () => {
    const camera = create(900, 1600);
    expect(camera.cardScale).toBeCloseTo((900 * 0.72) / 656, 10);
  });

  it('clamps the zoom to the allowed range', () => {
    const camera = create();
    camera.zoomAt(100);
    expect(camera.target.zoom).toBe(MAX_ZOOM);
    camera.zoomAt(0.0001);
    expect(camera.target.zoom).toBe(MIN_ZOOM);
  });

  it('keeps the anchor point fixed while zooming', () => {
    const camera = create();
    const before = screenToSphere(200, 120, camera.camera);
    camera.zoomAt(2, 200, 120);
    // The world point under the pointer must not drift.
    const after = screenToSphere(200, 120, camera.camera);
    expect(after[0]).toBeCloseTo(before[0], 3);
    expect(after[1]).toBeCloseTo(before[1], 3);
  });

  it('pans by a screen delta', () => {
    const camera = create();
    camera.panBy(100, 50);
    expect(camera.target.x).toBeCloseTo(100 / (1 * camera.cardScale), 8);
    expect(camera.target.y).toBeCloseTo(50 / (1 * camera.cardScale), 8);
  });

  it('decays the inertia and eventually stops', () => {
    const camera = create();
    camera.velocity = { x: 5, y: 0 };
    let time = 0;
    for (let i = 0; i < 400; i++) {
      time += 16.67;
      camera.step(time);
    }
    expect(Math.hypot(camera.velocity.x, camera.velocity.y)).toBeLessThan(0.05);
  });

  it('converges towards the target', () => {
    const camera = create();
    camera.panBy(400, 200);
    let time = 0;
    for (let i = 0; i < 400; i++) {
      time += 16.67;
      camera.step(time);
    }
    expect(camera.current.x).toBeCloseTo(camera.target.x, 3);
    expect(camera.current.y).toBeCloseTo(camera.target.y, 3);
  });

  it('follows the pointer with a subtle orbit', () => {
    const camera = create();
    camera.setOrbit(0, 0);
    expect(camera.orbitTarget.pitch).toBeCloseTo(-0.05, 6);
    expect(camera.orbitTarget.yaw).toBeCloseTo(0.05, 6);
    camera.setOrbit(1440, 900);
    expect(camera.orbitTarget.pitch).toBeCloseTo(0.05, 6);
    expect(camera.orbitTarget.yaw).toBeCloseTo(-0.05, 6);
  });

  it('ignores the orbit when reduced motion is requested', () => {
    const camera = new CameraController({ width: 1440, height: 900, reduced: true });
    camera.setOrbit(0, 0);
    expect(camera.orbitTarget.pitch).toBe(0);
  });

  it('resets to the initial view', () => {
    const camera = create();
    camera.panBy(500, 500);
    camera.zoomAt(2);
    camera.reset();
    expect(camera.target.zoom).toBe(1);
    expect(camera.target.x).toBe(0);
    expect(camera.target.y).toBe(0);
  });
});

describe('geometry', () => {
  it('builds an identity orbit matrix for a zero pitch and yaw', () => {
    const orbit = orbitMatrix(0, 0).map((value) => value + 0);
    expect(orbit).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('projects the origin to the centre of the viewport', () => {
    const camera = { perspective: 1000, radius: 4000, orbit: orbitMatrix(0, 0), shift: 0 };
    const point = projectToScreen([0, 0, 0], camera, 1440, 900);
    expect(point.x).toBeCloseTo(720, 6);
    expect(point.y).toBeCloseTo(450, 6);
  });

  it('maps the screen centre onto the sphere origin', () => {
    const camera = { perspective: 1000, radius: 4000, orbit: orbitMatrix(0, 0), shift: 0 };
    const [x, y] = screenToSphere(0, 0, camera);
    expect(x).toBeCloseTo(0, 4);
    expect(y).toBeCloseTo(0, 4);
  });
});
