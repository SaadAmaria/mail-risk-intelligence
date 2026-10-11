import { useEffect, useMemo, useRef, useState } from "react";
import type { EmailDetailResponse, ReplayStatus, RiskIndicator } from "@mri/shared";
import { ApiRequestError, api } from "../lib/api";
import { announce } from "../lib/announce";
import { buildClaims, resolveRelationshipEvidence, type Claim, type SegmentRef } from "../lib/claims";
import {
  CATEGORY_LABEL,
  RECORDED_NOTICE,
  RISK_LABEL,
  basisChip,
  basisLine,
  predicateLabel,
  statusCopy,
  tagLabel,
  errorMessage,
} from "../lib/copy";
import { formatAddresses, formatDateTime, pluralize, senderName } from "../lib/format";
import { useResource, usePolling } from "../lib/hooks";
import type { HighlightRange } from "../lib/highlight";
import { buildUrl, DEFAULT_ROUTE, readEvidenceParams, useSearch } from "../lib/router";
import { Comparison } from "./Comparison";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { RiskBadge } from "./RiskBadge";
import { SourceText } from "./SourceText";
import { Button, Callout, Chip, EmptyState, Skeleton } from "./ui";
import s from "./InvestigationPane.module.css";

interface Props {
  id: string;
  aiConfigured: boolean;
  replay?: ReplayStatus;
  backHref: string;
  /** Called after the user started analysis so the mailbox list refreshes. */
  onChanged: () => void;
}

const POLL_MS = 2500;

