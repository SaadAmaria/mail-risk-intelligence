import { Fragment, type CSSProperties, type KeyboardEvent } from "react";
import type { EntityType, FinalRiskLevel } from "@mri/shared";
import { RISK_LABEL } from "../../lib/copy";
import { ORIGIN_LONG, TYPE_LABEL, TYPE_SHORT } from "../../lib/graph/labels";
import type { GraphNodeModel } from "../../lib/graph/model";
import { Icon } from "../Icon";
import s from "./Graph.module.css";

/** One glyph per risk level. The letter is the non-colour channel for the level. */
export const RISK_GLYPH: Record<FinalRiskLevel, string> = {
  high: "H",
  medium: "M",
  low: "L",
  none: "✓",
  unassessed: "?",
};

export const TYPE_ICON: Record<EntityType, string> = {
  person: "user",
  organization: "building",
  account: "ledger",
  location: "pin",
  amount: "coin",
};

export function nodeAriaLabel(n: GraphNodeModel): string {
  const connections = n.degree === 1 ? "1 connection" : `${n.degree} connections`;
  const messages = n.emailIds.length === 1 ? "1 message" : `${n.emailIds.length} messages`;
  return (
    `${TYPE_LABEL[n.type]} ${n.label}. ${ORIGIN_LONG[n.origin]}. ` +
    `${RISK_LABEL[n.maxRisk]} among its source messages. ${connections}, ${messages}.`
  );
}

/** Lets long addresses and names wrap at natural points instead of overflowing or being cut. */
export function SoftBreaks({ text }: { text: string }) {
  const parts = text.split(/([@._/-])/);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {/^[@._/-]$/.test(p) && <wbr />}
        </Fragment>
      ))}
    </>
  );
}

export function riskMarkTitle(level: FinalRiskLevel): string {
  return level === "unassessed"
    ? "Appears only in messages that are not assessed"
    : level === "none"
      ? "Appears in a message where an AI assessment found no risk"
      : `Appears in a message rated ${RISK_LABEL[level]}`;
}

interface Props {
  node: GraphNodeModel;
  variant: "card" | "chip";
  selected: boolean;
  /** Dimmed because something else is selected and this is not related to it. */
  dimmed: boolean;
  /** Related to the selection (a neighbour): drawn normally, with a faint lift. */
  related?: boolean;
  /** Top-left position (cards only). */
  pos?: { x: number; y: number; w: number; h: number };
  /** Narrow-screen card: the same content, stacked into a smaller surface. */
  compact?: boolean;
  /** Entrance order, for the staggered rise. */
  index?: number;
  onSelect: (id: string | null) => void;
  /** The canvas swallows the click that ends a drag. */
  guard?: () => boolean;
}

/**
 * A floating entity surface. Type is carried by an icon and a word, provenance by a word and the
 * outline (solid + tinted = AI, dashed + white = automatic), and the message-risk signal by a
 * letter with its own accessible text. Colour never carries meaning on its own.
 */
export function EntityNode({ node, variant, selected, dimmed, related, pos, compact, index = 0, onSelect, guard }: Props) {
  const toggle = () => onSelect(selected ? null : node.id);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "Escape") {
      onSelect(null);
    }
  };
  const style: CSSProperties | undefined =
    variant === "card" && pos
      ? { left: pos.x, top: pos.y, width: pos.w, height: pos.h, ["--i" as string]: index }
      : { ["--i" as string]: index };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={nodeAriaLabel(node)}
      data-node-id={node.id}
      data-type={node.type}
      data-origin={node.origin}
      data-pos={pos ? `${pos.x},${pos.y}` : undefined}
      className={[
        variant === "card" ? s.card : s.chip,
        compact ? s.cardCompact : "",
        node.origin === "ai" ? s.ai : s.rules,
        selected ? s.selected : "",
        related ? s.related : "",
        dimmed ? s.dim : "",
      ].join(" ")}
      style={style}
      title={`${node.label} (${TYPE_LABEL[node.type]})`}
      onClick={(ev) => {
        ev.stopPropagation();
        if (guard?.()) return;
        toggle();
      }}
      onKeyDown={onKeyDown}
    >
      <span className={s.disc} aria-hidden="true">
        <Icon name={TYPE_ICON[node.type]} size={variant === "card" ? 18 : 15} />
      </span>
      <span className={s.nameBlock}>
        <span className={s.name}>
          <SoftBreaks text={node.label} />
        </span>
        <span className={s.metaRow}>
          <span className={`${s.tag} ${node.origin === "ai" ? s.tagAi : s.tagRules}`}>{node.origin === "ai" ? "AI" : "Automatic"}</span>
          <span className={s.typeWord}>{TYPE_SHORT[node.type]}</span>
        </span>
      </span>
      <span className={s.riskMark} data-risk-glyph={node.maxRisk} title={riskMarkTitle(node.maxRisk)} aria-hidden="true">
        <Icon name="mail" size={12} />
        <span>{RISK_GLYPH[node.maxRisk]}</span>
      </span>
    </div>
  );
}
