import type { EmailListItem, EmailListResponse, FinalRiskLevel } from "@mri/shared";
import { basisChip } from "../lib/copy";
import { formatDay, senderName } from "../lib/format";
import { buildUrl, DEFAULT_ROUTE } from "../lib/router";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { RiskBadge } from "./RiskBadge";
import { Button, Chip, Skeleton } from "./ui";
import s from "./Welcome.module.css";

const SHOWN = 5;

/** Review order: what the system flagged first, then what has no verdict, then the rest. */
const PRIORITY: FinalRiskLevel[] = ["high", "medium", "low", "unassessed", "none"];

export function pickForReview(emails: EmailListItem[]): EmailListItem[] {
  return [...emails]
    .sort((a, b) => {
      const p = PRIORITY.indexOf(a.risk.final_level) - PRIORITY.indexOf(b.risk.final_level);
      if (p !== 0) return p;
      if (a.risk.needs_review !== b.risk.needs_review) return a.risk.needs_review ? -1 : 1;
      return (b.date ?? "").localeCompare(a.date ?? "");
    })
    .slice(0, SHOWN);
}

/**
 * Shown when no message is selected. It uses only what the mailbox really contains: no scores,
 * no invented conclusions, nothing is opened or analyzed until the user chooses.
 */
export function Welcome({
  overview,
  loading,
  aiConfigured,
  onAdd,
}: {
  overview: EmailListResponse | null;
  loading: boolean;
  aiConfigured: boolean;
  onAdd: () => void;
}) {
  const picks = overview ? pickForReview(overview.emails) : [];
  const flagged = overview ? overview.emails.filter((e) => ["high", "medium", "low"].includes(e.risk.final_level)).length : 0;
  const notAssessed = overview ? overview.emails.filter((e) => e.risk.final_level === "unassessed").length : 0;
  const capped = overview ? overview.total > overview.count : false;

  return (
    <div className={s.wrap}>
      <div className={s.inner}>
        <header className={s.intro}>
          <p className={s.eyebrow}>Investigation workspace</p>
          <h1 className={s.title}>Choose a message to investigate</h1>
          <p className={s.lead}>
            Every result shows who said it: the AI, an automatic rule, or a comparison with other messages, together
            with the exact passage behind it and its position in the original text.
          </p>
        </header>

        <section className={s.section} aria-labelledby="start-h">
          <div className={s.sectionHead}>
            <h2 id="start-h" className={s.h2}>
              Suggested starting points
            </h2>
            {overview && (
              <p className={s.muted}>
                {capped ? `From the newest ${overview.count} messages. ` : ""}
                {flagged} flagged by automatic checks · {notAssessed} not assessed
              </p>
            )}
          </div>
          {loading && !overview ? (
            <div className={s.skeletons} aria-busy="true">
              <Skeleton height={72} />
              <Skeleton height={72} />
              <Skeleton height={72} />
            </div>
          ) : picks.length === 0 ? (
            <div className={s.emptyBox}>
              <p>The mailbox has no messages yet.</p>
              <Button variant="primary" onClick={onAdd}>
                <Icon name="plus" size={16} /> Add an email
              </Button>
            </div>
          ) : (
            <ul className={s.picks}>
              {picks.map((e) => {
                const chip = basisChip(e.risk.basis);
                return (
                  <li key={e.id}>
                    <Link href={buildUrl({ ...DEFAULT_ROUTE, emailId: e.id })} className={s.pick}>
                      <span className={s.pickMain}>
                        <span className={s.pickSubject}>{e.subject?.trim() || "(no subject)"}</span>
                        <span className={s.pickMeta}>
                          {senderName(e.from)} · {formatDay(e.date)}
                        </span>
                      </span>
                      <span className={s.pickTags}>
                        <RiskBadge level={e.risk.final_level} size="sm" />
                        {chip.kind !== "none" && <Chip kind={chip.kind}>{chip.text}</Chip>}
                      </span>
                      <Icon name="chevron-right" size={18} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className={s.muted}>
            Opening a message only reads it. Nothing is sent to an AI service until you choose to analyze.
          </p>
        </section>

        <section className={s.section} aria-labelledby="read-h">
          <h2 id="read-h" className={s.h2}>
            How to read a result
          </h2>
          <dl className={s.legend}>
            <div>
              <dt>
                <Chip kind="ai">AI-assessed</Chip>
              </dt>
              <dd>
                {aiConfigured
                  ? "The AI judged the message, and every quote it cited was checked against the email."
                  : "Available once an AI service is configured. Quotes the AI cites are checked against the email."}
              </dd>
            </div>
            <div>
              <dt>
                <Chip kind="rules">Automatic checks only</Chip>
              </dt>
              <dd>Fixed rules found signals in the text. This is not an AI assessment and never rises above medium.</dd>
            </div>
            <div>
              <dt>
                <RiskBadge level="unassessed" size="sm" />
              </dt>
              <dd>No verified assessment exists yet. This is different from safe.</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