export function InvestigationPane({ id, aiConfigured, replay, backHref, onChanged }: Props) {
  const detail = useResource((signal) => api.getEmail(id, signal), [id]);
  const working = detail.data?.processing.in_progress ?? false;
  usePolling(detail.reload, working, POLL_MS);

  // When a run that was in progress finishes, tell the list and announce it once.
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working && detail.data) {
      onChanged();
      announce(`Analysis finished: ${statusCopy(detail.data.processing.status, aiConfigured, { automatic: detail.data.processing.automatic_checks_only }).title}.`);
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
      replay={replay}
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
  replay,
  backHref,
  refreshing,
  refreshError,
  reload,
  onChanged,
}: {
  detail: EmailDetailResponse;
  aiConfigured: boolean;
  replay?: ReplayStatus;
  backHref: string;
  refreshing: boolean;
  refreshError: Error | null;
  reload: () => void;
  onChanged: () => void;
}) {
  const { email, processing, risk, assessment, extraction } = detail;
  // An evidence deep link (from the knowledge graph) is resolved against THIS message's own
  // record; nothing in the URL is trusted and no text is marked unless it verifies.
  const search = useSearch();
  const evParam = useMemo(() => readEvidenceParams(search), [search]);
  const linked = useMemo(
    () => (evParam ? resolveRelationshipEvidence(detail, evParam.snippetId, evParam.quote) : null),
    [detail, evParam],
  );
  const claims = useMemo(() => {
    const base = buildClaims(detail);
    return linked?.status === "ok" ? [...base, linked.claim] : base;
  }, [detail, linked]);
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

  // Jump to the linked passage once, when the message first renders with it.
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (linked?.status !== "ok" || !linked.claim.target) return;
    if (handledLink.current === linked.claim.id + search) return;
    handledLink.current = linked.claim.id + search;
    show(linked.claim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, search]);

  const status = statusCopy(processing.status, aiConfigured, {
    provenance: processing.provenance,
    automatic: processing.automatic_checks_only,
  });
  const chip = basisChip(risk.basis, processing.provenance);
  const claimsFor = (prefix: string) => claims.filter((c) => c.id.startsWith(prefix));
  const aiClaims = claims.filter((c) => c.group === "ai");
  const checks = risk.indicators.filter((i) => i.identity === undefined);
  // Several findings often cite the same passage; list each distinct passage once.
  const crossClaims = useMemo(() => {
    const seen = new Set<string>();
    return claims.filter((c) => {
      if (c.group !== "cross") return false;
      const key = `${c.where}|${c.filename ?? ""}|${c.quote}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [claims]);

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
        <section className={s.hero} aria-labelledby="verdict-h">
          <h2 id="verdict-h" className={s.cardTitle}>
            Risk assessment
          </h2>
          <div className={s.verdict}>
            <RiskBadge level={risk.final_level} size="lg" />
            {chip.kind !== "none" && <Chip kind={chip.kind}>{chip.text}</Chip>}
          </div>
          <p className={s.lead}>{basisLine(risk)}</p>
          {processing.provenance === "recorded" && risk.basis === "ai_and_rules" && (
            <p className={s.muted}>
              Replayed from a recorded AI response{processing.model ? ` (${processing.model})` : ""}. No email was sent to
              an AI provider.
            </p>
          )}

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
          replay={replay}
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
          {linked?.status === "ok" && (
            <div className={s.group} data-testid="linked-evidence">
              <Callout tone="info" icon="link" title="Opened from the knowledge graph">
                <p>
                  This passage supports a relationship the AI recorded for this message.
                  {linked.claim.target
                    ? " It is highlighted in the original message below."
                    : " Its exact position in the text could not be verified, so it is shown as a quote and nothing is highlighted."}
                </p>
              </Callout>
              <ul className={s.evidenceList}>
                <ClaimItem claim={linked.claim} active={activeClaim === linked.claim.id} onShow={show} />
              </ul>
            </div>
          )}
          {linked?.status === "unavailable" && (
            <Callout tone="warn" icon="alert-circle" role="status" title="That evidence reference is not available">
              <p>
                {linked.reason === "unknown_snippet"
                  ? "The passage it points to is no longer part of this message's analysis (it may have been analyzed again)."
                  : linked.reason === "no_extraction"
                    ? "This message has no stored extraction, so the passage cannot be located."
                    : "It is not evidence of any relationship recorded for this message, so nothing was highlighted."}
              </p>
            </Callout>
          )}
          {claims.length === 0 && risk.indicators.length === 0 && risk.findings.length === 0 ? (
            <EmptyState icon="shield" title="No evidence to show">
              {risk.final_level === "unassessed"
                ? detail.processing.automatic_checks_only
                  ? "The automatic checks found nothing to flag. No AI analysis was performed, so this is not an AI assessment."
                  : "This message has not been analyzed and the automatic checks found nothing."
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
                  <p className={s.muted}>
                    A difference like these is a reason to verify with the vendor. It is not proof of fraud.
                  </p>
                  <ul className={s.indicatorList}>
                    {risk.findings.map((f) => (
                      <li key={f.id}>
                        <Comparison finding={f} />
                      </li>
                    ))}
                  </ul>
                  {crossClaims.length > 0 && (
                    <>
                      <p className={s.subLabel}>Where this appears in the message</p>
                      <ul className={s.evidenceList}>
                        {crossClaims.map((c) => (
                          <ClaimItem key={c.id} claim={c} active={activeClaim === c.id} onShow={show} />
                        ))}
                      </ul>
                    </>
                  )}
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
                  <Link
                    href={buildUrl({ ...DEFAULT_ROUTE, page: "graph", node: en.key, gamounts: en.type === "amount" })}
                    className={s.graphLink}
                    aria-label={`Show ${en.display_name} in the knowledge graph`}
                  >
                    Show in graph
                  </Link>
                  {en.also_in.length > 0 && (
                    <span className={s.muted}>
                      Also in{" "}
                      {en.also_in.map((rid, i) => (
                        <span key={rid}>
                          {i > 0 && ", "}
                          <Link href={buildUrl({ ...DEFAULT_ROUTE, emailId: rid })} className={s.alsoLink}>
                            {rid}
                          </Link>
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

const CLAMP_AT = 240;

function ClaimItem({ claim, active, onShow }: { claim: Claim; active: boolean; onShow: (c: Claim) => void }) {
  const [expanded, setExpanded] = useState(false);
  const long = claim.quote.length > CLAMP_AT;
  const place =
    claim.where === "header"
      ? "From the message headers"
      : claim.where === "attachment"
        ? `In attachment${claim.filename ? ` ${claim.filename}` : ""}`
        : "In the message body";
  return (
    <li className={`${s.claim} ${active ? s.claimActive : ""}`}>
      <blockquote className={`${s.quote} ${long && !expanded ? s.clamped : ""}`}>{claim.quote}</blockquote>
      {long && (
        <button type="button" className={s.moreButton} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show full quote"}
        </button>
      )}
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
  replay,
  refreshing,
  refreshError,
  reload,
  onChanged,
  title,
}: {
  detail: EmailDetailResponse;
  aiConfigured: boolean;
  replay?: ReplayStatus;
  refreshing: boolean;
  refreshError: Error | null;
  reload: () => void;
  onChanged: () => void;
  title: string;
}) {
  const { processing, email } = detail;
  // Recorded mode: no live provider, but compatible recordings exist. Only messages that have
  // one can be replayed; for the rest the honest answer is "automatic checks only".
  const recordedMode = !aiConfigured && Boolean(replay?.available);
  const hasRecording = recordedMode && Boolean(replay?.email_ids.includes(email.id));
  const mode: "live" | "recorded" | "none" = aiConfigured ? "live" : hasRecording ? "recorded" : "none";
  const status = statusCopy(processing.status, aiConfigured, {
    mode,
    provenance: processing.provenance,
    automatic: processing.automatic_checks_only,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const inProgress = processing.in_progress;
  const complete = processing.status === "complete";
  // `can_reprocess` is false for a finished analysis and when the automatic retry limit is hit.
  const limitReached = !inProgress && !complete && !processing.can_reprocess;
  const noRecording = recordedMode && !hasRecording;
  // Without live AI or a recording, the only action is the server's rules-only endpoint, which has
  // no path to a provider. It is offered only where the server says it would be accepted and would
  // add something (a record that holds an AI extraction, or is already rules-only, is not offered).
  // A server that does not report it falls back to the narrower "nothing stored, or failed" rule.
  const rulesOnly = mode === "none";
  const eligible =
    processing.automatic_checks_available ?? (processing.status === "not_started" || processing.status === "failed");
  const canAutomatic = rulesOnly && !inProgress && !complete && eligible;
  /** The state changed between loading this page and acting on it: show the real state, say so. */
  const RACE_CODES = ["already_complete", "already_processing", "ai_extraction_present"];
  const canStart = !inProgress && !complete && !rulesOnly;
  const label = limitReached
    ? "Run again anyway"
    : processing.status === "not_started"
      ? mode === "recorded"
        ? "Replay recorded analysis"
        : "Analyze with AI"
      : mode === "recorded"
        ? "Retry replay"
        : "Retry analysis";

  const runAutomatic = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.automaticChecks(email.id);
      announce("Automatic checks finished. No AI was used.");
      onChanged();
      reload();
    } catch (err) {
      const e = err instanceof ApiRequestError ? err : null;
      if (e && RACE_CODES.includes(e.code)) {
        // The server refused because the record changed (for example an AI result arrived): it was
        // left exactly as it was. Refresh so the page shows the real state.
        setError(`${errorMessage(e.code, e.message)} Nothing was changed; showing its current state.`);
        onChanged();
        reload();
      } else {
        setError(errorMessage(e?.code ?? "network_error", e?.message ?? "Could not run automatic checks."));
      }
    } finally {
      setBusy(false);
    }
  };

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
      if (e && RACE_CODES.includes(e.code)) {
        setError(`${errorMessage(e.code, e.message)} Showing its current state.`);
        onChanged();
        reload();
      } else {
        setError(errorMessage(e?.code ?? "network_error", e?.message ?? "Could not start analysis."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={s.panel} aria-labelledby="analysis-h">
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
        {canAutomatic && (
          <Button variant="primary" busy={busy} onClick={runAutomatic}>
            <Icon name="shield" size={16} />
            Run automatic checks
          </Button>
        )}
      </div>
      {limitReached && !confirming && (
        <p className={s.muted}>This message has reached the automatic retry limit. You can still run it again by choice.</p>
      )}
      {limitReached && confirming && (
        <Callout tone="warn" icon="alert-circle" role="alert" title="Run this message again?">
          <p>
            It has already been run the automatic maximum number of times.{" "}
            {mode === "recorded"
              ? "Replaying it again uses the recorded response; nothing is sent to an AI provider."
              : "Running it again sends the text of this one message to the AI service once more."}
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
      {canStart && mode === "recorded" && <p className={s.muted}>{RECORDED_NOTICE}</p>}
      {canAutomatic && (
        <p className={s.muted}>
          {noRecording
            ? "No recording exists for this message, so only automatic checks are available. Recordings cover the seeded messages only. "
            : "AI analysis is not available here. "}
          Automatic checks use fixed rules on this server. They do not use AI, and nothing is sent to Groq or any
          other AI provider. The message is not assessed by AI afterwards.
        </p>
      )}
      {noRecording && !canAutomatic && !complete && !inProgress && (
        <p className={s.muted}>
          No recording exists for this message, so no AI analysis is available. Automatic checks are shown above.
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
