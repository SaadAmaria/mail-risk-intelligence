import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import s from "./ui.module.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  large?: boolean;
  busy?: boolean;
}

export function Button({ variant = "secondary", large, busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        s.button,
        variant === "primary" && s.primary,
        variant === "ghost" && s.ghost,
        variant === "danger" && s.danger,
        large && s.large,
        className,
      )}
    >
      {busy && <span className={s.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Chip({
  kind,
  children,
  title,
}: {
  kind?: "ai" | "rules" | "warn";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(s.chip, kind === "ai" && s.chipAi, kind === "rules" && s.chipRules, kind === "warn" && s.chipWarn)}
    >
      {children}
    </span>
  );
}

export function Callout({
  tone = "neutral",
  title,
  icon,
  children,
  role,
}: {
  tone?: "neutral" | "info" | "warn" | "bad" | "good";
  title?: string;
  icon?: string;
  children?: ReactNode;
  role?: "alert" | "status";
}) {
  const toneClass = { info: s.calloutInfo, warn: s.calloutWarn, bad: s.calloutBad, good: s.calloutGood, neutral: "" }[tone];
  return (
    <div className={cx(s.callout, toneClass)} role={role}>
      {icon && (
        <span className={s.calloutIcon}>
          <Icon name={icon} size={18} />
        </span>
      )}
      <div className={s.calloutBody}>
        {title && <p className={s.calloutTitle}>{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Skeleton({ width = "100%", height = 14, style }: { width?: string | number; height?: number; style?: CSSProperties }) {
  return <span className={s.skeleton} style={{ width, height, ...style }} aria-hidden="true" />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <span className={s.emptyIcon}>
        <Icon name={icon} size={22} />
      </span>
      <p className={s.emptyTitle}>{title}</p>
      {children && <p className={s.emptyText}>{children}</p>}
      {action}
    </div>
  );
}
