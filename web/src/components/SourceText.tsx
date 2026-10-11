import { useEffect, useMemo, useRef } from "react";
import { buildRuns, type HighlightRange } from "../lib/highlight";
import s from "./SourceText.module.css";

/**
 * Renders message text exactly as stored, marking only the ranges it is given. The caller has
 * already proven each range (see claims.ts); this component never searches or guesses.
 */
export function SourceText({
  text,
  ranges,
  activeClaimId,
  onMarkClick,
  label,
  isBroad,
}: {
  text: string;
  ranges: HighlightRange[];
  activeClaimId: string | null;
  onMarkClick?: (claimId: string) => void;
  label: string;
  /** Claims from automatic checks that cover a wide span get a quieter style. */
  isBroad?: (claimId: string) => boolean;
}) {
  const runs = useMemo(() => buildRuns(text, ranges), [text, ranges]);
  const activeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = activeRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }
  }, [activeClaimId]);

  let activeAssigned = false;
  return (
    <pre className={s.text} aria-label={label} tabIndex={0}>
      {runs.map((r, i) => {
        if (r.claims.length === 0) return <span key={i}>{r.text}</span>;
        const active = activeClaimId !== null && r.claims.includes(activeClaimId);
        const first = active && !activeAssigned;
        if (first) activeAssigned = true;
        return (
          <mark
            key={i}
            ref={first ? (el) => void (activeRef.current = el) : undefined}
            className={`${s.mark} ${r.claims.every((c) => isBroad?.(c)) ? s.soft : ""} ${active ? s.active : ""}`}
            data-claims={r.claims.join(" ")}
            onClick={() => r.claims[0] && onMarkClick?.(r.claims[0])}
          >
            {r.text}
          </mark>
        );
      })}
    </pre>
  );
}
