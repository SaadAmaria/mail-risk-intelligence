import { describe, expect, it } from "vitest";
import {
  BUTTON_STEP,
  centerOn,
  clampTransform,
  clientToUser,
  IDENTITY,
  isFit,
  isVisible,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  pinch,
  pixelScale,
  wheelFactor,
  zoomAt,
  zoomCentered,
} from "./viewport";

const view = { x: 0, y: 0, width: 800, height: 400 };

describe("zoom", () => {
  it("keeps the point under the pointer fixed on screen", () => {
    const p = { x: 300, y: 120 };
    const t = zoomAt({ x: 10, y: -5, k: 1.3 }, 1.7, p.x, p.y);
    // The layout point that was under (p.x, p.y) before must still be under it after.
    const before = { x: (p.x - 10) / 1.3, y: (p.y + 5) / 1.3 };
    expect(before.x * t.k + t.x).toBeCloseTo(p.x, 9);
    expect(before.y * t.k + t.y).toBeCloseTo(p.y, 9);
  });

  it("is bounded by the minimum and maximum zoom", () => {
    let t = IDENTITY;
    for (let i = 0; i < 40; i++) t = zoomAt(t, 2, 400, 200);
    expect(t.k).toBe(MAX_ZOOM);
    for (let i = 0; i < 40; i++) t = zoomAt(t, 0.5, 400, 200);
    expect(t.k).toBe(MIN_ZOOM);
  });

  it("returns the same object when already at a limit (no drift)", () => {
    const at = zoomAt(IDENTITY, 100, 0, 0);
    expect(zoomAt(at, 2, 5, 5)).toBe(at);
  });

  it("button zoom is centred and invertible", () => {
    const t = zoomCentered(IDENTITY, BUTTON_STEP, view);
    expect(t.k).toBeCloseTo(BUTTON_STEP);
    const back = zoomCentered(t, 1 / BUTTON_STEP, view);
    expect(back.k).toBeCloseTo(1);
    expect(back.x).toBeCloseTo(0, 6);
    expect(back.y).toBeCloseTo(0, 6);
  });

  it("wheel: scrolling up zooms in, down zooms out, deltas are bounded", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100000)).toBe(wheelFactor(-240));
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-3, 1)).toBeGreaterThan(1); // line mode
  });
});

describe("pan, clamp and fit", () => {
  it("pans by a user-unit delta", () => {
    expect(panBy(IDENTITY, 12, -7)).toEqual({ x: 12, y: -7, k: 1 });
  });

  it("clamps so the content can never be dragged out of reach", () => {
    const content = { x: 0, y: 0, width: 400, height: 300 };
    const far = clampTransform({ x: 5000, y: 5000, k: 1 }, content, view);
    expect(far.x).toBeLessThanOrEqual(view.width);
    expect(far.y).toBeLessThanOrEqual(view.height);
    const gone = clampTransform({ x: -9000, y: -9000, k: 1 }, content, view);
    expect(gone.x + content.width).toBeGreaterThan(0);
    expect(gone.y + content.height).toBeGreaterThan(0);
    const ok = { x: 10, y: 10, k: 1 };
    expect(clampTransform(ok, content, view)).toBe(ok);
  });

  it("fit is the identity and is recognised as such", () => {
    expect(isFit(IDENTITY)).toBe(true);
    expect(isFit(zoomAt(IDENTITY, 2, 0, 0))).toBe(false);
  });

  it("centres a point while keeping the zoom, and reports visibility", () => {
    const t = centerOn({ x: 0, y: 0, k: 2 }, { x: 100, y: 50 }, view);
    expect(100 * t.k + t.x).toBeCloseTo(400);
    expect(50 * t.k + t.y).toBeCloseTo(200);
    expect(isVisible(t, { x: 100, y: 50 }, view)).toBe(true);
    expect(isVisible(IDENTITY, { x: 5000, y: 5000 }, view)).toBe(false);
  });
});

describe("coordinates and gestures", () => {
  it("maps client pixels to user units under 'meet' scaling, with letterboxing", () => {
    const vb = { x: -20, y: -20, width: 400, height: 200 };
    const rect = { left: 100, top: 50, width: 800, height: 600 }; // wider than tall content: letterboxed vertically
    expect(pixelScale(rect, vb)).toBe(2);
    // The view box's top-left lies at the letterbox offset (0, 100) inside the element.
    const tl = clientToUser(100, 50 + 100, rect, vb);
    expect(tl.x).toBeCloseTo(-20);
    expect(tl.y).toBeCloseTo(-20);
    const mid = clientToUser(100 + 400, 50 + 300, rect, vb);
    expect(mid.x).toBeCloseTo(180);
    expect(mid.y).toBeCloseTo(80);
  });

  it("derives zoom factor and pan from a two-finger move", () => {
    const g = pinch({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, { a: { x: -10, y: 0 }, b: { x: 140, y: 0 } });
    expect(g.factor).toBeCloseTo(1.5);
    expect(g.mid).toEqual({ x: 65, y: 0 });
    expect(g.dx).toBeCloseTo(15);
    expect(pinch({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }, { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }).factor).toBe(1);
  });
});
