import type { FinalRiskLevel } from "@mri/shared";
import { RISK_LABEL } from "../lib/copy";
import { Icon } from "./Icon";
import s from "./RiskBadge.module.css";

const ICON: Record<FinalRiskLevel, string> = {
  high: "alert-triangle",
  medium: "alert-circle",
  low: "circle-dot",
  none: "check-circle",
  unassessed: "dashed-circle",
};

/**
 * A risk level is always text + icon + color, never color alone. `unassessed` is drawn with a
 * dashed outline and the words "Not assessed": it must never be read as "none".
 */
export function RiskBadge({
  level,
  size = "md",
  qualifier,
}: {
  level: FinalRiskLevel;
  size?: "sm" | "md" | "lg";
  /** e.g. "Automatic checks": appended so a rules-only level is never mistaken for AI. */
  qualifier?: string;
}) {
  return (
    <span className={`${s.badge} ${s[level]} ${s[size]}`} data-level={level}>
      <Icon name={ICON[level]} size={size === "lg" ? 20 : 14} />
      <span>
        {RISK_LABEL[level]}
        {qualifier && <span className={s.qualifier}> · {qualifier}</span>}
      </span>
    </span>
  );
}
