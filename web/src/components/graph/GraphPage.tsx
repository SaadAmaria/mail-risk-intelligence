import { useEffect, useMemo, useRef, useState } from "react";
import type { EmailListItem } from "@mri/shared";
import { ApiRequestError, api } from "../../lib/api";
import { RISK_LABEL, RISK_ORDER, predicateLabel } from "../../lib/copy";
import { useMinWidth, useResource } from "../../lib/hooks";
import { activeFilterCount, applyFilters, isFiltering, typeCounts, type GraphFilters } from "../../lib/graph/filters";
import { ORIGIN_LABEL, TYPE_SHORT } from "../../lib/graph/labels";
import { graphMessages, rankRelationships, summarizeMailbox } from "../../lib/graph/ledger";
import { buildGraphModel } from "../../lib/graph/model";
import { computeSpatialLayout } from "../../lib/graph/spatial";
import { useEmailFindings } from "../../lib/graph/useFindings";
import type { RouteState } from "../../lib/router";
import { buildUrl, DEFAULT_ROUTE } from "../../lib/router";
import { announce } from "../../lib/announce";
import { Icon } from "../Icon";
import { Link } from "../Link";
import { ReviewChip } from "../ReviewNote";
import { RiskBadge } from "../RiskBadge";
import { Button, Callout, EmptyState, Skeleton } from "../ui";
import { TYPE_ICON } from "./EntityNode";
import { GraphCanvas } from "./GraphCanvas";
import { GraphList } from "./GraphList";
import { FindingStrip, Legend, NotConnected, SummaryStrip } from "./GraphPanels";
import { EdgeInspector, NodeInspector, StartPanel } from "./NodeInspector";
import s from "./Graph.module.css";

interface Props {
  route: RouteState;
  onRoute: (patch: Partial<RouteState>, opts?: { replace?: boolean }) => void;
  /** The real, unfiltered email list (for source messages and the "built from N of M" note). */
  emails: EmailListItem[] | null;
  totalEmails: number | null;
  /** Changes whenever the set of analyzed messages changes, so the graph is re-read. */
  refreshKey: number;
}

