import { useEffect, useMemo, useRef, useState } from "react";
import type { EmailDetailResponse, RiskIndicator } from "@mri/shared";
import { ApiRequestError, api } from "../lib/api";
import { announce } from "../lib/announce";
import { buildClaims, type Claim, type SegmentRef } from "../lib/claims";
import { CATEGORY_LABEL, RISK_LABEL, basisChip, basisLine, predicateLabel, statusCopy, tagLabel, errorMessage } from "../lib/copy";
import { findingFacts } from "../lib/findings";
import { formatAddresses, formatDateTime, pluralize, senderName } from "../lib/format";
import { useResource, usePolling } from "../lib/hooks";
import type { HighlightRange } from "../lib/highlight";
import { buildUrl, DEFAULT_ROUTE } from "../lib/router";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { RiskBadge } from "./RiskBadge";
import { SourceText } from "./SourceText";
import { Button, Callout, Chip, EmptyState, Skeleton } from "./ui";
import s from "./InvestigationPane.module.css";

interface Props {
  id: string;
  aiConfigured: boolean;
  backHref: string;
  /** Called after the user started analysis so the mailbox list refreshes. */
  onChanged: () => void;
}

const POLL_MS = 2500;

export function InvestigationPane({ id, aiConfigured, backHref, onChanged }: Props) {
  const detail = useResource((signal) => api.getEmail(id, signal), [id]);
  const working = detail.data?.processing.in_progress ?? false;
  usePolling(detail.reload, working, POLL_MS);

  // When a run that was in progress finishes, tell the list and announce it once.
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working && detail.data) {
      onChanged();
      announce(`Analysis finished: ${statusCopy(detail.data.processing.status, aiConfigured).title}.`);
    }
    wasWorking.current = working;
  }, [working, detail.data, aiConfigured, onChanged]);

  if (detail.error && !detail.data) {
    const notFound = detail.error instanceof ApiRequestError && detail.error.status === 404;
    return (
      <article className={s.pane}>
        <BackLink href={backHref} />
        <div className={s.pad}>
          <Callout tone="bad" icon="alert-circle" title={notFound ? "Message not found" : "Could not load this message"} role="alert">
            <p>{notFound ? "It may have been removed, or the link is wrong." : detail.error.message}</p>
            {!notFound && (
              <p>
                <Button onClick={detail.reload}>
                  <Icon name="refresh" size={14} /> Try again
                </Button>
              </p>
            )}
          </Callout>
        </div>
      </article>
    );
  }

  if (!detail.data) {
    return (
      <article className={s.pane} aria-busy="true" aria-label="Loading message">
        <BackLink href={backHref} />
        <div className={s.pad}>
          <Skeleton width="60%" height={26} />
          <div style={{ height: 12 }} />
          <Skeleton width="40%" />
          <div style={{ height: 24 }} />
          <Skeleton height={120} />
        </div>
      </article>
    );
  }

  return (
    <Loaded
      key={detail.data.email.id}
      detail={detail.data}
      aiConfigured={aiConfigured}
      backHref={backHref}
      refreshing={detail.refreshing}
      refreshError={detail.error}
      reload={detail.reload}
      onChanged={onChanged}
    />
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <nav className={s.backBar} aria-label="Back to mailbox">
      <Link href={href} className={s.back}>
        <Icon name="chevron-left" size={18} />
        Mailbox
      </Link>
    </nav>
  );
}

