import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { predicateLabel, relationshipSpoken } from "../../lib/copy";
import { fitTo, type SpatialLayout } from "../../lib/graph/spatial";
import type { GraphModel } from "../../lib/graph/model";
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
  type Transform,
} from "../../lib/graph/viewport";
import { Icon } from "../Icon";
import { EntityNode } from "./EntityNode";
import s from "./Graph.module.css";

const DRAG_THRESHOLD_PX = 4;
const PAN_KEY_STEP = 60;
/** Used before the first measurement (and where layout is not measurable, e.g. in tests). */
const FALLBACK_STAGE = { width: 760, height: 420 };

interface Props {
  /** The visible (filtered) model: the same data the list shows. */
  model: GraphModel;
  layout: SpatialLayout;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
}

/**
 * The spatial canvas. Entities are real HTML surfaces (crisp, wrappable, natively focusable);
 * relationships are SVG paths drawn from the API's edges. Both live in one layer whose transform
 * is `fit * user`, so selecting, filtering and the Graph/List toggle never move anything, and
 * panning/zooming changes a single transform.
 *
 * Coordinates: the "user space" of the viewport math is the stage's own CSS pixels, so a client
 * point maps 1:1 and `identity` is exactly "fitted".
 */
export function GraphCanvas({ model, layout, selectedNodeId, selectedEdgeId, onSelectNode, onSelectEdge }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(FALLBACK_STAGE);
  const [t, setTState] = useState<Transform>(IDENTITY);
  /** Discrete actions (buttons, keys, fit, re-centre) glide; dragging and wheel are immediate. */
  const [smooth, setSmooth] = useState(false);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => fitTo(layout.bounds, size), [layout.bounds, size]);
  const vb = useMemo(() => ({ x: 0, y: 0, width: size.width, height: size.height }), [size]);
  // The graph's bounds in stage pixels at the fitted scale (used to keep it reachable).
  const content = useMemo(
    () => ({
      x: fit.x + layout.bounds.x * fit.k,
      y: fit.y + layout.bounds.y * fit.k,
      width: layout.bounds.width * fit.k,
      height: layout.bounds.height * fit.k,
    }),
    [fit, layout.bounds],
  );
  const limit = useCallback((next: Transform) => clampTransform(next, content, vb), [content, vb]);

  const setT = useCallback((fn: (cur: Transform) => Transform, glide = false) => {
    setSmooth(glide);
    setTState(fn);
  }, []);

  // A different graph (filters, refresh, orientation) starts fitted again.
  const layoutKey = useMemo(
    () => `${layout.orientation}|${model.nodes.map((n) => n.id).join(",")}|${model.edges.map((e) => e.id).join(",")}`,
    [layout.orientation, model],
  );
  useEffect(() => setT(() => IDENTITY, true), [layoutKey, setT]);

  // ---- pointer gestures ------------------------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, startX: 0, startY: 0, suppressClick: false });

  const rect = () => viewportRef.current!.getBoundingClientRect();

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current.moved = false;
    gesture.current.startX = e.clientX;
    gesture.current.startY = e.clientY;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    const r = rect();
    const scale = pixelScale(r, vb);

    if (pointers.current.size >= 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (!other) return;
      const g = pinch({ a: prev, b: other }, { a: next, b: other });
      const mid = clientToUser(g.mid.x, g.mid.y, r, vb);
      pointers.current.set(e.pointerId, next);
      gesture.current.moved = true;
      gesture.current.suppressClick = true;
      setT((cur) => limit(panBy(zoomAt(cur, g.factor, mid.x, mid.y), g.dx / scale, g.dy / scale)));
      return;
    }

    if (!gesture.current.moved) {
      if (Math.hypot(next.x - gesture.current.startX, next.y - gesture.current.startY) < DRAG_THRESHOLD_PX) return;
      gesture.current.moved = true;
      gesture.current.suppressClick = true;
      try {
        viewportRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* not supported (tests): dragging still works through move events */
      }
    }
    pointers.current.set(e.pointerId, next);
    const dx = (next.x - prev.x) / scale;
    const dy = (next.y - prev.y) / scale;
    setT((cur) => limit(panBy(cur, dx, dy)));
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      // The click that follows a drag fires before this timeout; afterwards clicks work again.
      window.setTimeout(() => {
        gesture.current.suppressClick = false;
      }, 0);
    }
  };
  const guard = () => gesture.current.suppressClick;

  // ---- wheel (non-passive so the page does not scroll while zooming) ------------------------
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const p = clientToUser(ev.clientX, ev.clientY, el.getBoundingClientRect(), vb);
      setT((cur) => limit(zoomAt(cur, wheelFactor(ev.deltaY, ev.deltaMode), p.x, p.y)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [vb, limit, setT]);

  // ---- keyboard and buttons -----------------------------------------------------------------
  const zoomIn = () => setT((cur) => limit(zoomCentered(cur, BUTTON_STEP, vb)), true);
  const zoomOut = () => setT((cur) => limit(zoomCentered(cur, 1 / BUTTON_STEP, vb)), true);
  const reFit = () => setT(() => IDENTITY, true);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomIn();
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomOut();
    } else if (e.key === "0") {
      e.preventDefault();
      reFit();
    } else if (e.target === e.currentTarget) {
      const d = { ArrowLeft: [PAN_KEY_STEP, 0], ArrowRight: [-PAN_KEY_STEP, 0], ArrowUp: [0, PAN_KEY_STEP], ArrowDown: [0, -PAN_KEY_STEP] }[e.key];
      if (d) {
        e.preventDefault();
        setT((cur) => limit(panBy(cur, d[0]!, d[1]!)), true);
      }
    }
  };

  // ---- a selection made elsewhere (navigator, inspector) brings the entity into view --------------
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selectedNodeId && selectedNodeId !== lastSelected.current) {
      const p = layout.nodes.get(selectedNodeId);
      if (p) {
        const c = { x: fit.x + (p.x + p.w / 2) * fit.k, y: fit.y + (p.y + p.h / 2) * fit.k };
        if (!isVisible(t, c, vb)) setT((cur) => limit(centerOn(cur, c, vb)), true);
      }
    }
    lastSelected.current = selectedNodeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  // ---- derived drawing data --------------------------------------------------------------------
  const selectedEdge = selectedEdgeId ? model.edgeById.get(selectedEdgeId) ?? null : null;
  const hotEdges = useMemo(() => {
    if (selectedEdge) return new Set([selectedEdge.id]);
    return new Set(selectedNodeId ? (model.nodeById.get(selectedNodeId)?.edgeIds ?? []) : []);
  }, [model, selectedEdge, selectedNodeId]);
  const related = useMemo(() => {
    const out = new Set<string>();
    if (selectedNodeId) out.add(selectedNodeId);
    for (const id of hotEdges) {
      const e = model.edgeById.get(id);
      if (e) {
        out.add(e.source);
        out.add(e.target);
      }
    }
    return out;
  }, [model, selectedNodeId, hotEdges]);
  const hasSelection = selectedNodeId !== null || selectedEdge !== null;

  const percent = Math.round(t.k * 100);
  const layerStyle = {
    transform: `translate(${(t.k * fit.x + t.x).toFixed(2)}px, ${(t.k * fit.y + t.y).toFixed(2)}px) scale(${(t.k * fit.k).toFixed(4)})`,
  };
  const pad = 60;
  const svgBox = {
    left: layout.bounds.x - pad,
    top: layout.bounds.y - pad,
    width: layout.bounds.width + pad * 2,
    height: layout.bounds.height + pad * 2,
  };

  return (
    <div
      ref={stageRef}
      className={s.stage}
      tabIndex={0}
      role="group"
      aria-label="Graph canvas. Arrow keys pan the view, plus and minus zoom, zero fits the whole graph. Tab moves into the entities."
      onKeyDown={onKeyDown}
    >
      <div className={s.stageBar}>
        <p className={s.hint}>Drag to pan. Scroll, pinch or use + and − to zoom. 0 fits the graph.</p>
        <div className={s.controls} role="group" aria-label="Zoom controls">
          <button type="button" onClick={zoomIn} disabled={t.k >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in (+)">
            <Icon name="plus" size={18} />
          </button>
          <button type="button" onClick={zoomOut} disabled={t.k <= MIN_ZOOM} aria-label="Zoom out" title="Zoom out (−)">
            <span aria-hidden="true" className={s.minus} />
          </button>
          <button type="button" onClick={reFit} disabled={isFit(t)} aria-label="Fit the whole graph in view" title="Fit to view (0)">
            <Icon name="expand" size={16} />
          </button>
          <span className={s.zoomValue} aria-live="polite">
            {percent}%
          </span>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={s.viewport}
        style={{ ["--want-h" as string]: `${Math.round(layout.bounds.height + 88)}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClick={(e) => {
          if (e.target === e.currentTarget && !guard()) {
            onSelectNode(null);
            onSelectEdge(null);
          }
        }}
      >
        <div
          className={`${s.layer} ${smooth ? s.glide : ""}`}
          style={layerStyle}
          data-transform={`${t.x.toFixed(2)},${t.y.toFixed(2)},${t.k.toFixed(3)}`}
        >
          <svg
            className={s.edges}
            role="group"
            aria-label={`Knowledge graph: ${model.nodes.length} entities, ${model.edges.length} relationships.`}
            viewBox={`${svgBox.left} ${svgBox.top} ${svgBox.width} ${svgBox.height}`}
            style={{ left: svgBox.left, top: svgBox.top, width: svgBox.width, height: svgBox.height }}
          >
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0,1.2 L9,5 L0,8.8 z" className={s.arrowHead} />
              </marker>
              <marker id="arrow-hot" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0,1.2 L9,5 L0,8.8 z" className={s.arrowHeadHot} />
              </marker>
            </defs>
            <g aria-hidden="true">
              {layout.edges.map((e, i) => {
                const hot = hotEdges.has(e.id);
                const dim = hasSelection && !hot;
                return (
                  <g key={e.id} className={`${s.edge} ${hot ? s.edgeHot : ""} ${dim ? s.dim : ""}`} style={{ ["--i" as string]: i + 2 }}>
                    <path d={e.path} className={s.edgeLine} fill="none" markerEnd={hot ? "url(#arrow-hot)" : "url(#arrow)"} />
                    {hot && <path d={e.path} className={s.edgeFlow} fill="none" />}
                  </g>
                );
              })}
            </g>
          </svg>

          {layout.edges.map((e, i) => {
            const edge = model.edgeById.get(e.id);
            const source = model.nodeById.get(e.source);
            const target = model.nodeById.get(e.target);
            if (!edge || !source || !target) return null;
            const hot = hotEdges.has(e.id);
            const selected = selectedEdgeId === e.id;
            return (
              <button
                key={e.id}
                type="button"
                data-edge-id={e.id}
                aria-pressed={selected}
                data-review={edge.review ? "true" : undefined}
                aria-label={relationshipSpoken(`Relationship: ${source.label} ${predicateLabel(edge.predicate, target.type)} ${target.label}`, edge.review)}
                className={`${s.pill} ${hot ? s.pillHot : ""} ${hasSelection && !hot ? s.dim : ""} ${selected ? s.pillSelected : ""} ${edge.review ? s.pillReview : ""}`}
                style={{ left: e.labelX - e.labelW / 2, top: e.labelY - e.labelH / 2, minWidth: e.labelW, height: e.labelH, ["--i" as string]: i + 2 }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (guard()) return;
                  onSelectEdge(selected ? null : e.id);
                }}
              >
                {e.label}
              </button>
            );
          })}

          {model.nodes.map((n, i) => {
            const p = layout.nodes.get(n.id);
            if (!p) return null;
            const selected = n.id === selectedNodeId;
            return (
              <EntityNode
                key={n.id}
                node={n}
                variant="card"
                compact={layout.orientation === "vertical"}
                pos={p}
                index={i}
                selected={selected}
                related={hasSelection && !selected && related.has(n.id)}
                dimmed={hasSelection && !related.has(n.id)}
                onSelect={(id) => {
                  onSelectEdge(null);
                  onSelectNode(id);
                }}
                guard={guard}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
