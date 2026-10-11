import type { CrossEmailFinding } from "@mri/shared";
import { findingComparison } from "../lib/findings";
import { buildUrl, DEFAULT_ROUTE } from "../lib/router";
import { Icon } from "./Icon";
import { Link } from "./Link";
import s from "./Comparison.module.css";

/**
 * "Earlier → this message" for one cross-email finding. It states what differs, how sure the
 * match between messages is, and that a difference is a lead rather than proof.
 */
export function Comparison({ finding }: { finding: CrossEmailFinding }) {
  const c = findingComparison(finding);
  const tentative = finding.identity !== "consistent";
  return (
    <section className={s.card} aria-label={finding.summary}>
      <p className={s.summary}>{finding.summary}</p>

      <div className={s.compare}>
        <div className={s.side}>
          <p className={s.label}>{c.beforeLabel}</p>
          {c.before.length > 0 ? (
            <ul className={s.values}>
              {c.before.map((x) => (
                <li key={x} className={s.value}>
                  {x}
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.value}>Unknown</p>
          )}
        </div>
        <span className={s.arrow} aria-hidden="true">
          <Icon name="arrow" size={22} />
        </span>
        <div className={`${s.side} ${s.after}`}>
          <p className={s.label}>{c.afterLabel}</p>
          <p className={s.value}>{c.after}</p>
          {c.caption && <p className={s.caption}>{c.caption}</p>}
        </div>
      </div>

      {c.notes.length > 0 && (
        <ul className={s.notes}>
          {c.notes.map((n) => (
            <li key={n.label} className={s.note}>
              <span>{n.label}</span>
              <strong className={n.tone === "changed" ? s.changed : n.tone === "same" ? s.same : ""}>{n.value}</strong>
            </li>
          ))}
        </ul>
      )}

      <p className={s.assurance}>
        <Icon name="info" size={16} />
        <span>
          {tentative
            ? "Tentative match: the sender or vendor name did not fully match, so treat this as a lead."
            : "Same sender domain and the same vendor name in the documents."}
        </span>
      </p>

      {finding.related_email_ids.length > 0 && (
        <p className={s.related}>
          Compared with{" "}
          {finding.related_email_ids.map((rid, i) => (
            <span key={rid}>
              {i > 0 && ", "}
              <Link href={buildUrl({ ...DEFAULT_ROUTE, emailId: rid })}>{rid}</Link>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
