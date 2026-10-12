import { RISK_LABEL, predicateLabel } from "../../lib/copy";
import { ReviewChip } from "../ReviewNote";
import { ORIGIN_LABEL, TYPE_SHORT } from "../../lib/graph/labels";
import type { GraphModel } from "../../lib/graph/model";
import s from "./Graph.module.css";

/**
 * The accessible alternative to the canvas: the same entities and relationships as real tables,
 * in the same stable order, sharing the same selection.
 */
export function GraphList({
  model,
  selectedId,
  onSelect,
  onSelectEdge,
}: {
  model: GraphModel;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSelectEdge?: (id: string) => void;
}) {
  const nodes = [...model.nodes].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label) || (a.id < b.id ? -1 : 1));

  return (
    <div className={s.listWrap}>
      <div className={s.tableScroll}>
        <table className={s.table}>
          <caption>Entities ({nodes.length})</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Source</th>
              <th scope="col">Risk signal</th>
              <th scope="col" className={s.num}>
                Messages
              </th>
              <th scope="col" className={s.num}>
                Relationships
              </th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id} className={n.id === selectedId ? s.rowSelected : ""}>
                <th scope="row">
                  <button
                    type="button"
                    className={s.rowButton}
                    aria-pressed={n.id === selectedId}
                    onClick={() => onSelect(n.id === selectedId ? null : n.id)}
                  >
                    {n.label}
                  </button>
                </th>
                <td>{TYPE_SHORT[n.type]}</td>
                <td>{ORIGIN_LABEL[n.origin]}</td>
                <td>{RISK_LABEL[n.maxRisk]}</td>
                <td className={s.num}>{n.emailIds.length}</td>
                <td className={s.num}>{n.degree}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={s.tableScroll}>
        <table className={s.table}>
          <caption>Relationships ({model.edges.length})</caption>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">Relationship</th>
              <th scope="col">To</th>
              <th scope="col" className={s.num}>
                Messages
              </th>
            </tr>
          </thead>
          <tbody>
            {model.edges.length === 0 && (
              <tr>
                <td colSpan={4} className={s.muted}>
                  No validated relationships yet.
                </td>
              </tr>
            )}
            {model.edges.map((e) => {
              const from = model.nodeById.get(e.source)!;
              const to = model.nodeById.get(e.target)!;
              return (
                <tr key={e.id}>
                  <th scope="row">
                    <button type="button" className={s.rowButton} onClick={() => onSelect(from.id)}>
                      {from.label}
                    </button>
                  </th>
                  <td>
                    {onSelectEdge ? (
                      <button type="button" className={s.rowButton} onClick={() => onSelectEdge(e.id)}>
                        {predicateLabel(e.predicate, to.type)}
                      </button>
                    ) : (
                      predicateLabel(e.predicate, to.type)
                    )}
                    {e.review && <> <ReviewChip /></>}
                  </td>
                  <td>
                    <button type="button" className={s.rowButton} onClick={() => onSelect(to.id)}>
                      {to.label}
                    </button>
                  </td>
                  <td className={s.num}>{e.emailIds.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
