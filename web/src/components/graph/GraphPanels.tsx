import { findingComparison } from "../../lib/findings";
import { TYPE_LABEL } from "../../lib/graph/labels";
import type { InvestigationSummary } from "../../lib/graph/ledger";
import type { GraphModel } from "../../lib/graph/model";
import type { EmailFinding } from "../../lib/graph/useFindings";
import { buildUrl, DEFAULT_ROUTE } from "../../lib/router";
import { Icon } from "../Icon";
import { Link } from "../Link";
import { EntityNode, RISK_GLYPH, TYPE_ICON } from "./EntityNode";
import s from "./Graph.module.css";

const emailHref = (id: string) => buildUrl({ ...DEFAULT_ROUTE, emailId: id });

/** Compact "earlier → this message" for one cross-email finding, using only the server's values. */
export function FindingCompact({ item }: { item: EmailFinding }) {
  const { finding, emailId } = item;
  const c = findingComparison(finding);
  return (
    <div className={s.findingCompact}>
      <p className={s.findingText}>{finding.summary}</p>
      <p className={s.findingValues}>
        <span>{c.before.length > 0 ? c.before.join(", ") : "Unknown"}</span>
        <Icon name="arrow" size={14} />
        <strong>{c.after}</strong>
      </p>
      <Link href={emailHref(emailId)} className={s.evidenceLink}>
        Open {emailId} to see the comparison
      </Link>
    </div>
  );
}

/**
 * The real cross-email comparisons of the messages in the graph. Deliberately NOT connected to
 * any node: they are findings about stored messages, not relationships the AI extracted.
 */
export function FindingStrip({ findings }: { findings: EmailFinding[] }) {
  if (findings.length === 0) return null;
  const first = findings[0]!;
  return (
    <section className={s.findings} aria-labelledby="findings-h">
      <header className={s.findingsHead}>
        <h3 id="findings-h" className={s.findingsTitle}>
          <Icon name="flag" size={16} /> Cross-email comparison
        </h3>
        <p className={s.muted}>
          From {first.emailId}
          {first.finding.related_email_ids.length > 0 ? ` compared with ${first.finding.related_email_ids.join(", ")}` : ""}. Not a
          graph relationship.
        </p>
      </header>
      <div className={s.findingGrid}>
        {findings.map((f) => {
          const c = findingComparison(f.finding);
          return (
            <article key={f.finding.id} className={s.findingCard} aria-label={f.finding.summary}>
              <div className={s.findingSides}>
                <div>
                  <p className={s.findingLabel}>{c.beforeLabel}</p>
                  <p className={s.findingBefore}>{c.before.length > 0 ? c.before.join(", ") : "Unknown"}</p>
                </div>
                <span className={s.findingArrow} aria-hidden="true">
                  <Icon name="arrow" size={20} />
                </span>
                <div>
                  <p className={s.findingLabel}>{c.afterLabel}</p>
                  <p className={s.findingAfter}>{c.after}</p>
                </div>
              </div>
              {c.caption && <p className={s.findingNote}>{c.caption}</p>}
              {c.notes.map((n) => (
                <p key={n.label} className={s.findingNote}>
                  {n.label}: <strong>{n.value}</strong>
                </p>
              ))}
            </article>
          );
        })}
      </div>
      <p className={s.findingAssurance}>
        <Icon name="info" size={14} />
        <span>
          Investigative indicators, not proof of fraud: a difference like this is a reason to verify with the vendor.{" "}
          <Link href={emailHref(first.emailId)} className={s.evidenceLink}>
            Open {first.emailId}
          </Link>
        </span>
      </p>
    </section>
  );
}