const inboxHref = buildUrl(DEFAULT_ROUTE);

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function GraphPage({ route, onRoute, emails, totalEmails, refreshKey }: Props) {
  const includeAmounts = route.gamounts;
  // The graph is re-read in the background when the set of analyzed messages changes; what is on
  // screen stays until the new data arrives (no flash back to a loading state).
  const graph = useResource((signal) => api.getGraph({ includeAmounts }, signal), [includeAmounts]);
  const seenKey = useRef(refreshKey);
  const { reload: reloadGraph } = graph;
  useEffect(() => {
    if (seenKey.current !== refreshKey) {
      seenKey.current = refreshKey;
      reloadGraph();
    }
  }, [refreshKey, reloadGraph]);
  const full = useMemo(() => (graph.data ? buildGraphModel(graph.data) : null), [graph.data]);

  const filters: GraphFilters = useMemo(
    () => ({ types: route.gtypes, origins: route.gorigin, risks: route.grisk, q: route.gq, connectedOnly: route.gconn }),
    [route.gtypes, route.gorigin, route.grisk, route.gq, route.gconn],
  );
  const filtered = useMemo(() => (full ? applyFilters(full, filters) : null), [full, filters]);
  const model = filtered?.model ?? null;

  const wide = useMinWidth(900);
  // The layout is a pure function of the visible model and the orientation.
  const layout = useMemo(() => (model ? computeSpatialLayout(model, { orientation: wide ? "horizontal" : "vertical" }) : null), [model, wide]);

  const inFull = full && route.node ? (full.nodeById.get(route.node) ?? null) : null;
  const selected = model && route.node ? (model.nodeById.get(route.node) ?? null) : null;
  const hiddenSelection = inFull && !selected ? inFull : null;
  const missingId = full && route.node && !inFull ? route.node : null;
  const selectedEdge = model && route.gedge ? (model.edgeById.get(route.gedge) ?? null) : null;

  const patch = (p: Partial<RouteState>) => onRoute(p, { replace: true });
  // On a narrow screen a selection is a navigation step (so Back returns to the map).
  const selectNode = (id: string | null) => onRoute({ node: id, gedge: null }, { replace: wide });
  const selectEdge = (id: string | null) => onRoute({ gedge: id, node: null }, { replace: wide });
  const clearSelection = () => onRoute({ node: null, gedge: null }, { replace: true });
  const reset = () => patch({ gtypes: [], gorigin: [], grisk: [], gq: "", gconn: false });

  const completeCount = emails ? emails.filter((e) => e.processing.status === "complete").length : null;
  // Messages that only had automatic checks (no AI) add header-derived people, never AI relationships.
  const automaticCount = emails ? emails.filter((e) => e.processing.automatic_checks_only).length : 0;
  const automaticNote =
    automaticCount > 0 ? ` and ${automaticCount} with automatic checks only (people from the headers; no AI relationships)` : "";
  const filteringOn = isFiltering(filters);
  const activeCount = activeFilterCount(filters);

  const [filtersOpen, setFiltersOpen] = useState<boolean | null>(null);
  // Collapsed by default so the graph itself is what the page opens on; it opens when filters are active.
  const open = filtersOpen ?? activeCount > 0;
  const [railOpen, setRailOpen] = useState(true);

  // Cross-email findings of the messages that are in the graph (read from each message's own record).
  const findingIds = useMemo(() => {
    if (!full || !emails) return [] as string[];
    const inGraph = new Set(full.nodes.flatMap((n) => n.emailIds));
    return emails.filter((e) => inGraph.has(e.id) && e.risk.finding_count > 0).map((e) => e.id).sort();
  }, [full, emails]);
  const findings = useEmailFindings(findingIds);

  const ranked = useMemo(() => (model ? rankRelationships(model, emails) : []), [model, emails]);
  const summary = useMemo(() => summarizeMailbox(emails), [emails]);
  const messages = useMemo(() => (full ? graphMessages(full, emails) : []), [full, emails]);
  const isolated = layout?.isolated ?? [];

  // Announce the outcome of a filter change politely, once the view has settled.
  const shown = filtered?.model.nodes.length;
  const shownEdges = filtered?.model.edges.length;
  useEffect(() => {
    if (!full || shown === undefined) return;
    announce(
      filteringOn
        ? `Showing ${shown} of ${full.nodes.length} entities and ${shownEdges} of ${full.edges.length} relationships.`
        : `Showing all ${full.nodes.length} entities.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, shownEdges, full?.nodes.length]);

  const hasSelection = route.node !== null || route.gedge !== null;
  const detailOnly = !wide && hasSelection;
  // Opening details on a narrow screen always lands at their top: no hunting for the panel.
  const pageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (detailOnly) pageRef.current?.scrollTo?.({ top: 0 });
  }, [detailOnly, route.node, route.gedge]);
  const tab = route.gtab;
  const showList = wide ? route.gview === "list" : tab === "entities";

  const inspector =
    full && model && filtered ? (
      selectedEdge ? (
        <EdgeInspector model={full} edge={selectedEdge} emails={emails} findings={findings} onSelectNode={selectNode} onClear={clearSelection} />
      ) : (
        <NodeInspector
          model={full}
          node={selected ? (full.nodeById.get(selected.id) ?? null) : null}
          emails={emails}
          findings={findings}
          missingId={missingId}
          hiddenSelection={hiddenSelection}
          visibleIds={filtered.visibleIds}
          amountsHidden={!includeAmounts && !!route.node && route.node.startsWith("amount:")}
          onShowAmounts={() => patch({ gamounts: true })}
          onClearFilters={reset}
          onSelect={selectNode}
          onSelectEdge={selectEdge}
          start={
            <StartPanel
              compact={wide}
              ranked={ranked}
              isolatedCount={isolated.length}
              findings={findings}
              onSelectEdge={selectEdge}
              onShowIsolated={() => {
                setRailOpen(true);
                if (!wide) patch({ gtab: "entities" });
              }}
            />
          }
        />
      )
    ) : null;

  const searchAndFilters =
    full && model && filtered ? (
      <section className={s.filters} aria-label="Filters">
        <div className={s.filterBar}>
          <label className={s.search}>
            <span className="sr-only">Search entities by name</span>
            <Icon name="search" size={16} />
            <input
              type="search"
              value={route.gq}
              placeholder="Search entities"
              autoComplete="off"
              onChange={(e) => patch({ gq: e.target.value })}
            />
          </label>
          <button
            type="button"
            className={s.filterToggle}
            aria-expanded={open}
            aria-controls="graph-filter-panel"
            onClick={() => setFiltersOpen(!open)}
          >
            <Icon name="filter" size={16} />
            Filters{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
          <button type="button" className={s.resetButton} onClick={reset} disabled={!filteringOn}>
            Clear filters
          </button>
        </div>

        <div id="graph-filter-panel" className={s.filterPanel} hidden={!open}>
          <fieldset className={s.group}>
            <legend>Type</legend>
            {typeCounts(full).map(({ type, count }) => (
              <label key={type} className={s.check}>
                <input type="checkbox" checked={route.gtypes.includes(type)} onChange={() => patch({ gtypes: toggle(route.gtypes, type) })} />
                <span>
                  {TYPE_SHORT[type as keyof typeof TYPE_SHORT]} <span className={s.count}>{count}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className={s.group}>
            <legend>Source</legend>
            {(["ai", "rules"] as const).map((o) => (
              <label key={o} className={s.check}>
                <input type="checkbox" checked={route.gorigin.includes(o)} onChange={() => patch({ gorigin: toggle(route.gorigin, o) })} />
                <span>{o === "ai" ? "AI-identified" : `${ORIGIN_LABEL[o]} (not AI)`}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className={s.group}>
            <legend>Risk signal</legend>
            {RISK_ORDER.map((r) => (
              <label key={r} className={s.check}>
                <input type="checkbox" checked={route.grisk.includes(r)} onChange={() => patch({ grisk: toggle(route.grisk, r) })} />
                <span>{RISK_LABEL[r]}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className={s.group}>
            <legend>Options</legend>
            <label className={s.check}>
              <input type="checkbox" checked={route.gconn} onChange={(e) => patch({ gconn: e.target.checked })} />
              <span>Only entities with a visible relationship</span>
            </label>
            <AmountsToggle checked={includeAmounts} onChange={(v) => patch({ gamounts: v })} />
          </fieldset>
        </div>

        <p className={s.results} aria-live="polite">
          Showing <strong>{model.nodes.length}</strong> of {full.nodes.length}{" "}
          {full.nodes.length === 1 ? "entity" : "entities"} and <strong>{model.edges.length}</strong> of {full.edges.length}{" "}
          {full.edges.length === 1 ? "relationship" : "relationships"}
          {filteringOn
            ? ` (${filtered.hiddenNodes} ${filtered.hiddenNodes === 1 ? "entity" : "entities"} and ${filtered.hiddenEdges} ${
                filtered.hiddenEdges === 1 ? "relationship" : "relationships"
              } hidden by filters)`
            : ""}.
          {!includeAmounts && " Amounts are not included."}
        </p>
      </section>
    ) : null;

  const navigator =
    full && model ? (
      <nav className={s.navigator} aria-label="Investigation navigator">
        {searchAndFilters}

        <section className={s.navSection} aria-labelledby="nav-rel">
          <h2 id="nav-rel" className={s.navTitle}>
            Relationships to review <span className={s.count}>{ranked.length}</span>
          </h2>
          {ranked.length === 0 ? (
            <p className={s.muted}>None visible with the current filters.</p>
          ) : (
            <ul className={s.plain}>
              {ranked.map((r) => (
                <li key={r.edge.id}>
                  <button
                    type="button"
                    className={`${s.navRow} ${route.gedge === r.edge.id ? s.navRowActive : ""}`}
                    aria-pressed={route.gedge === r.edge.id}
                    onClick={() => selectEdge(route.gedge === r.edge.id ? null : r.edge.id)}
                  >
                    <span className={s.navSentence}>
                      {r.source.label} <em>{predicateLabel(r.edge.predicate, r.target.type)}</em> {r.target.label}
                    </span>
                    <span className={s.navMeta}>
                      <RiskBadge level={r.risk} size="sm" />
                      <span className={s.muted}>{r.messages.map((m) => m.id).join(", ")}</span>
                      {r.edge.review && <ReviewChip />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={s.navSection} aria-labelledby="nav-msg">
          <h2 id="nav-msg" className={s.navTitle}>
            Source messages <span className={s.count}>{messages.length}</span>
          </h2>
          <ul className={s.chipRow}>
            {messages.map((m) => (
              <li key={m.id}>
                <Link
                  href={buildUrl({ ...DEFAULT_ROUTE, emailId: m.id })}
                  className={s.msgChip}
                  title={m.known ? `${m.subject?.trim() || "(no subject)"} · ${m.sender ?? "Unknown sender"}` : `Message ${m.id}`}
                >
                  <Icon name="mail" size={13} /> {m.id}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className={s.navSection} aria-labelledby="nav-ent">
          <h2 id="nav-ent" className={s.navTitle}>
            Entities <span className={s.count}>{model.nodes.length}</span>
          </h2>
          {(
            [
              ["Connected", model.nodes.filter((n) => n.degree > 0)],
              ["Not connected", model.nodes.filter((n) => n.degree === 0)],
            ] as const
          ).map(([name, list]) =>
            list.length === 0 ? null : (
              <div key={name} className={s.navGroup}>
                <p className={s.navGroupName}>
                  {name} ({list.length})
                </p>
                <ul className={s.plain}>
                  {list.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className={`${s.navRow} ${s.navEntity} ${route.node === n.id ? s.navRowActive : ""}`}
                        aria-pressed={route.node === n.id}
                        aria-label={`${n.label}, ${TYPE_SHORT[n.type]}, ${n.origin === "ai" ? "AI-identified" : "Automatic"}`}
                        onClick={() => selectNode(route.node === n.id ? null : n.id)}
                      >
                        <Icon name={TYPE_ICON[n.type]} size={15} />
                        <span className={s.navEntityName}>{n.label}</span>
                        <span className={`${s.tag} ${n.origin === "ai" ? s.tagAi : s.tagRules}`}>{n.origin === "ai" ? "AI" : "Automatic"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </section>
      </nav>
    ) : null;

  const subtitle =
    full &&
    `${full.nodes.length} ${full.nodes.length === 1 ? "entity" : "entities"} · ${full.edges.length} ${
      full.edges.length === 1 ? "relationship" : "relationships"
    }${
      completeCount !== null && totalEmails !== null
        ? ` · from ${completeCount} of ${totalEmails} messages with a completed AI analysis${automaticNote}`
        : ""
    }`;

  return (
    <section ref={pageRef} className={s.page} aria-labelledby="graph-title">
      <header className={s.header}>
        <div className={s.headText}>
          <p className={s.eyebrow}>Investigation workspace</p>
          <h1 id="graph-title" className={s.title}>
            Knowledge graph
          </h1>
          {subtitle && <p className={s.sub}>{subtitle}</p>}
        </div>
        {wide && full && full.nodes.length > 0 && (
          <div className={s.toggle} role="group" aria-label="Graph view">
            <button type="button" aria-pressed={route.gview === "graph"} onClick={() => patch({ gview: "graph" })}>
              <Icon name="map" size={15} /> Graph
            </button>
            <button type="button" aria-pressed={route.gview === "list"} onClick={() => patch({ gview: "list" })}>
              <Icon name="list" size={15} /> List
            </button>
          </div>
        )}
      </header>

      {graph.error && !graph.data ? (
        <div className={s.state}>
          <Callout
            tone="bad"
            icon="alert-circle"
            role="alert"
            title={graph.error instanceof ApiRequestError && graph.error.status === 404 ? "Graph not found" : "The graph could not be loaded"}
          >
            <p>{graph.error.message}</p>
            <p>
              <Button onClick={graph.reload}>
                <Icon name="refresh" size={14} /> Try again
              </Button>
            </p>
          </Callout>
        </div>
      ) : graph.loading || !full || !filtered || !model || !layout ? (
        <div className={s.state} aria-busy="true" aria-label="Loading graph">
          <Skeleton height={28} width="40%" />
          <div style={{ height: 12 }} />
          <Skeleton height={320} />
        </div>
      ) : full.nodes.length === 0 ? (
        <div className={s.state}>
          <EmptyState
            icon="link"
            title="No entities in the graph yet"
            action={
              <Link href={inboxHref} className={s.inboxLink}>
                <Icon name="chevron-left" size={16} /> Back to the inbox
              </Link>
            }
          >
            The graph is built from analyzed messages
            {completeCount !== null && totalEmails !== null
              ? `: ${completeCount} of ${totalEmails} messages have a completed AI analysis${automaticNote}.`
              : "."}{" "}
            Open a message and run its analysis to add its people, organizations and accounts here.
          </EmptyState>
          <p className={s.basis}>{full.meta.basis}</p>
          <AmountsToggle checked={includeAmounts} onChange={(v) => patch({ gamounts: v })} />
        </div>
      ) : (
        <>
          {graph.error && (
            <div className={s.stateInline}>
              <Callout tone="warn" icon="alert-circle" role="status" title="Could not refresh the graph">
                <p>Showing the last loaded graph. {graph.error.message}</p>
              </Callout>
            </div>
          )}
          {full.droppedEdges > 0 && (
            <div className={s.stateInline}>
              <Callout tone="warn" icon="info" title="Some relationships were left out">
                <p>
                  {full.droppedEdges} relationship{full.droppedEdges === 1 ? "" : "s"} referred to an entity that is not in the
                  graph and {full.droppedEdges === 1 ? "was" : "were"} not drawn.
                </p>
              </Callout>
            </div>
          )}

          {detailOnly ? (
            <div className={s.detailOnly}>
              <nav className={s.backBar} aria-label="Back to the knowledge graph">
                <Link href={buildUrl({ ...route, node: null, gedge: null })} className={s.back}>
                  <Icon name="chevron-left" size={18} />
                  Knowledge graph
                </Link>
              </nav>
              {inspector}
            </div>
          ) : (
            <>
              {!wide && (
                <div className={s.tabs} role="tablist" aria-label="Knowledge graph sections">
                  {(
                    [
                      ["overview", "Overview"],
                      ["map", "Map"],
                      ["entities", "Entities"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      id={`graph-tab-${id}`}
                      aria-selected={tab === id}
                      aria-controls="graph-tabpanel"
                      className={s.tab}
                      onClick={() => patch({ gtab: id })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {wide ? (
                <div className={s.shell}>
                  {navigator}
                  <div className={s.stageCol}>
                    {summary && <SummaryStrip summary={summary} inboxHref={inboxHref} />}
                    {model.nodes.length === 0 ? (
                      <div className={s.state}>
                        <EmptyState icon="filter" title="No entities match these filters" action={<Button onClick={reset}>Clear filters</Button>}>
                          {full.nodes.length} {full.nodes.length === 1 ? "entity exists" : "entities exist"} in the graph; none matches the
                          current search and filters.
                        </EmptyState>
                      </div>
                    ) : showList ? (
                      <GraphList model={model} selectedId={selected ? selected.id : null} onSelect={selectNode} onSelectEdge={selectEdge} />
                    ) : (
                      <div className={s.stageCard}>
                        <StageBody
                          model={model}
                          layout={layout}
                          selectedNodeId={selected ? selected.id : null}
                          selectedEdgeId={selectedEdge ? selectedEdge.id : null}
                          onSelectNode={selectNode}
                          onSelectEdge={selectEdge}
                          findings={findings}
                          railOpen={railOpen}
                          onToggleRail={() => setRailOpen(!railOpen)}
                        />
                      </div>
                    )}
                    <p className={s.basis}>{full.meta.basis}</p>
                  </div>
                  <div className={s.inspectorCol}>{inspector}</div>
                </div>
              ) : (
                <div id="graph-tabpanel" role="tabpanel" aria-labelledby={`graph-tab-${tab}`} className={s.mobilePanel}>
                  {tab === "overview" && (
                    <>
                      {summary && <SummaryStrip summary={summary} inboxHref={inboxHref} />}
                      {inspector}
                      <FindingStrip findings={findings} />
                    </>
                  )}
                  {tab === "map" && (
                    <>
                      {searchAndFilters}
                      {model.nodes.length === 0 ? (
                        <div className={s.state}>
                          <EmptyState icon="filter" title="No entities match these filters" action={<Button onClick={reset}>Clear filters</Button>}>
                            {full.nodes.length} {full.nodes.length === 1 ? "entity exists" : "entities exist"} in the graph; none matches
                            the current search and filters.
                          </EmptyState>
                        </div>
                      ) : (
                        <div className={s.stageCard}>
                          <StageBody
                            model={model}
                            layout={layout}
                            selectedNodeId={selected ? selected.id : null}
                            selectedEdgeId={selectedEdge ? selectedEdge.id : null}
                            onSelectNode={selectNode}
                            onSelectEdge={selectEdge}
                            findings={findings}
                            railOpen={railOpen}
                            onToggleRail={() => setRailOpen(!railOpen)}
                          />
                        </div>
                      )}
                      <Legend />
                    </>
                  )}
                  {tab === "entities" && (
                    <>
                      {searchAndFilters}
                      {model.nodes.length === 0 ? (
                        <div className={s.state}>
                          <EmptyState icon="filter" title="No entities match these filters" action={<Button onClick={reset}>Clear filters</Button>}>
                            {full.nodes.length} {full.nodes.length === 1 ? "entity exists" : "entities exist"} in the graph; none matches
                            the current search and filters.
                          </EmptyState>
                        </div>
                      ) : (
                        <GraphList model={model} selectedId={selected ? selected.id : null} onSelect={selectNode} onSelectEdge={selectEdge} />
                      )}
                    </>
                  )}
                  <p className={s.basis}>{full.meta.basis}</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

/** The canvas card's content: connected structure, comparison findings, and the secondary collection. */
function StageBody({
  model,
  layout,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  findings,
  railOpen,
  onToggleRail,
}: {
  model: NonNullable<ReturnType<typeof applyFilters>["model"]>;
  layout: NonNullable<ReturnType<typeof computeSpatialLayout>>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  findings: ReturnType<typeof useEmailFindings>;
  railOpen: boolean;
  onToggleRail: () => void;
}) {
  const hasStructure = layout.nodes.size > 0;
  return (
    <>
      {hasStructure ? (
        <GraphCanvas
          model={model}
          layout={layout}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
        />
      ) : (
        <div className={s.noStructure}>
          <EmptyState icon="link" title="No relationships to draw">
            None of the visible entities has a relationship in the data (or the filters hide the other end). They are listed below
            under Not connected.
          </EmptyState>
        </div>
      )}
      <FindingStrip findings={findings} />
      <NotConnected
        model={model}
        ids={layout.isolated}
        selectedId={selectedNodeId}
        onSelect={onSelectNode}
        open={railOpen || !hasStructure}
        onToggle={onToggleRail}
      />
    </>
  );
}

function AmountsToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={s.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>Include amounts</span>
    </label>
  );
}
