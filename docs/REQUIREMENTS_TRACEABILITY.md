# Requirements traceability

Each explicit requirement of [`candidate_task_brief.md`](../candidate_task_brief.md) mapped to where
it is implemented, how it was tested, and what is not covered. **24 items: 21 Done, 2 Partial
(15, 24), 1 Not done (23).** Items 16–24 split the brief's tech constraints and deliverables; none is
an invented requirement. Status words are literal:
**Done** = implemented and exercised by an automated test or a recorded real-browser check;
**Partial** = implemented with a stated gap; **Not done** = absent.

Paths are relative to the repository root. Test files named without a directory are in
`server/src/__tests__/` (server) or beside the component (web).

| # | Requirement | Where | How tested | Status | Limitation |
|---|---|---|---|---|---|
| 1 | Inbox list seeded from `mock_mailbox_data.json` (sender, subject, date, colour-coded risk badge) | `server/src/ingestion/seed.ts`, `server/src/startup.ts`, `GET /api/emails`; `web/src/components/InboxPane.tsx`, `RiskBadge.tsx` | `seed.test.ts`, `startup.test.ts`, `api-mailbox.test.ts`, `web/src/App.test.tsx` | Done | List is capped (default 100, max 500); counts from a capped list are labelled as lower bounds |
| 2 | Add an item by pasting raw text | `server/src/ingestion/parseText.ts`, `ingest.ts`; `POST /api/emails`; `web/src/components/AddEmail.tsx` | `ingest-text.test.ts`, `api-ingest.test.ts`, `App.test.tsx` | Done | Heuristic header recognition; header-less text is stored with missing headers flagged |
| 3 | Upload `.txt` / `.eml` / `.pdf`, same pipeline as seed | `ingest.ts`, `parseMime.ts`, `pdf.ts`, `attachments.ts`; multer upload route | `ingest-eml.test.ts`, `ingest-pdf.test.ts`, `pdf-errors.test.ts`, `upload-safety.test.ts`, `api-ingest.test.ts` | Done | PDFs: text layer only; scanned PDFs are rejected with an explicit message. OCR is not required by the brief and is not offered. 5 MB / 30 page limits |
| 4 | Agent A: structured JSON (sender, recipients, date, subject, summary, key facts incl. amounts, dates, accounts, attachments) | `server/src/agents/extractionAgent.ts`, `deterministic.ts`, `source.ts`, prompts; schema in `shared/src/schemas.ts` | `agent-extraction.test.ts` (scripted fake LLM) | Done | Header fields are taken from code, not the model; model output is validated and unverifiable facts are dropped |
| 5 | Agent B input is Agent A's structured output only | `server/src/agents/riskAgent.ts`; chaining in `server/src/analysis/service.ts` | `agent-risk.test.ts`, `analysis-service.test.ts` | Done | Agent B receives Agent A's validated extraction and snippets, not the raw email |
| 6 | Agent B: risk level none/low/medium/high, rationale, tags | `riskAgent.ts`, `server/src/risk/aggregate.ts`, `indicators.ts` | `agent-risk.test.ts`, `risk-aggregate.test.ts`, `risk-indicators.test.ts`, `risk-pipeline.test.ts` | Done | "none" only from a validated AI assessment; rules are capped at medium (a deliberate tightening of the brief) |
| 7 | Entities (people, organizations, amounts, accounts, locations) and relationships | `riskAgent.ts`; `server/src/risk/entities.ts` | `risk-entities.test.ts`, `api-graph.test.ts` | Done | Relationship predicates are a fixed set; identity merging is conservative by design |
| 8 | Free-tier **or** local LLM (the brief permits either), choice documented, no paid key required | `server/src/llm/client.ts`, `llm/config.ts`; [README](../README.md#live-llm-setup); DECISIONS D7, D22 | `llm-client.test.ts` (scripted `fetch`), `llm-config.test.ts`, `health.test.ts` | Done | Choice: **Groq free tier** (`openai/gpt-oss-120b`), exercised in one recording session. Ollama / local models are **not implemented or tested** (not required, since either option suffices). Retry/429 paths were verified only against scripted responses |
| 9 | App works without a key (fallback documented) | `server/src/replay/*`, `analysis/automaticChecks.ts`, `.env.example`, README | `replay.test.ts`, `automatic-checks.test.ts`, clean-clone start with no `.env` (recorded in PROCESS.md, Phase 8) | Done | Replay covers only E001, E004, E007; other messages are rules-only |
| 10 | Failure path: call fails, times out, or returns garbage | `llm/client.ts`, `agents/callJson.ts` (one bounded repair), `analysis/service.ts` outcomes `partial`/`degraded`/`failed` | `llm-client.test.ts`, `agent-extraction.test.ts`, `agent-risk.test.ts`, `analysis-service.test.ts`, `api-recovery.test.ts` | Done | Failures were simulated; a real provider outage was not observed |
| 11 | Persistence of processed emails + entities/relationships | `server/src/storage/sqliteRepository.ts`, `schema.ts`; graph derived at read time | `storage.test.ts`, `analysis-storage.test.ts`, `api-graph.test.ts` | Done | Entities/relationships are stored inside the analysis record and aggregated on read, not in separate tables |
| 12 | Detail view: original content + structured extraction + risk rationale | `web/src/components/InvestigationPane.tsx`, `SourceText.tsx`, `Comparison.tsx` | `App.test.tsx`, `claims.test.ts`, `highlight.test.ts`, browser checks in PROCESS.md | Done | |
| 13 | Entities/relationships panel for the selected email | `InvestigationPane.tsx` (entities, "Show in graph"), `GET /api/emails/:id` | `App.test.tsx`, `GraphInvestigation.test.tsx` | Done | |
| 14 | Bonus: cross-email knowledge graph, interactive (pan/zoom, click node for connections) | `web/src/components/graph/*`, `web/src/lib/graph/*`, `GET /api/graph` | `lib/graph/*.test.ts`, `GraphPage.test.tsx`, `GraphInvestigation.test.tsx`, `GraphWorkspace.test.tsx`, `api-graph.test.ts`; real-browser runs recorded in PROCESS.md | Done | Real dataset is small (11 entities, 3 relationships with the recordings). Layout is deterministic but crossings are only reduced, not minimised; very large graphs are untested |
| 15 | Usable on a narrow viewport | CSS Modules breakpoints; mobile Overview/Map/Entities tabs | jsdom viewport tests; real-browser runs at 320, 375, 768 px (overflow and tap-target probes, recorded in PROCESS.md) | Partial | No device testing; only Chromium/Edge; a few inline links remain below 44 px |
| 16 | React + TypeScript; styling approach justified | `web/`; README "Tech stack" | typecheck, build | Done | |
| 17 | Node/Express backend | `server/` | all server tests | Done | |
| 18 | `.env.example` and fallback behaviour if the API is unavailable | `.env.example`; README sections "Rules-only fallback", "Live LLM setup" | `llm-config.test.ts`, `health.test.ts`; README consistency test `web/src/lib/docs.test.ts` | Done | |
| 19 | No auth needed | — | — | Done | Consequently the API is unauthenticated; see README "Security boundaries" |
| 20 | Tests | `server/src/__tests__/`, `web/src/**/*.test.*` | `npm test` | Done | Server 31 files / 600 tests, web 22 files / 231 tests; no test calls a provider; no end-to-end suite in CI (real-browser checks were manual scripts) |
| 21 | `README.md`: setup/run, architecture, decisions and tradeoffs, what next | [`README.md`](../README.md) | Commands verified from a fresh clone; `web/src/lib/docs.test.ts` checks anchors, links, claims | Done | |
| 22 | `PROCESS.md`: AI workflow, prompting, where the human corrected the agent | [`PROCESS.md`](../PROCESS.md) | — | Done | Early planning rounds are transcribed summaries, not verbatim logs (stated in the file) |
| 23 | Optional 3–5 min screen recording | — | — | Not done | Not part of the repository |
| 24 | Honest time statement | PROCESS.md | — | Partial | Total focused time was **not measured**; none is claimed |

## Things implemented beyond the brief

Recorded AI Replay (genuine model output replayed through the same validation), explicit
rules-only "automatic checks", evidence-verified highlighting, cross-email vendor comparison,
an origin guard for state-changing requests, and restart recovery of interrupted analyses.

## Known gaps against the brief's spirit

- Detection quality was never measured against labelled data; no accuracy claim is made.
- Only three of ten messages have AI assessments in the shipped state; the others need a live key.
- No authentication or authorization (permitted by the brief; unsuitable for deployment).
