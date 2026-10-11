import { useRef, type KeyboardEvent } from "react";
import type { EmailListItem, FinalRiskLevel } from "@mri/shared";
import { RISK_LABEL, RISK_ORDER, RISK_SHORT, basisChip, statusCopy } from "../lib/copy";
import { formatDay, pluralize, senderName } from "../lib/format";
import { isInProgress, riskCounts, type Mailbox } from "../lib/mailbox";
import { buildUrl, type RouteState } from "../lib/router";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { RiskBadge } from "./RiskBadge";
import { Button, Callout, Chip, EmptyState, Skeleton } from "./ui";
import s from "./InboxPane.module.css";

interface Props {
  route: RouteState;
  /** The (un-debounced) search text so typing feels immediate. */
  query: string;
  onQuery: (q: string) => void;
  onRoute: (patch: Partial<RouteState>, opts?: { replace?: boolean }) => void;
  mailbox: Mailbox;
  aiConfigured: boolean;
  onAdd: () => void;
}

export function InboxPane({ route, query, onQuery, onRoute, mailbox, aiConfigured, onAdd }: Props) {
  const { list, overview } = mailbox;
  const counts = overview.data ? riskCounts(overview.data) : null;
  const listRef = useRef<HTMLUListElement>(null);
  const filtered = route.risk.length > 0 || route.status.length > 0 || query.trim() !== "";

  const toggleRisk = (level: FinalRiskLevel) => {
    const next = route.risk.includes(level) ? route.risk.filter((r) => r !== level) : [...route.risk, level];
    onRoute({ risk: next }, { replace: true });
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const links = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-row]") ?? []);
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i === -1) return;
    e.preventDefault();
    links[Math.min(links.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  return (
    <section className={s.pane} aria-label="Mailbox">
      <div className={s.toolbar}>
        <div className={s.searchRow}>
          <label className={s.search}>
            <span className="sr-only">Search messages</span>
            <Icon name="search" size={16} />
            <input
              type="search"
              value={query}
              placeholder="Search messages"
              onChange={(e) => onQuery(e.target.value)}
              autoComplete="off"
            />
          </label>
          <Button variant="primary" onClick={onAdd} className={s.addButton}>
            <Icon name="plus" size={16} />
            <span>Add email</span>
          </Button>
        </div>

        <div className={s.filters} role="group" aria-label="Filter by risk">
          {RISK_ORDER.map((level) => {
            const on = route.risk.includes(level);
            const n = counts?.counts[level];
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                aria-label={`${RISK_LABEL[level]}${n !== undefined ? `, ${counts && !counts.complete ? "at least " : ""}${n}` : ""}`}
                className={s.filter}
                onClick={() => toggleRisk(level)}
                title={
                  counts && !counts.complete
                    ? `At least ${n} of the newest ${counts.basedOn} messages. The mailbox has ${counts.mailboxTotal}.`
                    : undefined
                }
              >
                <span>{RISK_SHORT[level]}</span>
                {n !== undefined && (
                  <span className={s.count}>
                    {counts && !counts.complete ? "≥" : ""}
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {counts && !counts.complete && (
          <p className={s.note} role="note">
            Counts cover only the newest {counts.basedOn} of {counts.mailboxTotal} messages, so they are lower bounds.
          </p>
        )}

        <div className={s.metaRow}>
          <p className={s.summary} aria-live="polite">
            {list.data
              ? list.data.total > list.data.count
                ? `Showing ${list.data.count} of ${list.data.total} ${filtered ? "matching " : ""}messages`
                : `${pluralize(list.data.total, filtered ? "matching message" : "message")}`
              : list.error
                ? "Mailbox unavailable"
                : "Loading…"}
            {list.refreshing && <span className={s.refreshing}> · updating</span>}
          </p>
          <div className={s.metaActions}>
            {filtered && (
              <button
                type="button"
                className={s.linkButton}
                onClick={() => {
                  onQuery("");
                  onRoute({ q: "", risk: [], status: [] }, { replace: true });
                }}
              >
                Clear filters
              </button>
            )}
            <button
              type="button"
              className={s.linkButton}
              onClick={() => onRoute({ order: route.order === "desc" ? "asc" : "desc" }, { replace: true })}
              aria-label={`Sorted ${route.order === "desc" ? "newest" : "oldest"} first. Change order.`}
            >
              {route.order === "desc" ? "Newest first" : "Oldest first"}
            </button>
          </div>
        </div>
      </div>

      <div className={s.scroll}>
        {list.error && !list.data ? (
          <div className={s.pad}>
            <Callout tone="bad" icon="alert-circle" title="The mailbox could not be loaded" role="alert">
              <p>{list.error.message}</p>
              <p>
                <Button onClick={mailbox.refresh}>
                  <Icon name="refresh" size={14} />
                  Try again
                </Button>
              </p>
            </Callout>
          </div>
        ) : list.loading ? (
          <ul className={s.list} aria-busy="true" aria-label="Loading messages">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className={s.skeletonRow}>
                <Skeleton width="45%" />
                <Skeleton width="80%" />
                <Skeleton width="30%" height={20} />
              </li>
            ))}
          </ul>
        ) : list.data && list.data.emails.length === 0 ? (
          filtered ? (
            <EmptyState icon="filter" title="No messages match">
              Try a different search or clear the filters.
            </EmptyState>
          ) : (
            <EmptyState
              icon="mail"
              title="The mailbox is empty"
              action={
                <Button variant="primary" onClick={onAdd}>
                  <Icon name="plus" size={16} />
                  Add an email
                </Button>
              }
            >
              Add an email by pasting its text or uploading a .txt, .eml or .pdf file.
            </EmptyState>
          )
        ) : (
          <ul className={s.list} ref={listRef} onKeyDown={onListKey}>
            {list.data?.emails.map((e) => (
              <Row key={e.id} email={e} route={route} selected={route.emailId === e.id} aiConfigured={aiConfigured} />
            ))}
          </ul>
        )}
        {list.error && list.data && (
          <div className={s.pad}>
            <Callout tone="warn" icon="alert-circle" title="Could not refresh" role="status">
              <p>Showing the last loaded list. {list.error.message}</p>
            </Callout>
          </div>
        )}
      </div>
    </section>
  );
}

function Row({
  email,
  route,
  selected,
  aiConfigured,
}: {
  email: EmailListItem;
  route: RouteState;
  selected: boolean;
  aiConfigured: boolean;
}) {
  const chip = basisChip(email.risk.basis, email.processing.provenance);
  const working = isInProgress(email);
  const status = statusCopy(email.processing.status, aiConfigured);
  const showStatus = working || email.processing.status === "failed" || email.processing.status === "partial";
  const href = buildUrl({ ...route, emailId: email.id, add: false });

  return (
    <li>
      <Link
        href={href}
        data-row
        className={`${s.row} ${selected ? s.selected : ""}`}
        aria-current={selected ? "true" : undefined}
      >
        <span className={s.rowTop}>
          <span className={s.sender}>{senderName(email.from)}</span>
          <span className={s.date}>{formatDay(email.date)}</span>
        </span>
        <span className={s.subject}>{email.subject?.trim() || "(no subject)"}</span>
        <span className={s.rowBottom}>
          <RiskBadge level={email.risk.final_level} size="sm" />
          {chip.kind !== "none" && <Chip kind={chip.kind}>{chip.text}</Chip>}
          {email.risk.escalated && <Chip kind="warn">Escalated</Chip>}
          {showStatus && (
            <Chip kind={email.processing.status === "failed" ? "warn" : undefined}>
              {working && <span className={s.dot} aria-hidden="true" />}
              {status.title}
            </Chip>
          )}
          {email.attachment_count > 0 && (
            <span className={s.attach} title={pluralize(email.attachment_count, "attachment")}>
              <Icon name="paperclip" size={14} />
              <span className="sr-only">{pluralize(email.attachment_count, "attachment")}</span>
              <span aria-hidden="true">{email.attachment_count}</span>
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
