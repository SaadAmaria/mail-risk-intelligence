# Requirements traceability

Each explicit requirement of [`candidate_task_brief.md`](../candidate_task_brief.md) mapped to where
it is implemented, how it was tested, and what is not covered. **24 items: 20 Done, 1 Partial
(15), 1 Exempt (19), 1 Completed, not delivered (23), 1 Satisfied (estimate) (24).** Items 16–24 split the brief's tech
constraints and deliverables; none is an invented requirement. Status words are literal and
describe **implementation as assessed by the author**:
**Done** = implemented and exercised by an automated test or a recorded real-browser check run by
the author; **Partial** = implemented with a stated gap; **Exempt** = the brief itself excludes it,
so it was not built (not a completed feature); **Not done** = absent (no row has this status since
2026-10-13); **Completed, not delivered** = the item exists and was approved by the operator, but it
has not been handed over to the interviewer and is not among the repository's tracked files; **Satisfied (estimate)** = the
disclosure is made through the operator's approximate estimate, which is not a precise measurement
and was not independently verified; it is kept apart from "Done". "20 Done" is therefore 20
implementation claims, not 20 independent certifications.

*Update, 2026-10-13:* row 23 was "Not done" until this date, because the optional screen recording
did not exist. The video "Mail Risk Intelligence" has since been completed, so the row is now
"Completed, not delivered". Later the same day it was published as an asset of the private GitHub
Release `demo-v1.0`. That is availability to people with repository access, not delivery: final
delivery to the interviewer is pending. Also on 2026-10-13, the candidate decided to make the
repository public as a portfolio project, after the recruiter confirmed that it may be shared
publicly; the statuses below do not change until the submission has been delivered. Rows 24, D04 and O01 were updated to match, and the README
section "Time spent" was renamed "Development Time" and shortened.

*Update, 2026-10-13 (process documents):* `PROCESS.md` is now the Engineering Delivery & Acceptance
Report. The chronological development log that this file cites for browser runs, the fresh-clone
check and "Phase N" records was archived unchanged as [`PROCESS_HISTORY.md`](PROCESS_HISTORY.md), and the
references below point there. The independent audits read that log (it was then named `PROCESS.md`);
no audit has seen the rewritten report.

*Correction, 2026-10-12:* row 24 was "Partial" until this date. That merged an honest inability to
measure with partial completion (audit finding H41). It was briefly "Estimate" (same day) and is now
"Satisfied (estimate)", with the operator's wording recorded.

*Implementation status is not independent verification.* The "how tested" column names this
project's own tests and checks (author evidence). The last column, added 2026-10-12, gives what the
independent audits themselves executed or inspected. Their findings and dispositions (H01–H71) are in
[`AUDIT_CLOSURE.md`](AUDIT_CLOSURE.md).

Paths are relative to the repository root. Test files named without a directory are in
`server/src/__tests__/` (server) or beside the component (web).