function Loaded({
  detail,
  aiConfigured,
  backHref,
  refreshing,
  refreshError,
  reload,
  onChanged,
}: {
  detail: EmailDetailResponse;
  aiConfigured: boolean;
  backHref: string;
  refreshing: boolean;
  refreshError: Error | null;
  reload: () => void;
  onChanged: () => void;
}) {
  const { email, processing, risk, assessment, extraction } = detail;
  const claims = useMemo(() => buildClaims(detail), [detail]);
  const [activeClaim, setActiveClaim] = useState<string | null>(null);
  const [segIndex, setSegIndex] = useState(0);
  const messageRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // A newly opened message takes focus at its heading, so keyboard and screen-reader users land
  // on the content they chose (this is also what makes the mobile drill-down usable).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const segments = useMemo(() => {
    const list: { ref: SegmentRef; label: string; text: string; note?: string }[] = [
      { ref: { kind: "body" }, label: "Message", text: email.body },
    ];
    email.attachments.forEach((a, index) => {
      if (a.extracted_text) {
        list.push({ ref: { kind: "attachment", index }, label: a.filename, text: a.extracted_text });
      }
    });
    return list;
  }, [email]);

  const current = segments[Math.min(segIndex, segments.length - 1)]!;
  const ranges: HighlightRange[] = useMemo(
    () =>
      claims
        .filter((c) => c.target && sameSegment(c.target.segment, current.ref))
        .map((c) => ({ start: c.target!.start, end: c.target!.end, claimId: c.id })),
    [claims, current],
  );

  // An automatic-check passage covering most of a document is drawn quietly (not hidden).
  const broadClaims = useMemo(
    () =>
      new Set(
        claims
          .filter((c) => c.group !== "ai" && c.target && c.target.end - c.target.start > 0.6 * (segments.find((sg) => sameSegment(sg.ref, c.target!.segment))?.text.length ?? Infinity))
          .map((c) => c.id),
      ),
    [claims, segments],
  );

  const show = (claim: Claim) => {
    if (!claim.target) return;
    const idx = segments.findIndex((sg) => sameSegment(sg.ref, claim.target!.segment));
    if (idx >= 0) setSegIndex(idx);
    setActiveClaim(claim.id);
    messageRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    announce("Evidence highlighted in the message.");
  };

  const status = statusCopy(processing.status, aiConfigured);
  const chip = basisChip(risk.basis);
  const claimsFor = (prefix: string) => claims.filter((c) => c.id.startsWith(prefix));
  const aiClaims = claims.filter((c) => c.group === "ai");
  const checks = risk.indicators.filter((i) => i.identity === undefined);

  return (
    <article className={s.pane} aria-labelledby="email-subject">
      <BackLink href={backHref} />
      <div className={s.scroll}>
        <header className={s.head}>
          <h1 id="email-subject" className={s.subject} ref={headingRef} tabIndex={-1}>
            {email.subject?.trim() || "(no subject)"}
          </h1>
          <dl className={s.meta}>
            <div>
              <dt>From</dt>
              <dd>{email.from ? formatAddresses([email.from]) : "Unknown sender"}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{email.to.length ? formatAddresses(email.to) : "No recipients listed"}</dd>
            </div>
            {email.cc.length > 0 && (
              <div>
                <dt>Cc</dt>
                <dd>{formatAddresses(email.cc)}</dd>
              </div>
            )}
            <div>
              <dt>Date</dt>
              <dd>{formatDateTime(email.date)}</dd>
            </div>
            {email.external_id && (
              <div>
                <dt>Reference</dt>
                <dd>{email.external_id}</dd>
              </div>
            )}
          </dl>
          {(email.missing_headers.length > 0 || email.warnings.length > 0) && (
            <div className={s.stack}>
              {email.missing_headers.length > 0 && (
                <Callout tone="info" icon="info" title="Some headers were not in the source">
                  <p>Missing: {email.missing_headers.join(", ")}. Nothing has been filled in for them.</p>
                </Callout>
              )}
              {email.warnings.length > 0 && (
                <Callout tone="warn" icon="alert-circle" title="Notes from reading the message">
                  <ul className={s.plainList}>
                    {email.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </Callout>
              )}
            </div>
          )}
        </header>

        {/* Verdict */}
        <section className={s.card} aria-labelledby="verdict-h">
          <h2 id="verdict-h" className={s.cardTitle}>
            Risk assessment
          </h2>
          <div className={s.verdict}>
            <RiskBadge level={risk.final_level} size="lg" />
            {chip.kind !== "none" && <Chip kind={chip.kind}>{chip.text}</Chip>}
          </div>
          <p className={s.lead}>{basisLine(risk)}</p>

          {risk.final_level === "unassessed" && (
            <Callout tone="info" icon="dashed-circle" title="Not assessed does not mean safe">
              <p>No verified AI assessment exists for this message, so it has not been judged either way.</p>
            </Callout>
          )}

          {risk.escalations.map((e) => (
            <Callout key={e.rule_id} tone="warn" icon="flag" title={`Raised to ${RISK_LABEL[e.to].toLowerCase()} by automatic checks`}>
              <p>{e.rationale}</p>
            </Callout>
          ))}
          {risk.disagreement && (
            <Callout tone={risk.disagreement.needs_review ? "warn" : "info"} icon="info" title="The AI and the automatic checks differ">
              <p>{risk.disagreement.summary}</p>
              {risk.disagreement.needs_review && <p>A person should review this message.</p>}
            </Callout>
          )}

          {assessment && (
            <div className={s.rationale}>
              <h3 className={s.h3}>Why the AI rated it this way</h3>
              <p>{assessment.risk.rationale}</p>
              <div className={s.chips}>
                {assessment.risk.tags.map((t) => (
                  <Chip key={t}>{tagLabel(t)}</Chip>
                ))}
                <Chip title="How sure the AI says it is">Confidence: {assessment.risk.confidence}</Chip>
              </div>
            </div>
          )}
          {extraction && !assessment && extraction.summary && (
            <div className={s.rationale}>
              <h3 className={s.h3}>What the message says</h3>
              <p>{extraction.summary}</p>
              <p className={s.muted}>Summary only. It is not a risk judgment.</p>
            </div>
          )}
        </section>

        {/* Analysis */}
        <AnalysisCard
          detail={detail}
          aiConfigured={aiConfigured}
          refreshing={refreshing}
          refreshError={refreshError}
          reload={reload}
          onChanged={onChanged}
          title={status.title}
        />

        {/* Evidence */}
        <section className={s.card} aria-labelledby="evidence-h">
          <h2 id="evidence-h" className={s.cardTitle}>
            Evidence
          </h2>
          {claims.length === 0 && risk.indicators.length === 0 && risk.findings.length === 0 ? (
            <EmptyState icon="shield" title="No evidence to show">
              {risk.final_level === "unassessed"
                ? "This message has not been analyzed and the automatic checks found nothing."
                : "Nothing in this message was flagged."}
            </EmptyState>
          ) : (
            <>
              {aiClaims.length > 0 && (
                <div className={s.group}>
                  <h3 className={s.h3}>
                    <Chip kind="ai">AI judgment</Chip> Passages the AI cited
                  </h3>
                  <ul className={s.evidenceList}>
                    {aiClaims.map((c) => (
                      <ClaimItem key={c.id} claim={c} active={activeClaim === c.id} onShow={show} />
                    ))}
                  </ul>
                </div>
              )}

              {checks.length > 0 && (
                <div className={s.group}>
                  <h3 className={s.h3}>
                    <Chip kind="rules">Automatic check</Chip> Rules applied to the text
                  </h3>
                  <ul className={s.indicatorList}>
                    {checks.map((ind) => (
                      <IndicatorItem key={ind.id} ind={ind} claims={claimsFor(`check-${ind.id}-`)} active={activeClaim} onShow={show} />
                    ))}
                  </ul>
                </div>
              )}

              {risk.findings.length > 0 && (
                <div className={s.group}>
                  <h3 className={s.h3}>
                    <Chip kind="warn">Cross-email finding</Chip> Compared with other messages
                  </h3>
                  <ul className={s.indicatorList}>
                    {risk.findings.map((f) => (
                      <li key={f.id} className={s.indicator}>
                        <p className={s.indicatorTitle}>{f.summary}</p>
                        <p className={s.muted}>
                          {f.identity === "consistent"
                            ? "Same sender domain and the same vendor name in the documents."
                            : "Tentative: the sender or vendor name did not fully match, so treat this as a lead."}
                        </p>
                        <dl className={s.facts}>
                          {findingFacts(f).map((r) => (
                            <div key={r.label}>
                              <dt>{r.label}</dt>
                              <dd>{r.value}</dd>
                            </div>
                          ))}
                        </dl>
                        {f.related_email_ids.length > 0 && (
                          <p className={s.related}>
                            Compared with:{" "}
                            {f.related_email_ids.map((rid, i) => (
                              <span key={rid}>
                                {i > 0 && ", "}
                                <Link href={buildUrl({ ...DEFAULT_ROUTE, emailId: rid })}>{rid}</Link>
                              </span>
                            ))}
                          </p>
                        )}
                        <ul className={s.evidenceList}>
                          {claimsFor(`cross-${f.id}-`).map((c) => (
                            <ClaimItem key={c.id} claim={c} active={activeClaim === c.id} onShow={show} />
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        {/* Message */}
        <section className={s.card} ref={messageRef} aria-labelledby="message-h">
          <h2 id="message-h" className={s.cardTitle}>
            Original message
          </h2>
          {segments.length > 1 && (
            <div className={s.tabs} role="group" aria-label="Choose document">
              {segments.map((sg, i) => (
                <button
                  key={i}
                  type="button"
                  className={s.tab}
                  aria-pressed={segments[Math.min(segIndex, segments.length - 1)] === sg}
                  onClick={() => setSegIndex(i)}
                >
                  {i > 0 && <Icon name="paperclip" size={14} />}
                  {sg.label}
                </button>
              ))}
            </div>
          )}
          {email.body_truncated && segIndex === 0 && (
            <Callout tone="warn" icon="alert-circle" title="Long message shortened">
              <p>Only the first part of this message was kept.</p>
            </Callout>
          )}
          {current.text.trim() === "" ? (
            <p className={s.muted}>This message has no text.</p>
          ) : (
            <SourceText
              text={current.text}
              ranges={ranges}
              activeClaimId={activeClaim}
              onMarkClick={(cid) => setActiveClaim(cid)}
              label={current.label}
              isBroad={(cid) => broadClaims.has(cid)}
            />
          )}
          <p className={s.muted}>
            {ranges.length > 0
              ? "Highlighted passages are evidence whose exact position was verified against this text."
              : "No verified evidence positions in this document."}
          </p>
          {email.attachments.length > 0 && (
            <ul className={s.attachments}>
              {email.attachments.map((a, i) => (
                <li key={i}>
                  <Icon name="paperclip" size={14} /> <strong>{a.filename}</strong>
                  <span className={s.muted}>
                    {" "}
                    ·{" "}
                    {a.extracted_text
                      ? a.text_origin === "extracted"
                        ? "text extracted from the file"
                        : "text supplied with the message"
                      : a.error_message || "no text available"}
                    {a.truncated ? " · shortened" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Entities */}
        {detail.entities.length > 0 && (
          <section className={s.card} aria-labelledby="entities-h">
            <h2 id="entities-h" className={s.cardTitle}>
              People, organizations and amounts
            </h2>
            <ul className={s.entities}>
              {detail.entities.map((en) => (
                <li key={en.key} className={s.entity}>
                  <span className={s.entityName}>{en.display_name}</span>
                  <Chip>{en.type}</Chip>
                  <Chip kind={en.origin === "ai" ? "ai" : "rules"}>{en.origin === "ai" ? "AI" : "Automatic"}</Chip>
                  {en.also_in.length > 0 && (
                    <span className={s.muted}>
                      Also in{" "}
                      {en.also_in.map((rid, i) => (
                        <span key={rid}>
                          {i > 0 && ", "}
                          <Link href={buildUrl({ ...DEFAULT_ROUTE, emailId: rid })}>{rid}</Link>
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {detail.relationships.length > 0 && (
              <>
                <h3 className={s.h3}>Relationships the AI cited</h3>
                <ul className={s.plainList}>
                  {detail.relationships.map((r) => {
                    const name = (k: string) => detail.entities.find((e) => e.key === k)?.display_name ?? k;
                    return (
                      <li key={r.key}>
                        <strong>{name(r.source)}</strong> {predicateLabel(r.predicate)} <strong>{name(r.target)}</strong>
                        {r.evidence[0] && <q className={s.inlineQuote}>{r.evidence[0].quote}</q>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        )}

        {/* Processing details */}
        <section className={s.card} aria-labelledby="proc-h">
          <h2 id="proc-h" className={s.cardTitle}>
            How this was analyzed
          </h2>
          <dl className={s.facts}>
            <div>
              <dt>Status</dt>
              <dd>{status.title}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {processing.provenance === "live"
                  ? "Live AI call"
                  : processing.provenance === "recorded"
                    ? "Recorded AI result"
                    : processing.provenance === "rules"
                      ? "Automatic checks only"
                      : "Not analyzed"}
              </dd>
            </div>
            {processing.model && (
              <div>
                <dt>Model</dt>
                <dd>{processing.model}</dd>
              </div>
            )}
            <div>
              <dt>Runs</dt>
              <dd>{processing.run_count}</dd>
            </div>
            {processing.updated_at && (
              <div>
                <dt>Updated</dt>
                <dd>{formatDateTime(processing.updated_at)}</dd>
              </div>
            )}
          </dl>
          {processing.warnings.length > 0 && (
            <ul className={s.plainList}>
              {processing.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  );
}

function sameSegment(a: SegmentRef, b: SegmentRef): boolean {
  return a.kind === b.kind && (a.kind === "body" || (b.kind === "attachment" && a.index === b.index));
}

function ClaimItem({ claim, active, onShow }: { claim: Claim; active: boolean; onShow: (c: Claim) => void }) {
  const place =
    claim.where === "header"
      ? "From the message headers"
      : claim.where === "attachment"
        ? `In attachment${claim.filename ? ` ${claim.filename}` : ""}`
        : "In the message body";
  return (
    <li className={`${s.claim} ${active ? s.claimActive : ""}`}>
      <blockquote className={s.quote}>{claim.quote}</blockquote>
      <div className={s.claimMeta}>
        <span className={s.muted}>{place}</span>
        {claim.target ? (
          <button type="button" className={s.showButton} onClick={() => onShow(claim)}>
            <Icon name="search" size={14} /> {claim.where === "attachment" ? "Show in attachment" : "Show in message"}
          </button>
        ) : (
          <span className={s.muted}>
            {claim.where === "header" ? "Not highlighted: headers are shown as quoted." : "Not highlighted: position could not be verified."}
          </span>
        )}
      </div>
    </li>
  );
}

function IndicatorItem({
  ind,
  claims,
  active,
  onShow,
}: {
  ind: RiskIndicator;
  claims: Claim[];
  active: string | null;
  onShow: (c: Claim) => void;
}) {
  return (
    <li className={s.indicator}>
      <p className={s.indicatorTitle}>
        {ind.label} <Chip>{CATEGORY_LABEL[ind.category]}</Chip>
      </p>
      <p>{ind.detail}</p>
      {claims.length > 0 && (
        <ul className={s.evidenceList}>
          {claims.map((c) => (
            <ClaimItem key={c.id} claim={c} active={active === c.id} onShow={onShow} />
          ))}
        </ul>
      )}
    </li>
  );
}

function AnalysisCard({
  detail,
  aiConfigured,
  refreshing,
  refreshError,
  reload,
  onChanged,
  title,
}: {
  detail: EmailDetailResponse;
  aiConfigured: boolean;
  refreshing: boolean;
  refreshError: Error | null;
  reload: () => void;
  onChanged: () => void;
  title: string;
}) {
  const { processing, email } = detail;
  const status = statusCopy(processing.status, aiConfigured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const inProgress = processing.in_progress;
  const complete = processing.status === "complete";
  // `can_reprocess` is false for a finished analysis and when the automatic retry limit is hit.
  const limitReached = !inProgress && !complete && !processing.can_reprocess;
  const canStart = !inProgress && !complete;
  const label = limitReached
    ? "Run again anyway"
    : processing.status === "not_started"
      ? aiConfigured
        ? "Analyze with AI"
        : "Run automatic checks"
      : "Retry analysis";

  const start = async () => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      await api.reprocess(email.id, { force: limitReached });
      announce("Analysis started.");
      onChanged();
      reload();
    } catch (err) {
      const e = err instanceof ApiRequestError ? err : null;
      setError(errorMessage(e?.code ?? "network_error", e?.message ?? "Could not start analysis."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={s.card} aria-labelledby="analysis-h">
      <h2 id="analysis-h" className={s.cardTitle}>
        Analysis
      </h2>
      <div className={s.analysisRow}>
        <div>
          <p className={s.statusTitle}>
            {inProgress && <span className={s.spinner} aria-hidden="true" />}
            {title}
          </p>
          <p className={s.muted}>{status.detail}</p>
          {inProgress && <Steps step={status.step} />}
        </div>
        {canStart && !confirming && (
          <Button variant={limitReached ? "secondary" : "primary"} busy={busy} onClick={limitReached ? () => setConfirming(true) : start}>
            <Icon name={limitReached ? "refresh" : "sparkle"} size={16} />
            {label}
          </Button>
        )}
      </div>
      {limitReached && !confirming && (
        <p className={s.muted}>This message has reached the automatic retry limit. You can still run it again by choice.</p>
      )}
      {limitReached && confirming && (
        <Callout tone="warn" icon="alert-circle" role="alert" title="Run this message again?">
          <p>
            It has already been run the automatic maximum number of times. Running it again sends the text of this one
            message to the AI service once more.
          </p>
          <p className={s.confirmRow}>
            <Button variant="primary" onClick={start} busy={busy}>
              Yes, run again
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </p>
        </Callout>
      )}
      {canStart && aiConfigured && (
        <p className={s.muted}>
          Choosing this sends the text of this one message to the configured AI service. Nothing is sent until you do.
        </p>
      )}
      {error && (
        <Callout tone="bad" icon="alert-circle" role="alert" title="Could not start analysis">
          <p>{error}</p>
        </Callout>
      )}
      {refreshError && !error && (
        <Callout tone="warn" icon="alert-circle" role="status" title="Could not refresh progress">
          <p>{refreshError.message}</p>
        </Callout>
      )}
      {refreshing && <span className="sr-only">Updating</span>}
      {processing.runs.length > 0 && !inProgress && (
        <details className={s.details}>
          <summary>
            {pluralize(processing.runs.length, "run")} recorded
          </summary>
          <ul className={s.plainList}>
            {processing.runs.map((r, i) => (
              <li key={i}>
                {formatDateTime(r.started_at)} · {r.outcome ?? "unfinished"}
                {r.stages.map((st) => (
                  <span key={st.stage} className={s.muted}>
                    {" "}
                    · {st.stage}: {st.outcome}
                    {st.dropped_items > 0 ? ` (${pluralize(st.dropped_items, "unsupported claim")} dropped)` : ""}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ["Queued", "Reading", "Assessing"];
  return (
    <ol className={s.steps} aria-label="Progress">
      {labels.map((l, i) => (
        <li key={l} className={i + 1 < step ? s.stepDone : i + 1 === step ? s.stepNow : ""} aria-current={i + 1 === step ? "step" : undefined}>
          {l}
        </li>
      ))}
    </ol>
  );
}

// Re-exported for tests.
export { sameSegment, senderName };
