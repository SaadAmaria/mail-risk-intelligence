/**
 * Pan / zoom math, kept pure so it can be tested without a DOM.
 *
 * Coordinates are SVG "user units" (the layout's coordinate space). A transform maps layout
 * space to the visible space as `p' = p * k + (x, y)`. The identity transform is "fit": the
 * layout's own view box is computed to contain the whole graph.
 */

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const IDENTITY: Transform = { x: 0, y: 0, k: 1 };
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 6;
export const BUTTON_STEP = 1.35;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Zoom by `factor` keeping the point (px, py) (in view-box user units) fixed on screen. */
export function zoomAt(t: Transform, factor: number, px: number, py: number): Transform {
  const k = clamp(t.k * factor, MIN_ZOOM, MAX_ZOOM);
  if (k === t.k) return t;
  const r = k / t.k;
  return { k, x: px - (px - t.x) * r, y: py - (py - t.y) * r };
}

export function panBy(t: Transform, dx: number, dy: number): Transform {
  return { ...t, x: t.x + dx, y: t.y + dy };
}

/** Zoom about the centre of the view box (used by the buttons and the keyboard). */
export function zoomCentered(t: Transform, factor: number, view: Box): Transform {
  return zoomAt(t, factor, view.x + view.width / 2, view.y + view.height / 2);
}

/**
 * Keep at least a little of the content on screen, so the graph can never be lost by dragging.
 * `content` is the layout's bounding box, `view` the visible user-unit box.
 */
export function clampTransform(t: Transform, content: Box, view: Box, keep = 80): Transform {
  const left = content.x * t.k + t.x;
  const right = (content.x + content.width) * t.k + t.x;
  const top = content.y * t.k + t.y;
  const bottom = (content.y + content.height) * t.k + t.y;
  let { x, y } = t;
  if (right < view.x + keep) x += view.x + keep - right;
  if (left > view.x + view.width - keep) x -= left - (view.x + view.width - keep);
  if (bottom < view.y + keep) y += view.y + keep - bottom;
  if (top > view.y + view.height - keep) y -= top - (view.y + view.height - keep);
  return x === t.x && y === t.y ? t : { ...t, x, y };
}

/**
 * Convert a client (CSS pixel) coordinate to view-box user units for an SVG that is drawn with
 * `preserveAspectRatio="xMidYMid meet"` into `rect`.
 */
export function clientToUser(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, vb: Box): { x: number; y: number } {
  const s = Math.min(rect.width / vb.width, rect.height / vb.height) || 1;
  const offX = (rect.width - vb.width * s) / 2;
  const offY = (rect.height - vb.height * s) / 2;
  return { x: vb.x + (clientX - rect.left - offX) / s, y: vb.y + (clientY - rect.top - offY) / s };
}

/** Pixels per user unit under "meet" scaling. */
export function pixelScale(rect: { width: number; height: number }, vb: Box): number {
  return Math.min(rect.width / vb.width, rect.height / vb.height) || 1;
}

/** Two-pointer gesture: the zoom factor and the midpoint movement between two samples. */
export function pinch(
  prev: { a: { x: number; y: number }; b: { x: number; y: number } },
  next: { a: { x: number; y: number }; b: { x: number; y: number } },
): { factor: number; mid: { x: number; y: number }; dx: number; dy: number } {
  const d0 = Math.hypot(prev.a.x - prev.b.x, prev.a.y - prev.b.y) || 1;
  const d1 = Math.hypot(next.a.x - next.b.x, next.a.y - next.b.y) || 1;
  const m0 = { x: (prev.a.x + prev.b.x) / 2, y: (prev.a.y + prev.b.y) / 2 };
  const m1 = { x: (next.a.x + next.b.x) / 2, y: (next.a.y + next.b.y) / 2 };
  return { factor: d1 / d0, mid: m1, dx: m1.x - m0.x, dy: m1.y - m0.y };
}

/** A transform that moves `point` (layout space) to the middle of `view`, keeping the zoom. */
export function centerOn(t: Transform, point: { x: number; y: number }, view: Box): Transform {
  return { ...t, x: view.x + view.width / 2 - point.x * t.k, y: view.y + view.height / 2 - point.y * t.k };
}

/** True when `point` (layout space) is inside `view` with a margin, under transform `t`. */
export function isVisible(t: Transform, point: { x: number; y: number }, view: Box, margin = 24): boolean {
  const sx = point.x * t.k + t.x;
  const sy = point.y * t.k + t.y;
  return sx >= view.x + margin && sx <= view.x + view.width - margin && sy >= view.y + margin && sy <= view.y + view.height - margin;
}

/** Wheel delta to zoom factor (smooth for trackpads, ~1.1 per notch for a wheel). */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(px, -240, 240) * 0.0016);
}

/** Whether `current` equals the fit (identity) transform. */
export function isFit(t: Transform): boolean {
  return t.k === 1 && t.x === 0 && t.y === 0;
}