| # | Requirement | Where | How tested | Status | Limitation | Independent evidence (audits A–C; see [ledger](AUDIT_CLOSURE.md)) |
|---|---|---|---|---|---|---|
| 1 | Inbox list seeded from `mock_mailbox_data.json` (sender, subject, date, colour-coded risk badge) | `server/src/ingestion/seed.ts`, `server/src/startup.ts`, `GET /api/emails`; `web/src/components/InboxPane.tsx`, `RiskBadge.tsx` | `seed.test.ts`, `startup.test.ts`, `api-mailbox.test.ts`, `web/src/App.test.tsx` | Done | List is capped (default 100, max 500); counts from a capped list are labelled as lower bounds | Inspected; startup not run by an audit (A M01–M03, M19; B §7) |
| 2 | Add an item by pasting raw text | `server/src/ingestion/parseText.ts`, `ingest.ts`; `POST /api/emails`; `web/src/components/AddEmail.tsx` | `ingest-text.test.ts`, `api-ingest.test.ts`, `App.test.tsx` | Done | Heuristic header recognition; header-less text is stored with missing headers flagged | Inspected; browser ingestion not run (A M04; B §7) |
| 3 | Upload `.txt` / `.eml` / `.pdf`, same pipeline as seed | `ingest.ts`, `parseMime.ts`, `pdf.ts`, `attachments.ts`; multer upload route | `ingest-eml.test.ts`, `ingest-pdf.test.ts`, `pdf-errors.test.ts`, `upload-safety.test.ts`, `api-ingest.test.ts` | Done | PDFs: text layer only; scanned PDFs are rejected with an explicit message. OCR is not required by the brief and is not offered. 5 MB / 30 page limits | Inspected; browser ingestion not run; real hostile PDFs untested by anyone (A M05–M07; H33, H34) |
| 4 | Agent A: structured JSON (sender, recipients, date, subject, summary, key facts incl. amounts, dates, accounts, attachments) | `server/src/agents/extractionAgent.ts`, `deterministic.ts`, `source.ts`, prompts; schema in `shared/src/schemas.ts` | `agent-extraction.test.ts` (scripted fake LLM) | Done | Header fields are taken from code, not the model; model output is validated and unverifiable facts are dropped | Real agents replayed on E001/E004/E007 in memory (A, B; C: H69); clipping H26; semantic fields H25 |
| 5 | Agent B input is Agent A's structured output only | `server/src/agents/riskAgent.ts`; chaining in `server/src/analysis/service.ts` | `agent-risk.test.ts`, `analysis-service.test.ts` | Done | Agent B receives Agent A's validated extraction and snippets, not the raw email | **Independently verified** by replay (A M13; B §7) |
| 6 | Agent B: risk level none/low/medium/high, rationale, tags (a level above none must cite a quote that code found in the message; the level itself is the model's judgement) | `riskAgent.ts`, `server/src/risk/aggregate.ts`, `indicators.ts` | `agent-risk.test.ts`, `risk-aggregate.test.ts`, `risk-indicators.test.ts`, `risk-pipeline.test.ts` | Done | "none" only from a validated AI assessment; rules are capped at medium (a deliberate tightening of the brief) | Replay shows high/medium/none examples (B §7); quality never measured (H27) |
| 7 | Entities (people, organizations, amounts, accounts, locations) and relationships (the quote is code-verified; the relationship *type* is the model's reading, checked only for endpoint-type fit and, for accusatory types, for any supporting wording) | `riskAgent.ts`; `server/src/risk/entities.ts` | `risk-entities.test.ts`, `api-graph.test.ts` | Done | Relationship predicates are a fixed set; semantic support is model-asserted, not code-proven; identity merging is conservative by design (name/address pairs must be stated by the message; differing legal forms and differently described masked accounts are kept apart) | Identity and structural fixes executed by C (H05, H11–H24); meaning not verifiable (H06) |
| 8 | Free-tier **or** local LLM (the brief permits either), choice documented, no paid key required | `server/src/llm/client.ts`, `llm/config.ts`; [README](../README.md#live-llm-setup); DECISIONS D7, D22 | `llm-client.test.ts` (scripted `fetch`), `llm-config.test.ts`, `health.test.ts` | Done | Choice: **Groq free tier** (`openai/gpt-oss-120b`), exercised in one recording session. Ollama / local models are **not implemented or tested** (not required, since either option suffices). Retry/429 paths were verified only against scripted responses | Choice compliant (A T01; B §7); provider availability and billing not verified (H31) |
| 9 | App works without a key (fallback documented) | `server/src/replay/*`, `analysis/automaticChecks.ts`, `.env.example`, README | `replay.test.ts`, `automatic-checks.test.ts`, clean-clone start with no `.env` (recorded in [`PROCESS_HISTORY.md`](PROCESS_HISTORY.md), Phase 8) | Done | Replay covers only E001, E004, E007; other messages are rules-only. Capturing those recordings required the operator's Groq key; replaying them requires none | Replay executed (H69); keyless new input is rules-only (H32); clean-clone start author-reported only (H49) |
| 10 | Failure path: call fails, times out, or returns garbage | `llm/client.ts`, `agents/callJson.ts` (one bounded repair), `analysis/service.ts` outcomes `partial`/`degraded`/`failed` | `llm-client.test.ts`, `agent-extraction.test.ts`, `agent-risk.test.ts`, `analysis-service.test.ts`, `api-recovery.test.ts` | Done | Failures were simulated (a stalled response body, headers that never arrive, an endless body, HTTP errors, malformed output); a real provider outage was not observed. One deadline covers headers and body | Deadline, cancellation, queue and Agent-B-failure probes executed by C (H01–H04, H70); no real outage (H30) |
| 11 | Persistence of processed emails + entities/relationships | `server/src/storage/sqliteRepository.ts`, `schema.ts`; graph derived at read time | `storage.test.ts`, `analysis-storage.test.ts`, `api-graph.test.ts` | Done | Entities/relationships are stored inside the analysis record and aggregated on read, not in separate tables | Read paths on SQLite `:memory:` executed by C (H20–H22); real restart/disk not run by an audit (H50) |
| 12 | Detail view: original content + structured extraction + risk rationale | `web/src/components/InvestigationPane.tsx`, `SourceText.tsx`, `Comparison.tsx` | `App.test.tsx`, `claims.test.ts`, `highlight.test.ts`, browser checks in [`PROCESS_HISTORY.md`](PROCESS_HISTORY.md) | Done | | Component tests executed by C; browser not run by an audit (H45–H48) |
| 13 | Entities/relationships panel for the selected email | `InvestigationPane.tsx` (entities, "Show in graph"), `GET /api/emails/:id` | `App.test.tsx`, `GraphInvestigation.test.tsx` | Done | | Component tests executed by C; browser not run by an audit (H45–H48) |
| 14 | Bonus: cross-email knowledge graph, interactive (pan/zoom, click node for connections) | `web/src/components/graph/*`, `web/src/lib/graph/*`, `GET /api/graph` | `lib/graph/*.test.ts`, `GraphPage.test.tsx`, `GraphInvestigation.test.tsx`, `GraphWorkspace.test.tsx`, `api-graph.test.ts`; real-browser runs recorded in [`PROCESS_HISTORY.md`](PROCESS_HISTORY.md) | Done | Real dataset is small (11 entities, 3 relationships with the recordings). Layout is deterministic but crossings are only reduced, not minimised; very large graphs are untested | Aggregation executed by C (H24); browser interaction not independently verified (H45) |
| 15 | Usable on a narrow viewport | CSS Modules breakpoints; mobile Overview/Map/Entities tabs | jsdom viewport tests; real-browser runs at 320, 375, 768 px (overflow and tap-target probes, recorded in [`PROCESS_HISTORY.md`](PROCESS_HISTORY.md)) | Partial | No device testing; only Chromium/Edge; a few inline links remain below 44 px | Not independently verified (A M22; H46) |
| 16 | React + TypeScript; styling approach justified | `web/`; README "Tech stack" | typecheck, build | Done | | Typecheck executed by A, B and C |
| 17 | Node/Express backend | `server/` | all server tests | Done | | Typecheck executed by A, B and C |
| 18 | `.env.example` and fallback behaviour if the API is unavailable | `.env.example`; README sections "Rules-only fallback", "Live LLM setup" | `llm-config.test.ts`, `health.test.ts`; README consistency test `web/src/lib/docs.test.ts` | Done | | Inspected (A T05; B §7) |
| 19 | No auth/user accounts needed | — | — | Exempt (not built) | The brief excludes accounts; this is a scope exemption, not a completed feature. The API is unauthenticated; see README "Security boundaries" | Scope exemption confirmed (A T06; H64) |
| 20 | Tests | `server/src/__tests__/`, `web/src/**/*.test.*` | `npm test` | Done | Server 38 files / 701 tests, web 24 files / 281 tests (author-executed 2026-10-12, Phase 9D delta; re-executed by the author on 2026-10-13 at commit `35237a2`, same totals); no test calls a provider; no end-to-end suite in CI (real-browser checks were manual scripts) | C executed web 24 files / 281 tests and server 31 files / 563 tests; 7 file-writing server suites were excluded (H58) |
| 21 | `README.md`: setup/run, architecture, decisions and tradeoffs, what next | [`README.md`](../README.md) | Commands verified from a fresh clone by the author ([`PROCESS_HISTORY.md`](PROCESS_HISTORY.md), Phase 8); `web/src/lib/docs.test.ts` checks anchors, links, claims | Done | | Inspected; fresh-clone commands not re-run by an audit (H49) |
| 22 | `PROCESS.md`: AI workflow, prompting, where the human corrected the agent | [`PROCESS.md`](../PROCESS.md) (delivery and acceptance report; its section 3 describes the AI workflow) and the chronological log [`PROCESS_HISTORY.md`](PROCESS_HISTORY.md) | — | Done | Early planning rounds in the log are transcribed summaries, not verbatim logs (stated there). The report was written on 2026-10-13 from the log and the other records | Inspected; historical claims cannot authenticate themselves (H43) |
| 23 | Optional 3–5 min screen recording | The video "Mail Risk Intelligence": an asset of the repository's GitHub Release `demo-v1.0`, linked from README "Demo video"; not a tracked file | No automated test. The author checked picture timing and sound against the source recordings; the operator reviewed and approved the final video (2026-10-13) | Completed, not delivered | Completed 2026-10-13: approximately 5 minutes 57 seconds (longer than the brief's suggested 3–5 minutes), narrated by the project author. Published 2026-10-13 as a Release asset while the repository was private. The repository's public release was decided the same day; once it is public the asset can be downloaded without an access grant. Final delivery to the interviewer is pending. Until 2026-10-13 this row read "Not done": planned by the operator and not finished (2026-10-12) | Absent when audits A–C ran (H52); the completed video has not been reviewed by any audit |
| 24 | Honest time statement | README "Development Time" (until 2026-10-13: "Time spent"), PROCESS.md, [ledger](AUDIT_CLOSURE.md#development-time) | — | Satisfied (estimate) | "**Estimated project duration: Approximately 8 hours.** This estimate includes planning, development, testing, code review, documentation, and demo video production." The README calls it "an approximate estimate, not precisely tracked time" (wording set by the operator on 2026-10-13; the figure is unchanged). The demo video was completed on 2026-10-13, so its production is included in the estimate, which the operator confirmed unchanged on that date (until then this row said the video was planned and not yet recorded). The agent-session activity, and why it is not human working time, was reported in the README until 2026-10-13 and is now kept in the ledger | Disclosure satisfied; precise measurement not available; independent verification not performed (H40, H41) |

## Things implemented beyond the brief

Recorded AI Replay (genuine model output replayed through the same validation), explicit
rules-only "automatic checks", evidence-verified highlighting, cross-email vendor comparison,
an origin guard for state-changing requests, and restart recovery of interrupted analyses.

## Known gaps against the brief's spirit

- Detection quality was never measured against labelled data; no accuracy claim is made.
- Only three of ten messages have AI assessments in the shipped state; the others need a live key.
- No authentication or authorization (permitted by the brief; unsuitable for deployment).

## Evaluation criteria and delivery

Added 2026-10-12 (audit finding H63). The brief's evaluation criteria and the delivery itself are not
requirements to build, so they are **not counted** in the 24 items above. They are mapped here so
nothing in the brief is left out. "Author evidence" is this project's own; "Independent" is what
audits A–C established.

| Ref (audit A) | Criterion or deliverable | Author evidence | Independent | Ledger |
|---|---|---|---|---|
| E01 | Sensible assumptions and scoping | README decisions, DECISIONS.md | Partial / P2: scope exceeded a short take-home (A, B) | H39, H42 |
| E02 | AI workflow, autonomy and human corrections recorded | `PROCESS.md` (section 3) and the chronological log [`PROCESS_HISTORY.md`](PROCESS_HISTORY.md) | Pass on the documents; historical claims cannot authenticate themselves | H43, H44 |
| E03 | Separation of ingestion, orchestration, storage, API, UI | Layered `server/src`, shared contracts | Pass (A, B) | — |
| E04 | Bad input, agent errors, empty states | Error contracts, outcome states, empty states | Gaps found by A and B, fixes executed by C | H01–H04, H20–H22, H70 |
| E05 | At least some tests | 38 server + 24 web test files | C executed web 281 and server 563 of 701 | H58 |
| E06 | README clarity | README | Pass, after wording corrections | H59–H61 |
| E07 | Visual consistency | CSS Modules, tokens; author screenshots | Not independently verified | H48 |
| E08 | Responsiveness across breakpoints | Breakpoints; author Edge runs at 320/375/768 px | Not independently verified | H46 |
| E09 | Accessibility basics (contrast, keyboard, focus) | Focus handling, labels; author accessibility-tree checks | Not independently verified | H47 |
| E10 | Loading/empty/error polish | Component states | Component tests executed; visuals not verified | H48 |
| E11 | Graph interaction quality | Pan/zoom/selection; author browser runs | Not independently verified | H45 |
| E12 | Orchestration robustness | Bounded queue, one deadline, restart recovery | Executed by C | H01–H04, H70; limits H35, H36 |
| E13 | Extensible entity/relationship model | Shared schemas, structural rules | Coherent; heuristic identities, fixed predicates | H10, H13–H19 |
| E14 | API design | Explicit actions, error contract, bounded uploads | Pass (A) | — |
| D01 | Repository delivery (GitHub link or zip) | Private GitHub repository; all work since `633ddd1` is uncommitted. *Status note, 2026-10-13:* the sentence before this note describes 2026-10-12, when the row was written. That work (the approved audit remediation) was committed as `ea6c588` on 2026-10-12 and pushed to `origin/main`; the documentation commits `48cf19f` and `ec4adf6` followed and were also pushed. `main` is based on `ec4adf6` before the documentation commit that carries this note. *Publication note, 2026-10-13:* the candidate decided to make the repository public as a portfolio project, after the recruiter confirmed that it may be shared publicly | Access and handoff not verified | H51, H67 |
| D02 | README sections | README | Pass | row 21 above |
| D03 | PROCESS.md | `PROCESS.md` and the chronological log [`PROCESS_HISTORY.md`](PROCESS_HISTORY.md) | Pass (given on the chronological log, before the 2026-10-13 rewrite) | row 22 above |
| D04 | State honestly how long was spent | README "Development Time" (approximate overall estimate; the section was "Time spent" until 2026-10-13) | Disclosure satisfied; not independently verified; no precise measurement | H40, H41 |
| O01 | Optional screen recording | Completed 2026-10-13: "Mail Risk Intelligence", approximately 5 minutes 57 seconds; available as an asset of the repository's GitHub Release `demo-v1.0`; delivery to the interviewer pending (row 23 above) | Absent when audits A–C ran ("planned, not yet recorded"); the completed video has not been independently reviewed | H52 |
