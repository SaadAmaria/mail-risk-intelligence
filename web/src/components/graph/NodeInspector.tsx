import type { EmailListItem } from "@mri/shared";
import { RELATIONSHIP_CAVEAT, predicateLabel } from "../../lib/copy";
import { formatDay } from "../../lib/format";
import { ORIGIN_LONG, RISK_CAVEAT, TYPE_LABEL, keyBasisText } from "../../lib/graph/labels";
import type { RankedRelationship } from "../../lib/graph/ledger";
import { connectionsOf, resolveSources, type GraphEdgeModel, type GraphModel, type GraphNodeModel, type SourceInfo } from "../../lib/graph/model";
import type { EmailFinding } from "../../lib/graph/useFindings";
import { buildUrl, DEFAULT_ROUTE, evidenceHref } from "../../lib/router";
import { Button, Chip, EmptyState } from "../ui";
import { Icon } from "../Icon";
import { Link } from "../Link";
import { unattributedReview } from "../../lib/review";
import { ReviewChip, ReviewNote } from "../ReviewNote";
import { RiskBadge } from "../RiskBadge";
import { TYPE_ICON } from "./EntityNode";
import { FindingCompact, Legend } from "./GraphPanels";
import s from "./Graph.module.css";

const emailHref = (id: string) => buildUrl({ ...DEFAULT_ROUTE, emailId: id });

function SourceList({ sources }: { sources: SourceInfo[] }) {
  return (
    <ul className={s.plain}>
      {sources.map((src) => (
        <li key={src.id} className={s.source}>
          <Link href={emailHref(src.id)} className={s.sourceLink}>
            <span className={s.sourceSubject}>{src.known ? src.subject?.trim() || "(no subject)" : `Message ${src.id}`}</span>
            <span className={s.sourceMeta}>
              {src.known ? `${src.sender ?? "Unknown sender"} · ${formatDay(src.date)}` : "Not in the loaded message list"}
            </span>
          </Link>
          {src.known && src.risk && <RiskBadge level={src.risk} size="sm" />}
        </li>
      ))}
    </ul>
  );
}

function OpenOriginal({ emailId }: { emailId: string }) {
  return (
    <footer className={s.inspFoot}>
      <Link href={emailHref(emailId)} className={s.primaryLink}>
        Open original email
        <Icon name="arrow" size={16} />
      </Link>
    </footer>
  );
}