/** The secondary collection: entities with no relationship in the data, labelled as such. */
export function NotConnected({
  model,
  ids,
  selectedId,
  onSelect,
  open,
  onToggle,
}: {
  model: GraphModel;
  ids: string[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  open: boolean;
  onToggle: () => void;
}) {
  if (ids.length === 0) return null;
  const nodes = ids.map((id) => model.nodeById.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
  const byType = new Map<string, typeof nodes>();
  for (const n of nodes) (byType.get(n.type) ?? byType.set(n.type, []).get(n.type)!).push(n);

  return (
    <section className={s.rail} aria-labelledby="rail-h">
      <header className={s.railHead}>
        <h3 id="rail-h" className={s.railTitle}>
          Not connected ({nodes.length})
        </h3>
        <button type="button" className={s.linkButton} aria-expanded={open} aria-controls="rail-body" onClick={onToggle}>
          {open ? "Hide" : "Show"}
        </button>
      </header>
      <p className={s.muted}>No relationship was extracted for these entities. They are real entities from the same messages.</p>
      <div id="rail-body" hidden={!open} className={s.railBody}>
        {[...byType.entries()].map(([type, list]) => (
          <div key={type} className={s.railGroup}>
            <p className={s.railType}>
              <Icon name={TYPE_ICON[type as keyof typeof TYPE_ICON]} size={14} />{" "}
              {TYPE_LABEL[type as keyof typeof TYPE_LABEL]} ({list.length})
            </p>
            <div className={s.chips}>
              {list.map((n, i) => (
                <EntityNode key={n.id} node={n} variant="chip" index={i} selected={n.id === selectedId} dimmed={false} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** What was analyzed, from the real message list: counts only, nothing scored. */
export function SummaryStrip({ summary, inboxHref }: { summary: InvestigationSummary; inboxHref: string }) {
  const parts: { text: string; tone: "ai" | "rules" | "plain" }[] = [];
  if (summary.aiAssessed > 0) {
    const how = summary.aiRecorded === summary.aiAssessed ? " (recorded)" : summary.aiLive === summary.aiAssessed ? " (live)" : "";
    parts.push({ text: `${summary.aiAssessed} AI-assessed${how}`, tone: "ai" });
  }
  if (summary.automaticOnly > 0) parts.push({ text: `${summary.automaticOnly} automatic checks only`, tone: "rules" });
  if (summary.notAnalyzed > 0) parts.push({ text: `${summary.notAnalyzed} not analyzed`, tone: "plain" });
  return (
    <div className={s.summary} role="group" aria-label="What was analyzed">
      <span className={s.summaryLead}>{summary.total} messages:</span>
      {parts.map((p) => (
        <span key={p.text} className={`${s.summaryChip} ${p.tone === "ai" ? s.summaryAi : p.tone === "rules" ? s.summaryRules : ""}`}>
          {p.text}
        </span>
      ))}
      {summary.notAnalyzed > 0 && (
        <Link href={inboxHref} className={s.evidenceLink}>
          Analyze more in the inbox
        </Link>
      )}
    </div>
  );
}

export function Legend() {
  return (
    <details className={s.legend}>
      <summary>Legend</summary>
      <ul className={s.legendList}>
        <li>
          <span className={`${s.legendSwatch} ${s.swatchAi}`} aria-hidden="true" />
          <span>
            <strong>Solid, tinted, tagged AI</strong>: identified by a validated AI assessment.
          </span>
        </li>
        <li>
          <span className={`${s.legendSwatch} ${s.swatchRules}`} aria-hidden="true" />
          <span>
            <strong>Dashed, white, tagged Automatic</strong>: derived automatically, for example from a message header.
          </span>
        </li>
        <li>
          <span className={s.legendGlyph} aria-hidden="true">
            <Icon name="mail" size={12} /> {RISK_GLYPH.high}
          </span>
          <span>
            <strong>Envelope letter</strong> (H, M, L, ✓ no risk found, ? not assessed): the highest risk among the messages that
            mention the entity. It describes those messages, not the entity. Not assessed is not the same as safe.
          </span>
        </li>
        <li>
          <span className={s.legendLine} aria-hidden="true" />
          <span>
            <strong>Curved line with a label</strong>: a relationship the AI cited with an exact passage. Select it to read the
            evidence.
          </span>
        </li>
      </ul>
    </details>
  );
}

