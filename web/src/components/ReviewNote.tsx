import { REVIEW_FALLBACK, REVIEW_HEURISTIC, REVIEW_SPOKEN } from "../lib/copy";
import s from "./ReviewNote.module.css";

/** Advisory note under a cited quote when the server suggests checking it. A heuristic, not a verdict. */
export function ReviewNote({ notes }: { notes: string[] }) {
  return (
    <p className={s.note} data-review="true">
      <strong>Check this quote.</strong> {notes.join(" ") || REVIEW_FALLBACK}{" "}
      <span className={s.aside}>{REVIEW_HEURISTIC}</span>
    </p>
  );
}

/** Compact form of the same advisory, for rows and lists. Screen readers hear the full meaning. */
export function ReviewChip() {
  return (
    <span className={s.chip} data-review="true">
      Check quote<span className="sr-only">: {REVIEW_SPOKEN}</span>
    </span>
  );
}