/** The first relationship to review, with the exact cited passage, so the start state is already evidence. */
function FeaturedRelationship({ r, onSelectEdge }: { r: RankedRelationship; onSelectEdge: (id: string) => void }) {
  // When a citation is flagged, feature that one, so the advisory sits under the quote it is about.
  const flagged = r.edge.evidence.find((e) => e.support?.review);
  const ev = flagged ?? r.edge.evidence[0];
  return (
    <div className={s.featured}>
      <p className={s.startSentence}>
        <strong>{r.source.label}</strong> {predicateLabel(r.edge.predicate, r.target.type)} <strong>{r.target.label}</strong>
      </p>
      <p className={s.startMeta}>
        <RiskBadge level={r.risk} size="sm" />
        <span className={s.muted}>from {r.messages.map((m) => m.id).join(", ")}</span>
      </p>
      {ev && <blockquote className={s.quote}>{ev.quote}</blockquote>}
      {flagged ? <ReviewNote notes={flagged.support!.notes} /> : unattributedReview(r.edge) && <ReviewNote notes={[]} />}
      <div className={s.featuredActions}>
        <button type="button" className={s.secondaryButton} onClick={() => onSelectEdge(r.edge.id)}>
          Open this relationship
        </button>
        {ev && (
          <Link href={evidenceHref(ev.email_id, ev.snippet_id, ev.quote)} className={s.evidenceLink}>
            Show passage in message
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Start state of the inspector: real starting points from the graph, never a blank panel and
 * never a conclusion. Relationships are ordered by the risk signal of the messages they came from.
 */
export function StartPanel({
  ranked,
  isolatedCount,
  findings,
  onSelectEdge,
  onShowIsolated,
  compact = false,
}: {
  /** The navigator already lists every relationship: show one featured starting point instead. */
  compact?: boolean;
  ranked: RankedRelationship[];
  isolatedCount: number;
  findings: EmailFinding[];
  onSelectEdge: (id: string) => void;
  onShowIsolated: () => void;
}) {
  return (
    <aside className={s.inspector} aria-label="Entity details">
      <header className={s.inspHead}>
        <p className={s.eyebrow}>Where to start</p>
        <h2 className={s.inspTitle}>Start with a relationship</h2>
        <p className={s.lead}>
          Each relationship below was found by an AI assessment and cites the exact passage it came from. Choose one to read its
          evidence, or choose an entity on the canvas.
        </p>
      </header>

      <section className={s.inspSection} aria-labelledby="start-rel">
        <h3 id="start-rel" className={s.h3}>
          Relationships to review ({ranked.length})
        </h3>
        {ranked.length === 0 ? (
          <p className={s.muted}>No validated relationships are visible with the current filters.</p>
        ) : compact ? (
          <>
            <FeaturedRelationship r={ranked[0]!} onSelectEdge={onSelectEdge} />
            {ranked.length > 1 && (
              <p className={s.muted}>
                {ranked.length - 1} more {ranked.length - 1 === 1 ? "relationship is" : "relationships are"} listed in the navigator,
                in the same order.
              </p>
            )}
          </>
        ) : (
          <ul className={s.plain}>
            {ranked.slice(0, 6).map((r) => (
              <li key={r.edge.id}>
                <button type="button" className={s.startRow} onClick={() => onSelectEdge(r.edge.id)}>
                  <span className={s.startSentence}>
                    <strong>{r.source.label}</strong> {predicateLabel(r.edge.predicate, r.target.type)} <strong>{r.target.label}</strong>
                  </span>
                  <span className={s.startMeta}>
                    <RiskBadge level={r.risk} size="sm" />
                    <span className={s.muted}>
                      {r.messages.length === 1 ? `from ${r.messages[0]!.id}` : `from ${r.messages.map((m) => m.id).join(", ")}`}
                    </span>
                    {r.edge.review && <ReviewChip />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {findings.length > 0 && (
        <section className={s.inspSection} aria-labelledby="start-find">
          <h3 id="start-find" className={s.h3}>
            Cross-email findings ({findings.length})
          </h3>
          <ul className={s.plain}>
            {findings.map((f) => (
              <li key={f.finding.id}>
                <FindingCompact item={f} />
              </li>
            ))}
          </ul>
          <p className={s.muted}>These come from comparing stored messages. They are not relationships in the graph.</p>
        </section>
      )}

      {isolatedCount > 0 && (
        <section className={s.inspSection} aria-labelledby="start-iso">
          <h3 id="start-iso" className={s.h3}>
            Not connected ({isolatedCount})
          </h3>
          <p className={s.muted}>
            {isolatedCount === 1 ? "One entity has" : `${isolatedCount} entities have`} no relationship in the data. They are listed under
            "Not connected" rather than drawn among the relationships.{" "}
            <button type="button" className={s.linkButton} onClick={onShowIsolated}>
              Show them
            </button>
          </p>
        </section>
      )}
      <Legend />
    </aside>
  );
}

/**
 * Inspector for one entity. Shows only what the API provided: identity basis, origin, source
 * messages (joined with the real list), incident relationships with their verified quotes, and
 * cross-email findings that belong to the messages it appears in.
 */
export function NodeInspector({
  model,
  node,
  emails,
  findings,
  missingId,
  hiddenSelection,
  visibleIds,
  amountsHidden,
  onShowAmounts,
  onClearFilters,
  onSelect,
  onSelectEdge,
  start,
}: {
  /** The UNFILTERED model, so the inspector tells the whole story of the selected entity. */
  model: GraphModel;
  node: GraphNodeModel | null;
  emails: EmailListItem[] | null;
  findings: EmailFinding[];
  /** A `?node=` id that is not in the graph at all. */
  missingId: string | null;
  /** A `?node=` entity that exists but is hidden by the current filters. */
  hiddenSelection: GraphNodeModel | null;
  visibleIds: Set<string>;
  /** The id looks like an amount and amounts are not included. */
  amountsHidden: boolean;
  onShowAmounts: () => void;
  onClearFilters: () => void;
  onSelect: (id: string | null) => void;
  onSelectEdge: (id: string) => void;
  /** Rendered when nothing is selected and nothing needs explaining. */
  start: React.ReactNode;
}) {
  if (!node) {
    if (!hiddenSelection && !missingId) return <>{start}</>;
    return (
      <aside className={s.inspector} aria-label="Entity details">
        {hiddenSelection ? (
          <EmptyState icon="filter" title={`"${hiddenSelection.label}" is hidden by the filters`}>
            It is in the graph, but the current search or filters exclude it, so it is not drawn or listed.
            <span className={s.recover}>
              <Button onClick={onClearFilters}>Clear filters to show it</Button>
              <Button variant="ghost" onClick={() => onSelect(null)}>
                Clear selection
              </Button>
            </span>
          </EmptyState>
        ) : (
          <EmptyState icon="info" title="That entity is not in the graph">
            {amountsHidden ? (
              <>
                It looks like an amount, and amounts are not included.
                <span className={s.recover}>
                  <Button variant="primary" onClick={onShowAmounts}>
                    Include amounts
                  </Button>
                </span>
              </>
            ) : (
              <>
                The link points to an entity that is not in the current graph. It may need an analysis that has not been run, or
                the data changed. Select another entity.
                <span className={s.recover}>
                  <Button variant="ghost" onClick={() => onSelect(null)}>
                    Clear selection
                  </Button>
                </span>
              </>
            )}
          </EmptyState>
        )}
      </aside>
    );
  }

  const sources = resolveSources(node.emailIds, emails);
  const connections = connectionsOf(model, node.id);
  const related = findings.filter((f) => node.emailIds.includes(f.emailId));
  const firstSource = sources[0]?.id ?? null;

  return (
    <aside className={s.inspector} aria-label="Entity details" key={node.id}>
      <div className={s.inspBody}>
        <header className={s.inspHead}>
          <p className={s.inspType}>
            <Icon name={TYPE_ICON[node.type]} size={14} /> {TYPE_LABEL[node.type]}
          </p>
          <h2 className={s.inspTitle}>{node.label}</h2>
          <div className={s.chips}>
            <Chip kind={node.origin === "ai" ? "ai" : "rules"}>{node.origin === "ai" ? "AI-identified" : "Automatic"}</Chip>
            <Chip>{node.mentionCount === 1 ? "1 mention" : `${node.mentionCount} mentions`}</Chip>
          </div>
          <button type="button" className={s.clear} onClick={() => onSelect(null)}>
            Clear selection
          </button>
        </header>

        <section className={s.inspSection} aria-labelledby="insp-origin">
          <h3 id="insp-origin" className={s.h3}>
            Where it came from
          </h3>
          <p>{ORIGIN_LONG[node.origin]}.</p>
          <p className={s.muted}>{keyBasisText(node.keyBasis)}</p>
        </section>

        <section className={s.inspSection} aria-labelledby="insp-src">
          <h3 id="insp-src" className={s.h3}>
            Source messages ({sources.length})
          </h3>
          <SourceList sources={sources} />
        </section>

        <section className={s.inspSection} aria-labelledby="insp-conn">
          <h3 id="insp-conn" className={s.h3}>
            Relationships ({connections.length})
          </h3>
          {connections.length > 0 && <p className={s.muted}>{RELATIONSHIP_CAVEAT}</p>}
          {connections.length === 0 ? (
            <p className={s.muted}>
              No relationships. This entity appears in the messages above, but no validated relationship connects it to another
              entity.
            </p>
          ) : (
            <ul className={s.plain}>
              {connections.map(({ edge, direction, other }) => {
                const hidden = other !== null && !visibleIds.has(other.id);
                return (
                  <li key={edge.id} className={s.conn}>
                    <p className={s.connLine}>
                      <span className={s.dirMark} aria-hidden="true">
                        {direction === "out" ? "→" : "←"}
                      </span>
                      <span>
                        {direction === "out" ? "" : "is "}
                        <strong>{predicateLabel(edge.predicate, direction === "out" ? other?.type : node.type)}</strong>
                        {direction === "out" ? "" : " by"}
                      </span>{" "}
                      {other ? (
                        <button type="button" className={s.linkButton} onClick={() => onSelect(other.id)}>
                          {other.label}
                        </button>
                      ) : (
                        <span className={s.muted}>(unknown entity)</span>
                      )}
                      {hidden && <span className={s.muted}> (hidden by filters)</span>}
                      {edge.count > 1 && <span className={s.muted}> · seen {edge.count}×</span>}
                    </p>
                    {unattributedReview(edge) && <ReviewNote notes={[]} />}
                    <ul className={s.plain}>
                      {edge.evidence.map((ev, i) => (
                        <li key={`${ev.email_id}-${ev.snippet_id}-${i}`}>
                          <blockquote className={s.quote}>{ev.quote}</blockquote>
                          <p className={s.muted}>
                            Quote found in message {ev.email_id}.{" "}
                            <Link href={evidenceHref(ev.email_id, ev.snippet_id, ev.quote)} className={s.evidenceLink}>
                              Show passage in message
                            </Link>
                          </p>
                          {ev.support?.review && <ReviewNote notes={ev.support.notes} />}
                        </li>
                      ))}
                    </ul>
                    <button type="button" className={s.linkButton} onClick={() => onSelectEdge(edge.id)}>
                      Open this relationship
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {related.length > 0 && (
          <section className={s.inspSection} aria-labelledby="insp-find">
            <h3 id="insp-find" className={s.h3}>
              Cross-email findings in its messages ({related.length})
            </h3>
            <ul className={s.plain}>
              {related.map((f) => (
                <li key={f.finding.id}>
                  <FindingCompact item={f} />
                </li>
              ))}
            </ul>
            <p className={s.muted}>A difference like this is a reason to verify, not proof of fraud.</p>
          </section>
        )}

        <section className={s.inspSection} aria-labelledby="insp-risk">
          <h3 id="insp-risk" className={s.h3}>
            Risk signal from its messages
          </h3>
          <RiskBadge level={node.maxRisk} size="sm" />
          <p className={s.muted}>
            {node.maxRisk === "unassessed" ? "No source message has a verified assessment. This is not the same as safe. " : ""}
            {RISK_CAVEAT}
          </p>
        </section>
      </div>
      {firstSource && <OpenOriginal emailId={firstSource} />}
    </aside>
  );
}

/** Inspector for one relationship: what it says, the exact passage behind it, and where to verify it. */
export function EdgeInspector({
  model,
  edge,
  emails,
  findings,
  onSelectNode,
  onClear,
}: {
  model: GraphModel;
  edge: GraphEdgeModel;
  emails: EmailListItem[] | null;
  findings: EmailFinding[];
  onSelectNode: (id: string) => void;
  onClear: () => void;
}) {
  const source = model.nodeById.get(edge.source);
  const target = model.nodeById.get(edge.target);
  const sources = resolveSources(edge.emailIds, emails);
  const related = findings.filter((f) => edge.emailIds.includes(f.emailId));
  const first = sources[0]?.id ?? null;

  return (
    <aside className={s.inspector} aria-label="Entity details" key={edge.id}>
      <div className={s.inspBody}>
        <header className={s.inspHead}>
          <p className={s.inspType}>
            <Icon name="link" size={14} /> Relationship
          </p>
          <h2 className={s.inspTitle}>
            {source?.label ?? "Unknown entity"} {predicateLabel(edge.predicate, target?.type)} {target?.label ?? "unknown entity"}
          </h2>
          <div className={s.chips}>
            <Chip kind="ai">Found by AI assessment</Chip>
            <Chip>{edge.count === 1 ? "Seen once" : `Seen ${edge.count}×`}</Chip>
          </div>
          <button type="button" className={s.clear} onClick={onClear}>
            Clear selection
          </button>
        </header>

        <section className={s.inspSection} aria-labelledby="edge-ents">
          <h3 id="edge-ents" className={s.h3}>
            Entities
          </h3>
          <ul className={s.plain}>
            {[source, target].map((n) =>
              n ? (
                <li key={n.id}>
                  <button type="button" className={s.entityRow} onClick={() => onSelectNode(n.id)}>
                    <Icon name={TYPE_ICON[n.type]} size={16} />
                    <span>{n.label}</span>
                    <span className={s.muted}>{TYPE_LABEL[n.type]}</span>
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        </section>

        <section className={s.inspSection} aria-labelledby="edge-ev">
          <h3 id="edge-ev" className={s.h3}>
            Evidence ({edge.evidence.length})
          </h3>
          <p className={s.muted}>{RELATIONSHIP_CAVEAT}</p>
          {unattributedReview(edge) && <ReviewNote notes={[]} />}
          <ul className={s.plain}>
            {edge.evidence.map((ev, i) => (
              <li key={`${ev.email_id}-${ev.snippet_id}-${i}`}>
                <blockquote className={s.quote}>{ev.quote}</blockquote>
                <p className={s.muted}>
                  Quote found in message {ev.email_id}.{" "}
                  <Link href={evidenceHref(ev.email_id, ev.snippet_id, ev.quote)} className={s.evidenceLink}>
                    Show passage in message
                  </Link>
                </p>
                {ev.support?.review && <ReviewNote notes={ev.support.notes} />}
              </li>
            ))}
          </ul>
        </section>

        <section className={s.inspSection} aria-labelledby="edge-src">
          <h3 id="edge-src" className={s.h3}>
            Source messages ({sources.length})
          </h3>
          <SourceList sources={sources} />
        </section>

        {related.length > 0 && (
          <section className={s.inspSection} aria-labelledby="edge-find">
            <h3 id="edge-find" className={s.h3}>
              Cross-email findings in its messages ({related.length})
            </h3>
            <ul className={s.plain}>
              {related.map((f) => (
                <li key={f.finding.id}>
                  <FindingCompact item={f} />
                </li>
              ))}
            </ul>
            <p className={s.muted}>A difference like this is a reason to verify, not proof of fraud.</p>
          </section>
        )}
      </div>
      {first && <OpenOriginal emailId={first} />}
    </aside>
  );
}

