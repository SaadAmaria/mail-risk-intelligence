# PROCESS.md — AI-assisted development log

Chronological record of how this project was planned and built with AI tooling:
prompts, decisions, corrections, and observed results.

**Integrity rules for this file**
- Entries are appended when events happen; earlier entries are not rewritten.
- Planning rounds that happened before this file existed are transcribed below and
  marked `[transcribed]`. They are summaries of the conversation, not verbatim logs.
- Failures, dead ends, and corrections are recorded, not omitted.
- Times are not fabricated; where an exact time was not captured, only the date is given.

**Tooling:** Claude Code (VS Code extension), model `claude-sonnet-5-5`.
Humans: the candidate (decisions, approvals). Independent reviewer: a second AI
technical reviewer, whose findings the candidate relayed.

---

## 2026-10-11 — Round 1: independent analysis [transcribed]

- **Prompt (summary):** Act as architect/AI-systems engineer/security reviewer/QA lead.
  Analyze `candidate_task_brief.md` and `mock_mailbox_data.json` without implementing,
  modifying files, or assuming a prior stack. Deliver requirements matrix, seed audit,
  architecture options, two-agent pipeline, storage/API/UI, tests, time plan,
  interview risks, final recommendation.
- **Agent output (summary):** Requirements classified explicit/assumption/optional.
  Seed audit flagged E001 (CEO-fraud lookalike domain), E003 (insider exfiltration),
  E004 vs E009 (payment-detail change, needs cross-email context), E005 (MNPI tip),
  E006 (veiled threat), E008 (phishing), E010 (misconduct allegation); E002/E007/E009
  benign. Recommended Node/Express + TypeScript + SQLite + Vite/React.
- **Decision:** proceed to independent cross-review; no implementation authorized.
- **Known weakness in this round (identified later):** presented a rules-only engine as
  the zero-config path, and fed code signals into Agent B.

## 2026-10-11 — Round 2: cross-review of a second reviewer's findings [transcribed]

- **Prompt (summary):** Critically evaluate four reviewer concerns (LLM vs rules
  fallback, risk aggregation false positives, cross-email consistency, security
  boundaries); converge on a freeze candidate; do not agree merely for consensus.
- **Corrections the agent made to its own design:**
  - Rules-only mode is no longer a peer of LLM analysis; four distinct modes
    (`complete`, `partial`, `degraded`, `failed`) with a `none`-only-from-AI invariant.
  - Agent B input reduced to exactly Agent A's validated output.
  - Final risk and cross-email findings became derived at read time, not stored.
  - Dropped the multi-provider fallback chain as over-engineering.
- **Disagreement preserved:** floor mechanism kept (tiered, explained) rather than
  removed, because small free models are inconsistent and injection-prone.
- **Decision:** Architecture Freeze Candidate V1 accepted for external review.

## 2026-10-11 — Round 3: four mandatory corrections → Freeze V1.1 [transcribed]

- **Prompt (summary):** Apply four corrections: (1) evidence grounding via Agent A
  snippets; (2) recorded fixtures only from genuine successful dual-agent runs;
  (3) PDF mandatory; (4) edit distance / URL mismatch not conclusive, vendor identity
  ladder, negative tests. Working priority: full-stack/pipeline track (unconfirmed).
- **Resulting changes:** `evidence_snippets` with locations in Agent A output; fixture
  provenance fields and refusal rules; PDF moved into Phase 1; rules capped at
  `medium`; vendor match labeled `consistent`/`tentative`/`unknown`; regression tests
  for all four.
- **Flagged, not blocking:** recording fixtures needs a live provider run by the
  candidate; fixture checksums are not tamper-proof; transitive grounding limit.
- **Decision:** Freeze V1.1 approved by the candidate.

## 2026-10-11 — Repository preparation

- **Prompt (summary):** verify workspace, preserve original files, init Git locally,
  `.gitignore`, this file, folder structure, check `gh`; no implementation, no commit,
  no remote.
- **Actions taken by the agent:** `git init -b main`; created `.gitignore`, this file,
  and the approved folder skeleton with `.gitkeep` placeholders. Original assignment
  files left untouched in the repository root.
- **Observed:** `gh` 2.87.3 present and authenticated; workspace was not previously a
  Git repository.
- **Next:** wait for explicit authorization before committing or starting Phase 0.

## 2026-10-11 — GitHub setup + Phase 0 scaffold

- **Prompt (summary):** configure repo-local identity, commit the assignment files,
  `.gitignore`, PROCESS.md and skeleton; create a private `mail-risk-intelligence`
  repo and push; then implement Phase 0 only (workspaces, Vite/React/TS,
  Express/TS, shared zod schemas, scripts, `.env.example`, `.nvmrc`); no Phase 0 commit.
- **Git actions:** identity set locally; staged files scanned for credential patterns
  (only hit was the seed's phishing email text); initial commit `35bce3e`; private
  repo created and pushed; remote `main` matched local `HEAD`.
- **Phase 0 work:** npm workspaces `shared`, `server`, `web`; shared zod schemas for
  Agent A (`Extraction`, with `evidence_snippets`) and Agent B (`RiskAnalysis`), enums,
  health/error API types; Express `GET /api/health`; Vite React placeholder that
  fetches `/api/health` through the dev proxy and parses it with the shared schema.
- **Error and correction:** the first attempt wrote the whole scaffold in one shell
  heredoc script that failed to parse (unterminated quote). Nothing had been written
  (verified with `git status`), so the files were re-created individually with the
  file-write tool instead.
- **Observed results:** `npm install` OK (188 packages, 0 vulnerabilities); typecheck
  passes in all three workspaces; server and Vite dev server both boot; `/api/health`
  returns the same payload directly and through the proxy; `vite build` succeeds.
  The server prints a harmless "../.env not found" notice when no `.env` exists.
- **Not done (by design):** no storage, ingestion, agents, UI beyond a placeholder,
  and no tests (Phase 1+).

## 2026-10-11 — Phase 0 final verification (independent request)

- **Prompt (summary):** re-verify the actual repository without modifying files; report
  PASS/FAIL per check and whether Phase 0 is commit-ready.
- **Executed:** clean-copy `npm ci`, typecheck, `vite build`, root `npm run dev` boot with
  health via direct and proxied calls; workspace/link inspection; `git diff` and ignore
  checks; original-file diff against `HEAD`.
- **Result:** no blocking issues; findings F1–F8 recorded. Notable: F1 `DB_PATH` resolved
  relative to the wrong directory; F3 proxy port hardcoded; F4 server bound all interfaces.
- **Decision:** COMMIT_READY YES, with F1 recommended first. Commit not authorized yet.

## 2026-10-11 — Governance installed; Phase 0 findings closed

- **Prompt (summary):** the candidate approved three Phase 0 deviations (`tsx` runtime,
  shared package consumed from source, Node >=22.9.0 with Node 24 recommended) and
  authorized: persist governance in `CLAUDE.md`, create `docs/DECISIONS.md`, fix F1/F3/F4,
  validate, update PROCESS.md; no Phase 1, no commit, no push.
- **Created:** `CLAUDE.md` (the governance instructions as supplied), `docs/DECISIONS.md`
  (13 records plus grouped minor choices). Entries D1–D12 are explicitly marked
  retrospective; alternatives that were not discussed at the time are marked as such.
  Approvals are recorded only where they exist (Freeze V1.1 approval, the three explicit
  approvals above). D7's concrete default provider/model is recorded as still undecided.
- **Code/config changes (minimal):**
  - `.env.example`: `DB_PATH=./data/mail-risk.db` (relative to `server/`); added `HOST=127.0.0.1`.
  - `server/src/config.ts`, `server/src/index.ts`: bind `HOST` (default `127.0.0.1`).
  - `web/vite.config.ts`: dev proxy target follows `PORT` (shell env or root `.env`,
    default 3001) and uses `127.0.0.1`.
- **Failed attempt and correction:** the first smoke-test script probed the Vite server at
  `127.0.0.1:5173`, but on this machine Vite binds `localhost` (reported as `::1`), so the
  probe failed (`ok=False`) although the app was fine. The same run also left dev processes
  running because the process-tree kill missed `tsx watch` children, and the foreground
  call hit the 180 s tool timeout and was moved to the background. I confirmed the leftover
  PIDs were this repo's `vite`/`tsx` processes by command line, terminated them, then fixed
  the script (probe Vite via `localhost`; clean up by process tree plus repo-path match) and
  re-ran.
- **Executed validation (all after the changes):**
  - `npm run typecheck`: exit 0 in shared, server, web.
  - `npm run build`: exit 0 (`vite build`).
  - Default-port smoke: direct and proxied `/api/health` returned identical payloads;
    API listening on `127.0.0.1` only; the machine's LAN address (`10.0.0.10`) was not reachable.
  - Alternate-port smoke (`PORT=3105` in the environment): proxy followed; same results.
  - Root-`.env` smoke (`PORT=3106` in a temporary `.env`, deleted afterwards and
    confirmed gitignored): proxy followed; same results.
  - All dev processes were stopped after each run; no listeners remained.
- **Not executed:** Node versions below 24 (the 22.9 floor is untested); a second machine;
  automated tests (none exist yet).
- **Time:** not measured.
- **Next:** wait for explicit authorization to commit/push and for Phase 1.

## 2026-10-11 — Phase 0 commit pushed (documentation note)

- **Fact:** the Phase 0 scaffold, governance documents, and the F1/F3/F4 corrections were
  committed as `9631fa60f5bd89a704f077c0e06c42f24c4ce18e` and pushed to `origin/main` of the
  private repository. Local `HEAD`, `origin/main`, and `git ls-remote` matched afterwards
  and the working tree was clean.
- **Why recorded here:** that operation was authorized only for the commit and push, not for
  editing documentation, so this entry was added in Phase 1.

## 2026-10-11 — Phase 1: storage and ingestion

- **Prompt (summary):** implement Phase 1 only: SQLite persistence behind a repository,
  idempotent seeding of all 10 emails, a normalized ingestion pipeline for seed/paste/TXT/EML/
  text-PDF/PDF-in-EML, upload safety, deterministic tests; no agents, risk engine, graph,
  commit, or push.
- **Dependencies added (server):** `better-sqlite3`, `postal-mime`, `unpdf`; dev:
  `vitest`, `@types/better-sqlite3`. Installed without error; `better-sqlite3` loaded on
  Node 24.11.1 (SQLite 3.53.4).
- **Implemented:** shared `NormalizedEmail` contract; `server/src/ingestion/*` (limits,
  errors, text/HTML helpers, PDF extraction, MIME/text/seed parsers, validation,
  attachment and email normalization, ingest entry points, seed loader);
  `server/src/storage/*` (interface, SQLite and in-memory implementations, schema);
  server boot now opens the database and seeds it, closing it on SIGINT/SIGTERM. No HTTP
  endpoints were added (API is Phase 4).
- **Failures and corrections:**
  1. Typecheck failed on two pdf.js typing mismatches (`isEvalSupported` is not an option of
     the bundled version; `PDFDocumentProxy` has no `destroy`, the loading task does).
     Removed the option and used `doc.loadingTask.destroy()`.
  2. First test run: 76 of 79 passed, 3 failed.
     - *Real bug:* `SqliteRepository` leaked its database handle when the schema check threw,
       which locked the temp file on Windows. Fixed by closing the handle on init failure.
     - *Wrong test assumption → real behaviour gap:* I expected the PDF header block to be
       found, but pdf.js drops empty text runs, so the blank line separating headers from
       body vanished and the (correctly strict) splitter refused to guess. Confirmed by
       dumping the extracted text. Added a lenient mode used only for PDF-sourced text.
     - *Minor:* MIME-parsed bodies carried a trailing newline from the parser; trimmed.
  3. A debug test file was created temporarily to inspect the PDF text and removed
     afterwards; one console-based attempt printed nothing, so the dump was written to a
     file instead.
- **Executed validation (final state):**
  - `npm test`: 6 files, 80 tests, all passed (run from the repo root).
  - `npm run typecheck`: exit 0 in all workspaces.
  - `npm run build`: exit 0.
  - Real server boot twice against the default database path: first boot `10 created`,
    second `10 already present`; database held 10 emails and 4 attachment rows; chronological
    order started with E009; ports freed afterwards.
  - Phase 0 default-port smoke re-run: direct and proxied `/api/health` identical, API bound
    to `127.0.0.1`, LAN address unreachable.
  - Generated `server/data/` and temp test directories were removed afterwards.
- **Not executed / limitations:** no real-world PDFs or EMLs beyond generated fixtures and
  three small hand-written files; Node < 24 untested; no load or fuzz testing; the PDF
  parser runs in-process (timeout cannot preempt a synchronous parser loop).
- **Time:** not measured.
- **Next:** wait for independent review; no commit or push performed.

## 2026-10-11 — Phase 1 targeted review and corrective implementation

**Independent review findings (raised by the reviewer, investigated by Claude without
modifying files):**
- F1 seed identity / deduplication; F2 seed initialization failure; F3 PDF header inference;
  F4 repository hygiene; F5 test evidence.

**Defects reproduced by running the code (not just argued):**
1. *F1:* pasting content identical to E001 and then seeding left E001 missing; the seed
   report said `created 9, existing 1, errors []` (the loader counted `duplicate_content`
   as "existing"). Same via EML. My earlier D18 note that this case was "reported as
   `duplicate_content`" was wrong.
2. *F2:* missing file, malformed JSON, wrong shape, a UTF-8 BOM and invalid records all left
   the server running with `/api/health` 200 and 0–2 emails; field errors read
   `Required; Required; …`; DB failures printed raw stacks. (A first scenario run was
   confounded: PowerShell wrote my scratch JSON with a BOM, so cases B–D initially all
   failed with "not valid JSON". That exposed the BOM defect and I re-ran those cases with
   BOM-free files.)
3. *F3:* `Date: June 5` → `2001-06-04T21:00:00Z`; `06/07/2026` → 7 June; zone-less
   datetimes used the machine's timezone (different instants under another `TZ`); a PDF
   `Re: …` line after headers was dropped from the body.
4. *F5:* my D19 claim of testing "the exact size boundary" was overstated (the test used 52
   and 65 bytes against a 64-byte limit).

**Human-approved corrections (candidate's explicit decisions):** seed-scoped hashing with no
schema change and a documented dedupe trade-off; strict fail-fast startup with BOM
tolerance, field-path messages and sanitized DB errors, health contract unchanged;
never-invent dates and a recognized-header whitelist for lenient PDF parsing; remove only the
three obsolete `.gitkeep` files; exact boundary and reopen tests prioritized, other tests
only if justified.

**Implemented (Claude):**
- `normalize.ts`: hand-written date gate (RFC 5322 with explicit zone, ISO 8601 with
  `Z`/offset; no `Date.parse`; rollover and 2-digit years rejected); seed-scoped
  `computeContentHash`; warning text shows the raw value.
- `parseMime.ts`: read the raw `Date` header instead of the parser's coerced value.
- `parseText.ts`: lenient mode accepts only recognized header names; continuation lines are
  not honored in lenient mode.
- `seed.ts`: `loadSeedFile` (typed `SeedFileError`, BOM-tolerant, field-path messages,
  duplicate-id detection), `seedRecords`, `seedFromFile`; only `id_exists` counts as existing.
- New `startup.ts` (`initialize`, `StartupError`): validate whole file before writing,
  verify every id is stored, close the DB on failure. `index.ts` exits 1 with a short
  message on any `StartupError`.
- Removed `server/src/{ingestion,storage,__tests__/fixtures}/.gitkeep` (deleted on disk;
  not staged).
- Tests added/changed: date tables and timezone determinism, PDF header regressions, seed
  identity regressions, `startup.test.ts` (13), reopen assertions for attachments/raw
  source/provenance, exact size boundaries, binary attachment → `failed`, fetch spy, and
  `pdf-errors.test.ts` (6, pdf.js mocked).
- Decision records D14, D16, D18, D19, D20 updated with separate original / review /
  reproduced / approved / verified blocks; D21 (startup policy) added.

**Failures during this round:**
- Two existing tests failed after the date change because they matched the old warning
  wording; expectations were updated (intended behaviour change).
- One typing error in the new startup test (indexing an optional record) was fixed.
- My first scratch script for the experiments failed (CommonJS top-level await, then a
  Windows path needing a `file://` URL); fixed in the scratch script only.

**Executed validation (final state):**
- `npm test`: 8 files, **138 tests, 138 passed** (upload-safety 16, ingest-text 38,
  storage 25, ingest-eml 9, ingest-pdf 16, seed 15, pdf-errors 6, startup 13).
- `npm run typecheck`: exit 0 (shared, server, web). `npm run build`: exit 0.
- Real process, valid seeds: first start `10 created`, restart `0 created, 10 already
  present`; database held ids E001–E010 and 4 attachments (E003, E004, E007, E009) with text.
- Real process, seven failure modes (missing file, malformed JSON, wrong shape, empty file,
  partially invalid records, DB parent is a file, garbage DB file): each exited with code 1,
  printed a clear message, showed no stack trace, did not leak the body marker planted in
  the invalid record, and left no listening server.
- Phase 0 smoke: direct and proxied `/api/health` identical, API on `127.0.0.1`, LAN address
  unreachable.
- Originals unchanged; `HEAD` still equals `origin/main` (`9631fa6`); generated `server/data`
  and temp directories removed.

**Not verified / limitations:** genuine encrypted or stalled PDFs (only our mapping is tested
via a mock); real-world PDFs/EMLs beyond generated fixtures; Node < 24; wrapped PDF subjects
are truncated at the wrap; `fetch` spy does not cover other network APIs.

**Time:** not measured. **Next:** await independent review; no commit or push performed.

## 2026-10-11 — Phase 1 commit and Groq preflight (factual notes)

- **Phase 1 commit:** `78ce39b6eb95cac03882b0f864199d90bd94af14`
  (`feat(ingestion): add persistent mailbox storage and secure file parsing`) was pushed to
  `origin/main` of the private repository on authorization. Local `HEAD`, `origin/main` and
  `git ls-remote` matched afterwards and the working tree was clean. Before it: 138 tests in 8
  files passed, typecheck and build exit 0.
- **Groq preflight (candidate-configured key in `.env`, never printed):** one minimal
  `chat/completions` request with `response_format: json_object` returned HTTP 200 in 643 ms,
  model `openai/gpt-oss-120b`, valid JSON, usage 129 prompt + 130 completion tokens (107
  reasoning). `.env` was confirmed ignored and never committed. The response headers showed
  `x-ratelimit-remaining-tokens=7652`, which suggested a per-minute token budget of roughly
  8,000 (an inference, not verified in the provider's documentation).

## 2026-10-11 — Phase 2: LLM client, agents, orchestration

- **Prompt (summary):** candidate approved Groq free tier, `openai/gpt-oss-120b`, OpenAI-
  compatible API, strict Zod validation, configurable reasoning effort (start `low`), one
  provider implementation (Ollama-compatible where practical), no fallback chain. Scope: LLM
  client (timeouts, errors, 429/Retry-After, bounded retries, fix the `LLM_BASE_URL`
  health defect), Agent A with grounded snippets, Agent B with validated references, sequential
  orchestration with a bounded queue, states, provenance and restart recovery; deterministic
  tests with fake responses first, then only a few real calls with synthetic content. Out of
  scope: risk aggregation/cross-email rules, API endpoints, UI, graph, replay fixtures,
  commit/push.
- **Implemented (Claude):**
  - `llm/` (`config`, `client`, `types`, `json`) and `health.ts`;
  - `agents/` (`source`, `deterministic`, `callJson`, `errors`, `extractionAgent`,
    `riskAgent`, `prompts/{common,extraction,risk}`);
  - `analysis/` (`queue`, `service`);
  - `storage/analysisInvariants.ts` plus analysis methods on both repositories;
  - shared: `analysis.ts` types, `Extraction` header fields made explicit-missing;
  - `config.ts`, `index.ts` wiring (boot recovery, autostart flag off by default),
    `.env.example` documentation.
  - No new dependencies were added.
- **Failures and corrections during the work:**
  1. Typecheck: tests used `.catch(e => e as X)` which TypeScript widened to a union; replaced
     with a typed `rejection<E>()` helper.
  2. One test failed because of a wrong assumption of mine: I asserted Agent B never sees the
     attachment's text, but the attachment is a single line and its deterministic snippet *is*
     that line, which B correctly receives through A's extraction. Rewrote the assertion around
     an unextracted body line (a sentinel token that must not reach B).
  3. While designing the service tests I noticed that a full queue would have left an analysis
     marked `queued` that nothing would run. Fixed by checking capacity before writing and
     returning `queue_full`; covered by a test.
  4. Real-process scenario scripts failed three times for harness reasons (an unquoted path
     containing a space; PowerShell deleting an env var set to `''`, so a "blank key"
     scenario silently still had the key; fragile inline `node -e` quoting). Fixed in the
     scratch scripts only; the corrected scenarios are the ones reported below.
- **Executed validation:**
  - `npm test`: **15 files, 244 tests, 244 passed** (agent-extraction 19, agent-risk 14,
    analysis-service 21, analysis-storage 5, ingest-eml 9, ingest-pdf 16, ingest-text 38,
    llm-client 26, llm-config 15, pdf-errors 6, queue 6, seed 15, startup 13, storage 25,
    upload-safety 16). New in Phase 2: 106. All deterministic, no network.
  - **Live Groq calls (synthetic emails only, no seed data), 6 calls, all HTTP 200, 1 attempt
    each:** a wire-fraud-style email, a benign kitchen-rota email, and a prompt-injection email,
    each through A then B via the real orchestrator. All three reached `complete`/`live`.
    Tokens: 5,412 prompt + 1,595 completion (404 reasoning) = 7,007 total. Latency per call
    632–1,096 ms. One call waited about 20 s before sending: the client's pacing used the
    remaining-token header and paused to its 20 s cap (observed behaviour, not tuned).
    Ratings returned: wire `medium`, benign `none`, injection `high`; the wire email was
    expected to be at least as high as the injection one, which is exactly the kind of case
    Phase 3 aggregation exists for. These are single samples, not accuracy measurements.
  - **Real processes (scratch database, no provider traffic except where stated):** with the
    real env and `ANALYSIS_AUTOSTART` off, boot showed 10 emails and 0 analyses and
    `/api/health` reported `configured: true`, `provider: api.groq.com`; the key never appeared
    in any captured output. A malformed `LLM_BASE_URL` gave HTTP 200 with `configured: false`.
    A blank key for the hosted endpoint gave `configured: false` with a clear message. A
    planted interrupted analysis for E001 became `degraded` after restart with runs
    `["interrupted", "degraded"]`.
  - `npm run typecheck`: exit 0.
- **Not verified / limitations:** detection quality of the real model beyond three samples;
  behaviour against a local Ollama server (compatibility is by design, not tested); a genuinely
  slow or throttled provider across a full 10-email run; Node < 24; the 20 s pacing cap
  might be too conservative or too aggressive for other budgets; token estimates are rough.
- **Needs your decision/attention (also in DECISIONS.md D23, D26):** the shared `Extraction`
  contract change (nullable sender/subject, `missing_headers`); `ANALYSIS_AUTOSTART` default off
  until an API exists; entities stay inside the assessment JSON until Phase 3.
- **Time:** not measured. **Next:** independent review; nothing committed or pushed.

## 2026-10-11 — Phase 2 quality gate (findings F1–F3)

**Independent review result:** PASS_WITH_FINDINGS. The reviewer approved three decisions
(nullable sender/subject with explicit missing headers; `ANALYSIS_AUTOSTART=false` until an
API-triggered flow exists; health that distinguishes configured/valid configuration from
actual reachability) and raised F1 (evidence quality), F2 (health accuracy) and F3
(documentation/provenance).

**F1: reproduced, deterministic (scripted fake model, no network).** Before the fix, a
`high`/`medium`/`low` assessment with fabricated or missing evidence ended `complete` with
0 evidence in all 6 combinations tried; the code only added a warning. After the fix the same
script gives `status=partial`, no assessment, 3 calls (A, B, one repair) in all 6.

**Corrections made (Claude, authorized by the instruction):**
- *F1:* a level above `none` must cite at least one verifiable quote. One repair attempt, then
  the finding is withheld: stage `risk` `failed` / `ungrounded_assessment`, analysis `partial`,
  extraction kept, no assessment. The proposed level/confidence/tags/counts are kept as a
  sanitized sentence in the stage log; the free-text rationale is not retained, so no
  contract field was added. Existing write/read invariants untouched.
- *F2:* inspection showed the handler already made no provider call and could not throw. The
  additive change: `llm.reachability` (`unchecked`/`reachable`/`unreachable`/
  `credentials_rejected`), `last_call_at`, `last_error_kind`, `problems`, fed passively by the
  client after real calls; `configured` keeps its meaning and is now documented as not a
  reachability claim.
- *F3:* corrected D22 (the 20 s pacing wait is an inference from wall vs HTTP time, not a logged
  event), D24 (removed the "kept but flagged" behaviour), D26 and D23 (human approvals and the
  boot-time re-queue caveat), D27 (injection tests are all scripted-model tests; protections
  constrain what a persuaded model can do, they do not prevent persuasion), and added a
  test-provenance statement. New records: D29 (evidence invariant), D30 (health).

**Failures/corrections this round:**
- Five existing tests failed after the F1 change: two asserted the old exact health shape,
  one encoded the old "kept but flagged" behaviour, and two fixtures used a `high` level with
  no evidence (so they were testing an invalid answer). I updated them and introduced a `B_NONE`
  fixture (a valid answer needing no evidence) instead of weakening the invariant.
- I first miscounted the new regression tests in D29 (wrote 20, actual 24); corrected.

**Executed validation:**
- `npm test`: **16 files, 292 tests, 292 passed** (up from 244 / 15). All deterministic, no
  network. New/changed: health 25 (new file), agent-risk +16 net, analysis-service +7,
  llm-config adjusted.
- `npm run typecheck`: exit 0. `npm run build`: exit 0.
- **No live provider call was made in this round** (the fix is verifiable deterministically).
- Secret scan and diff review: see the final report for this round.

**Remaining limitations:** relevance of cited evidence is not verified (a real but irrelevant
quote passes); the withheld rationale is not retained; reachability is only as fresh as the last
real call; prompt-injection defence is still limited as described in D27 (Phase 3 signals not
built); retry/429 behaviour verified only against scripted responses.

**Time:** not measured. **Next:** independent review; nothing committed or pushed.

## 2026-10-11 — Phase 2 commit (factual note)

- **Phase 2 commit:** `4b79cdc3584968a5256f203399d19475668de5bb`
  (`feat(agents): implement grounded two-agent LLM pipeline`) was pushed to `origin/main` of the
  private repository on authorization; 41 files, 292 tests passing before the commit; local
  `HEAD`, `origin/main` and `git ls-remote` matched and the tree was clean.

## 2026-10-11 — Phase 3: risk intelligence, cross-email enrichment, entity identity

- **Prompt (summary):** implement deterministic observations/indicators, a pure aggregation
  function (rules never above `medium`; `high` only from a grounded AI `high`; never convert
  missing/failed AI into `none`), order-independent read-time cross-email enrichment (priority
  E004/E009, consistent/tentative/unknown identity), entity identity keys and relationship
  aggregation, security regression tests at the aggregation boundary, deterministic tests for
  the listed scenarios, documentation, and removal of only the obsolete `.gitkeep` files. Out
  of scope: REST endpoints, UI, recorded fixtures, graph rendering, commit/push.
- **Implemented (Claude):** `shared/src/risk.ts` (types); `server/src/risk/` (`domains`,
  `lexicon`, `evidence`, `indicators`, `vendor`, `aggregate`, `riskView`, `entities`);
  `ORG_DOMAINS` in `config.ts`/`.env.example`; five new test files plus a fixtures helper; three
  obsolete `.gitkeep` files removed. No new dependencies; no LLM or network call anywhere in
  this phase; no change to Phase 1/2 behaviour or contracts.
- **Failures and corrections during the work:**
  1. First run of the indicator tests: 37 of 39 passed, including every real-seed expectation.
     Two failures: a link with both a look-alike and a punycode label only reported the first
     reason (changed to report all reasons), and my test expected "today" to count as urgency
     (it deliberately does not; the test was wrong).
  2. First run of the aggregation tests: 6 failures caused by **my own fixture**: for E002 (which
     has no extractable value) the helper built an evidence-free positive finding, which the
     aggregator correctly refused to treat as assessed. The helper now attaches a real snippet.
     (Useful in itself: it is the "evidence-free claims are not trusted" rule firing.)
  3. Cross-email tests: two failures because vendor names were only read from attachments but a
     pasted invoice carries its header in the body; the code now reads both (attachments first).
  4. Entity tests: a real bug (title stripping ran before trimming, so " Mr. Robert" kept
     "mr") and a real weakness (initial-only names like "J. Roe" were treated as full names and
     could be merged across emails); both fixed, with a test for two different "J. Smith"s.
  5. Mutation check (temporary, restored byte-identical): letting rules return `high` made 2
     tests fail; reporting missing AI as `none` made 7 fail; trusting an evidence-free finding
     made 1 fail. All three invariants are therefore actually guarded by tests.
- **Observed on the real seed data (rules only, no AI):** E001 medium (look-alike sender, wire
  request, secrecy, urgency, out-of-band details, authority claim); E008 medium (look-alike
  sender and link, credential request, urgency); E003 medium; E005 medium; E006 medium (several
  distinct threats); E004 medium with `payment_account_changed` (6621 -> 9902) and
  `invoice_amount_anomaly` (3.4x) against E009, consistent identity, routing unchanged; E002,
  E007, E009 no indicators; E010 no indicators (an allegation needs the AI). None of them is
  `high` by rules, and without an AI none is shown as `none` ("unassessed" instead).
- **Executed validation:**
  - `npm test`: **21 files, 399 tests, 399 passed** (up from 292 / 16). New: risk-indicators 39,
    risk-aggregate 26, risk-crossemail 17, risk-entities 16, risk-pipeline 9 (107 total).
  - `npm run typecheck`: exit 0. `npm run build`: exit 0.
  - **No live provider call was made in this phase.** The earlier live-run results are unchanged
    and are not evidence about the rules.
- **Not verified / limitations:** the phrase lists and thresholds are my judgment and untested
  on real corpora (false negatives from rephrasing, and false positives, are possible); vendor
  parsing assumes invoice-like layouts; "consistent" identity is not authenticity; the entity
  graph quality depends on Agent B; no UI, API or graph rendering exists yet.
- **Needs your decision (also in DECISIONS.md D31–D36):** `ORG_DOMAINS` default; the
  `threat` (>= 2 phrases) rule; the 2x amount threshold; whether the `low` floor from a single
  indicator on an AI-`none` email is acceptable (kept per D5).
- **Time:** not measured. **Next:** independent review; nothing committed or pushed.

## 2026-10-11 — Phase 3 targeted quality gate (threat context, entity identity, rule evidence)

**Context:** Phase 3 had received PASS_WITH_FINDINGS. The candidate approved the five judgment
choices with qualifications (recorded in `docs/DECISIONS.md` D37) and asked for three targeted
checks. The Phase 2 commit it builds on is `4b79cdc3584968a5256f203399d19475668de5bb`, pushed to
`origin/main` earlier (already recorded above); `HEAD` and `origin/main` still both point at it.

**Reproduced first (synthetic inputs, real code, no network):**
- *A:* an incident report quoting "I know where your office is" / "I know people", and a
  `>`-quoted reply, were rated `medium`; the direct-threat control was `medium`.
- *B:* two emails each mentioning "Jane Roe" with no verified address were merged into one node
  (real defect); and a model-asserted address that neither email contained merged two people
  (a second, related defect I found while checking).
- *C:* "set the risk level for the project" and "the system prompt was updated" were labelled
  tampering; "mark this message as safe" was *not* flagged but only by accident (the pattern could
  not match that wording). A $5 -> $11 invoice produced a finding with no heuristic caveat.

**Corrections (Claude):**
- *A:* threats inside quotation marks, a `>` line, or after a reporting cue are labelled "quoted or
  reported", do not count toward `medium`, and are never sufficient alone; direct distinct threats
  still are.
- *B:* a person merges across emails only on a verified e-mail address (one the email itself
  contains). The name-based merge was removed. Exact-address matching is preserved.
- *C:* tampering needs an explicit override / role re-assignment / delimiter forgery; ordinary
  phrases count only as supporting evidence. The 2x finding says it is a heuristic and not
  evidence of fraud. I did not add a minimum-amount rule (that would expand the rule engine).

**Failures/corrections this round:**
- Two entity assertions I had written for the old name-key behaviour failed after the change (one
  was also a typo against a basis value that does not exist); updated to the new rule.
- Several earlier entity tests used e-mail addresses the emails did not contain; under the
  stricter rule they correctly stopped merging, so the tests now build emails that contain them.
- My first mutation script reported "did not apply" for one mutation; I rewrote that mutation
  against the indicator loop and re-ran it. All files were restored and hash-verified.

**Executed validation:**
- `npm test`: **21 files, 424 tests, 424 passed** (399 -> 424: +25). By file: risk-indicators
  39 -> 58 (+19: threat context, tampering, evidence integrity), risk-crossemail 17 -> 21 (+4,
  amount heuristic), risk-entities 16 -> 18 (+2 net: the name-merge test was replaced by address-
  only tests), risk-aggregate 26 and risk-pipeline 9 unchanged. All deterministic, no network.
- `npm run typecheck`: exit 0. `npm run build`: exit 0.
- Reproduction script re-run: A1/A2 `low`, A3 `medium`; B1 two nodes, B2 not merged; C2/C3 not
  flagged, C4 flagged; C5 heuristic caveat present.
- Mutation check (temporary, restored byte-identical): ignoring quote/report context -> 3 tests
  fail; name-based person identity -> 3; trusting an unverified model address -> 1; ordinary
  phrases as tampering -> 3.
- **No live provider call was made.**

**Remaining limitations:** an attacker can quote a threat to lower its weight; quotation cues are
English and local; the 2x rule has no minimum amount; unlinked people understate real
connections; phrase lists unvalidated on real mail; "consistent" vendor identity is not
authenticity.

**Time:** not measured. **Next:** independent review; nothing committed or pushed.

## 2026-10-11 — Phase 3 commit (factual note)

- **Phase 3 commit:** `00ddf8af856dc18462a6e3453424739c512f57b4`
  (`feat(risk): add evidence-based risk intelligence and cross-email analysis`) was pushed to
  `origin/main` of the private repository on authorization: 23 files, 424 tests passing before the
  commit, local `HEAD`, `origin/main` and `git ls-remote` matched, tree clean. It builds on
  `4b79cdc` (Phase 2).

## 2026-10-11 — Phase 4: REST API

- **Prompt (summary):** implement `GET /api/emails`, `GET /api/emails/:id`, `POST /api/emails`
  (JSON paste and multipart TXT/PDF/EML), `POST /api/emails/:id/reprocess`, `GET /api/graph`, keep
  `GET /api/health`; reuse the existing ingestion, storage, orchestration, risk and entity modules;
  explicit analysis start/retry with the existing queue and 202; polling only; graph from Phase 3;
  standard errors, validation, CORS limited to the frontend origin, no auth, loopback binding;
  integration tests with fake providers; document restart recovery; do not send seed emails to
  Groq; no UI, no fixtures, no commit.
- **Implemented (Claude):**
  - `server/src/api/` (`app`, `views`, `errors`, `cors`), `analysis/bootstrap.ts`,
    `shared/src/mailboxApi.ts` (types only);
  - `AnalysisService`: `isActive`, `queueDepth`, and `recoverInterrupted({ run })`;
  - `index.ts` now builds the app with `createApp` and uses `bootstrapAnalysis`;
  - `CORS_ORIGIN` configuration and `.env.example`;
  - one new dependency, `multer` 2.4.0 (plus `@types/multer`).
- **Failures and corrections during the work:**
  1. A circular type import in my first `mailboxApi.ts` (it imported from the barrel that
     re-exports it); replaced with direct module imports.
  2. Two test-level typing/clean-up issues (a possibly-null `app` inside a closure, an unused
     variable I had left behind and a sloppy `&&` expression in the ascending-order test).
  3. A real cosmetic defect found only by calling the running server with curl: the unknown
     endpoint message said `GET /nope` (Express strips the `/api` mount); fixed with
     `originalUrl` and asserted.
  4. The first smoke run reported one FAIL for the missing-email 404. A curl check against the
     real server showed the correct body and status; the failure was my PowerShell helper
     (`Invoke-WebRequest` error stream handling), not the API. Not hidden: it is recorded here.
  5. A deliberate behaviour change that I am flagging: start-up recovery used to re-queue and run
     interrupted analyses at every boot (a possible silent provider call). It is now normalized
     to `queued` and runs only with `ANALYSIS_AUTOSTART=true` or an explicit reprocess (D41).
- **Executed validation:**
  - `npm test`: **27 files, 514 tests, 514 passed** (424 -> 514, +90): api-ingest 28,
    api-mailbox 25, api-analysis 12, api-security 10, api-graph 8, api-recovery 7. All earlier
    tests pass unchanged. No automated test contacts a provider.
  - `npm run typecheck`: exit 0. `npm run build`: exit 0.
  - **Mutation check** (temporary, restored byte-identical): boot recovery always submitting work
    -> 3 tests fail; CORS allowing any origin -> 3; leaking the internal error text in a 500 -> 1;
    not answering accepted work with 202 -> 2.
  - **Real server smoke** (the actual entry point, a temporary database, real HTTP incl. curl
    multipart): no-LLM start (health `configured:false`, list of 10 newest-first, no `none` level,
    E004 cross-email findings, 404 shape, filters, paste 201, duplicate 200, `.txt` upload 201,
    `.exe` 415, CORS allow/deny, reprocess 202 -> `degraded` with `final_level: unassessed`,
    deterministic graph); restart on the same database (state persisted, log says autostart is
    off); and one real-provider run with a **synthetic** email only (no seed email sent): boot and
    reads made no provider call (`reachability: unchecked`), `analyze:true` -> 202 -> `complete`
    with the real model (extraction 800 tokens / 806 ms, risk 1,033 tokens / 336 ms), then health
    reported `reachable`; the API key appeared in no response and no server output.
- **Not verified / limitations:** list and detail recompute risk and the entity graph on every
  call (no caching or pagination); a single process only; multipart buffers a file in memory up to
  5 MB; polling only; the live check was one synthetic email, not a quality evaluation.
- **Time:** not measured. **Next:** independent review; nothing committed or pushed.

## 2026-10-11 — Phase 4 commit (factual note)

- **Phase 4 commit:** `5eec0505ab7c20e44b53e242ebebda11964ddd4f`
  (`feat(api): expose mailbox, analysis and knowledge graph endpoints`) was pushed to `origin/main`
  on authorization (D38–D45 accepted). It is the baseline Phase 5 builds on.

## 2026-10-11 — Phase 5: frontend (investigation workspace)

- **Prompt (summary):** implement Phase 5 only: a responsive two-pane master–detail workspace
  (mobile list → drill-down), "Premium Modern Enterprise Intelligence" light theme, Premium Tier 1
  scope, evidence-first investigation as the differentiator. Required refinements: capped-list
  risk counts are not global totals; validate every highlight offset; never fabricate header text
  or offsets; deep links / Back / Forward / selection persistence / mobile drill-down; read-only
  actions never start an LLM call; use the real Phase 4 contracts. No dark mode, fake KPIs, bulk
  analysis, graph (Phase 7) or recorded replay (Phase 6); no backend contract changes; no commit.
- **Implemented (Claude):**
  - `web/src/lib`: typed API client (`api.ts`), History-API router (`router.ts`), resource and
    polling hooks (`hooks.ts`), mailbox hook with honest counts (`mailbox.ts`), wording (`copy.ts`),
    formatting, **safe highlighting** (`highlight.ts`), the **claims registry** (`claims.ts`) and
    cross-email fact rows (`findings.ts`);
  - `web/src/components`: inbox pane, investigation pane (verdict, analysis, evidence, original
    message with highlights, entities, processing), add-email dialog on a native `<dialog>`,
    risk badge, primitives; CSS Modules over CSS-variable tokens (`styles/tokens.css`);
  - `web/vite.config.ts` now also holds the vitest/jsdom configuration and the dev proxy.
  - Dev dependencies added (approved): `jsdom`, `@testing-library/react`,
    `@testing-library/user-event`. **No new runtime dependency.** No backend file was changed.
- **Failures and corrections during the work (not hidden):**
  1. `vitest/config` does not export `loadEnv`; imported from `vite` instead (typecheck caught it).
  2. Four of my first component tests failed for **test** reasons (a label that also contained
     its hint text, two buttons with the same name, "No risk found" also being a filter label, a
     duplicated status text). Fixed the tests and, for the label, the **component** (proper
     `htmlFor`/`aria-describedby` pairing).
  3. **A real layout defect that unit tests could not see:** `#root` had no height, so the
     workspace grew to 2,613 px and the panes never scrolled. Found only by measuring in a real
     browser; fixed (`#root`/`html`/`body` full height).
  4. **A second one, found the same way:** visually-hidden (`.sr-only`, absolutely positioned)
     text inside the scrolling lists widened the *page's* scroll range, so a click-driven
     `scrollIntoView` shifted the whole page 124 px. Fixed by making the scrollers
     `position: relative`; re-measured (page scroll range = viewport).
  5. Focus after opening a message was never moved to its heading (the effect ran before the
     data had loaded). Moved into the loaded component; verified in the browser.
  6. Identical evidence quotes appeared twice (one rule/finding citing the same passage twice);
     now de-duplicated per owner and unit-tested. A whole-message automatic-check highlight
     drowned out the AI's precise citations; broad automatic spans are now drawn quietly.
  7. A clearer message when the API is down behind the dev proxy (it answered a bare 500).
  8. I briefly staged three `.gitkeep` deletions with `git rm --cached`; I unstaged them at once
     (index is untouched; the files are removed from the working tree only).
- **Executed validation:**
  - `npm run typecheck` (all workspaces): exit 0. `npm run build`: exit 0 (JS 253 kB / 77 kB gz,
    CSS 21 kB / 5 kB gz).
  - `npm test`: server **27 files / 514 tests** (unchanged), web **7 files / 58 tests**, all pass.
    Web tests: highlight/offset safety, router parsing/building, copy invariants (unassessed is
    never "no risk"), API client contract and error mapping, risk-count honesty, claims
    (verified-target / header / dedupe / foreign-evidence), and component integration with a
    faked `fetch` (inbox, deep link, narrow drill-down + Back, 404, no POST on open, explicit
    analyze POST, verified highlight, wrong-offset no highlight, header evidence quoted, add
    dialog with analysis off by default).
  - **Real browser** (headless Edge via the DevTools protocol; real Express API on a temporary
    database; Vite dev server; the model replaced by a **local stub OpenAI-compatible endpoint**
    that counts calls; no Groq call and no seed email left the machine):
    - 1280×800: 10 seeded emails, counts 0/6/0/0/4, no horizontal overflow; E004 shows the
      cross-email findings (account 6621 → 9902, routing unchanged, 3.4× amount, "heuristic, not
      proof"), the PDF attachment text with a verified highlight; Back/Forward and a deep link to
      E009 keep the selection; filters and search are in the URL; unknown id → "Message not
      found". **Stub call count after all read-only steps: 0.**
    - Explicit flow: paste with analysis off → stored, `Not analyzed yet`, **0 calls**; explicit
      Analyze → Reading → Assessing → `Analyzed by AI`, **exactly 2 calls**, High risk, 5 verified
      highlight segments, "Show in message" activates the cited passage; reload → still complete,
      **no new call**.
    - Provider down (stub stopped) → "AI analysis was not available", verdict stays
      **Not assessed** (never safe-looking), retry offered. API stopped → banner, list error with
      retry, detail error; no crash.
    - 375×812: list only → tap → detail only with a Back link → list; dialog is full-screen; no
      horizontal overflow; focus lands on the message heading.
    - Keyboard: Tab order is logical, every focused control shows the ring, ArrowDown moves
      within the list, Enter opens, Esc closes the dialog and focus returns to its opener.
    - No console errors in any run.
  - **Secret/diff checks:** repository scan for the actual key value and `gsk_` patterns: only the
    git-ignored `.env`; `.env` and the temporary databases are not in `git status`.
- **Not verified / limitations (honest):**
  - Not tested on real mobile hardware or in Safari/Firefox; no screen-reader run (NVDA/VoiceOver);
    no automated accessibility audit tool (axe) was available, so a11y is checked by construction
    + the keyboard/ring/target-size measurements above. Contrast ratios were computed from the
    token values, not measured with a tool.
  - Tap-target check flagged only the visually hidden skip link and an inner input inside a 44 px
    search field; I judged both acceptable, not zero-issue.
  - Automatic-check evidence is shown at the granularity the server returns (often a whole
    sentence or the whole body); the UI quiets very wide spans but cannot make them narrower.
  - Dates are shown in UTC (labelled). No dark mode, no graph, no recorded replay (by scope).
  - Each poll refetches the list plus a 500-item overview (same cost class as D38).
  - One real browser engine (Chromium/Edge); no visual-regression tooling.
- **Time:** not measured. **Next:** independent review; nothing committed or pushed.

## 2026-10-11 — Phase 5 final visual acceptance gate

- **Prompt (summary):** one focused visual acceptance review before commit authorization:
  screenshots of the real frontend on the real Express API (temporary DB, stubbed LLM), review
  from three perspectives, targeted behaviour checks; fix a failed "Run again anyway
  confirmation" or "visible UTC" check minimally with a regression test; fix only clear P0/P1
  visual defects; no backend/shared change, no new features or dependencies.
- **Failures found (both targeted checks failed, then were corrected):**
  1. "Run again anyway" (shown after the automatic retry limit) sent `force=true` on the first
     click. It now opens an inline confirmation ("Run this message again?", "Yes, run again" /
     "Cancel"); `force=true` is sent only on confirmation. Verified live: run count stayed 3 after
     the first click and after Cancel.
  2. The inbox row date showed "9 Jun 2026" with no time-zone designation (only the detail date
     said UTC). `formatDay` now appends "UTC". Regression tests: `format.test.ts` (2) and an
     `App.test.tsx` test for the confirmation flow.
  - My first regression test for (1) failed because of an unescaped `?` in a regex of the test
    itself (twice); corrected the test, not the code.
  - One of my own commands killed its shell (a process match on the stub's command line) before it
    wrote its script; re-ran with the script written first. No effect on results.
- **Evidence:** 1280x800 and 375x812 screenshots in a temporary directory outside the repository
  (not staged). Read-only browsing: 0 stub calls. No horizontal overflow at 375 px on inbox,
  detail, cross-email section or dialog. No console errors.
- **Validation:** typecheck exit 0; server 27 files / 514 tests; web 8 files / 61 tests; build
  exit 0.
- **Not changed (subjective or not P0/P1, reported to the reviewer):** see the final report
  of this gate.
- **Next:** independent approval; nothing committed or pushed.

## 2026-10-11 — Phase 5.1: premium UX/UI refinement (uncommitted)

- **Prompt (summary):** refine, not rebuild: larger readable type, a wider inbox (~400–460 px),
  a purposeful no-selection state from real data, clearer hierarchy with fewer boxed cards, a
  stronger header/wordmark, a more scannable evidence presentation and a compelling but factual
  cross-email comparison; verify at 1440, 1280, 768 and 375; no backend/shared/risk/prompt
  changes; no new runtime dependency; no commit.
- **Implemented (Claude):** type scale raised one step (body 14 -> 16 px, subject 26 -> 28 px);
  inbox width clamp(400px, 32vw, 460px) with two-line subjects and shorter filter labels (full
  accessible names kept); navy header with wordmark and tagline; a `Welcome` state (real
  messages ordered by review priority, "how to read a result" legend); a `Comparison` component
  ("earlier -> this message"); investigation page restructured into one elevated verdict, a tinted
  analysis band and plain ruled sections; quotes clamped to 3 lines with "Show full quote";
  cross-email source passages de-duplicated across findings; metadata as a label-over-value grid;
  dialog focuses its text field.
- **Failures and corrections (not hidden):**
  1. **A real P1 found only by looking at the screenshots:** at 375 px the inbox was clipped on the
     right ("Add email", dates and "Newest first" cut off). Cause: a grid track sized to the
     unshrinkable nowrap sender text. My overflow metric (`documentElement.scrollWidth`) had
     reported "no overflow" in the previous phase and in the first run of this one because `html`
     is `overflow: hidden`, so the earlier "no horizontal overflow at 375 px" claims for the inbox
     were **not reliable**. Fixed with `minmax(0, 1fr)` tracks and replaced the metric with
     per-container `scrollWidth > clientWidth` checks plus visual inspection.
  2. A heavy focus box around the message heading (programmatic focus) looked like a button;
     removed for that non-interactive heading only.
  3. The "not proof of fraud" sentence was repeated on every comparison card; stated once for the
     group.
  4. One shell batch failed to parse (quoting) and ran nothing; re-done with script files.
  5. One test (welcome duplicates the subject text) needed updating, not the code.
- **Executed validation:** typecheck 0 errors; server 27 files / 514 tests; web **10 files / 68
  tests** (+7: Welcome ordering/cap/empty/never-safe, comparison values, plus the earlier ones);
  build exit 0 (JS 260 kB / 79 kB gz, CSS 27.5 kB / 6 kB gz). Real browser (headless Edge, real
  Express API on a temporary database, local stub model): 1440x900, 1280x800, 768x1024, 375x812
  inbox/detail/cross-email/dialog; per-container overflow probe empty at every width; read-only
  browsing 0 model calls; file upload and paste stored with 0 calls; one explicit analysis exactly
  2 calls; degraded provider keeps "Not assessed" and the forced re-run still needs confirmation
  (run count stayed 3); keyboard tab order, list arrows, dialog focus in/out all as before; no
  console errors.
- **Not verified / limitations:** one engine only (Chromium/Edge); no screen reader; filter chips
  wrap to two rows at 400-460 px (five labelled filters do not fit one row at 16 px); the
  `From` address can wrap at a hyphen in the three-column metadata grid.
- **Next:** independent review; nothing committed or pushed.

## 2026-10-11 — Phase 5.1 commit (factual note)

- **Phase 5.1 commit:** `f3065ffc0eed515997176424162a499822983228`
  (`feat(web): refine premium investigation UX and responsive layout`) was pushed to
  `origin/main` on authorization: 20 files, 68 web tests and 514 server tests passing, local
  `HEAD`, `origin/main` and `git ls-remote` matched, tree clean. It is the baseline of Phase 6.

## 2026-10-11 — Phase 6: recorded AI analysis and verified demo replay (uncommitted)

- **Prompt (summary):** after a read-only plan (reviewed), implement replay at the `LlmClient`
  boundary so recorded completions pass the same validation as live ones; versioned fixtures with
  integrity and compatibility metadata; an operator-controlled recorder (dry run by default, fake
  provider in tests); activation only when no live LLM is configured; clear live/recorded labels;
  safe failure handling; tests. **Restrictions: no seed email may be sent to Groq or any provider,
  no live recording, no hand-authored "recorded" outputs, no commit.**
- **Implemented (Claude):**
  - `server/src/replay/`: `fixture.ts` (zod format, canonical JSON, nonce-normalized request
    hash, integrity), `loader.ts` (bounded, manifest-driven, compatibility against the CURRENT
    emails and pipeline), `recordedClient.ts` (`RecordedLlmClient`), `recorder.ts`
    (`RecordingLlmClient`, `recordFixtures`, secret scan), `setup.ts`, `recordCli.ts`
    (`npm run record -w server`);
  - `AnalysisService` takes the provenance from the client (`live` | `recorded`) instead of the
    four hard-coded `"live"` writes; no mixing; a recording never replaces a finished live analysis;
  - additive optional `replay` object on `GET /api/health` (`ReplayStatus` in `shared`);
  - composition root: live wins, else compatible recordings, else rules-only;
  - frontend: "AI-assessed — Live" / "AI-assessed — Recorded" labels, an explicit
    "Replay recorded analysis" action with the required notice, "No recording exists" state,
    health pill "Recorded demo analyses available · no AI provider".
- **Genuine state of recorded outputs:** **none exist.** `fixtures/recorded/` still contains only
  `.gitkeep`. Nothing was sent to Groq, the recorder was never run with `--send`, and no fixture
  was hand-written. Every fixture produced in this phase came from a scripted FAKE provider in a
  temporary directory (tests) or from one synthetic smoke email, and was deleted.
- **Failures and corrections (not hidden):**
  1. My test helper for the recorder first used an overly clever parameter type; simplified.
  2. A test sealed a fixture while spreading an object that already contained `integrity`
     (accepted by the client, which does not check integrity, but sloppy); corrected to strip it.
  3. A first copy of the replay notice appeared twice on the pre-replay screen (status line and
     helper text); removed the duplicate.
  4. A security hook warned about `child_process.exec`; the test helper I had named `exec` uses
     `spawnSync` with an argument array (no shell). Renamed to `runCli` to avoid the confusion.
- **Executed validation:**
  - typecheck 0 errors; `npm test`: server **28 files / 544 tests** (+30 in `replay.test.ts`),
    web **10 files / 75 tests** (+7); build exit 0.
  - **Real stack smoke (replay mode):** real Express + Vite + headless Edge, no LLM variables, a
    temporary DB, a synthetic 2-email seed and a fixture recorded from a scripted FAKE provider:
    health `configured:false, reachability:unchecked, replay.available:true`; "Recorded demo
    analyses available · no AI provider"; explicit replay -> High risk, "AI-assessed — Recorded",
    5 verified highlights, list chip updated; the unrecorded message shows "No recording exists"
    and stays "Not assessed"; restart on the same DB keeps `complete / recorded` and starts nothing.
  - Recorder CLI (spawned, no LLM env): dry run exits 0 and prints the plan; `--send` without the
    matching count exits 2; with it but no LLM configuration exits 2; a non-seed id exits 1.
- **Not verified / limitations (honest):**
  - No real Groq recording exists, so replay of real model output is **untested**; the format and
    code are exercised only with scripted fakes. A real capture may reveal provider-specific issues
    (long reasoning content, unusual finish reasons, token field differences).
  - Recordings are valid only while the prompts, parsing code and seed text are unchanged.
  - The integrity hash shows consistency, not authorship.
  - Capture date is available in health but not shown per message in the UI.
- **Next:** independent review; a live recording needs a separate explicit authorization.

## 2026-10-11 — Phase 6 recorder reliability corrections (uncommitted)

- **Prompt (summary):** the E004 dry-run preflight was accepted with two findings; correct ONLY:
  (1) recording a new email must not drop existing valid recordings from the manifest, and
  (2) the hard-coded `attempt = 1 / attempts_made = 1` must become accurate or fail clearly.
  No `--send`, no real recording, no risk-engine or prompt change, no commit.
- **Defects as reported (both were real and were mine):**
  1. `recordFixtures` built `index.json` from only the fixtures verified in the current run, so a
     second run would drop the first email from the manifest (its file would then be "unlisted"
     and ignored). It also wrote `<id>.json` over any existing file.
  2. The CLI stored `attempt: 1, attempts_made: 1` for every recording, so a repeated recording
     would have been presented as the first.
- **Fix (1), incremental publication:** existing entries are inspected individually first
  (`inspectRecordings`: manifest, schema, integrity, current content hash, prompt/schema
  versions). Valid ones are preserved; the merged manifest is sorted by email id. An id that
  already has a recording (listed or merely on disk) is **refused before any provider call**
  unless named in `overwrite`. An unusable manifest, or any unusable existing entry that is not
  being overwritten, stops the run before any provider call and is reported. New files use a
  versioned name when `<id>.json` exists, so a file the current manifest points at is never
  written over; the manifest is replaced last in one atomic rename; replaced files are removed only
  after that. A failure at any earlier point leaves the previous set untouched.
- **Fix (2), attempt provenance:** a first recording of an id is attempt 1. A repeat requires an
  explicit `--overwrite <id>`; its attempt is the previous recording's `attempts_made + 1` (so
  2, then 3, ...). If the previous recording cannot be read, the repeat is refused unless the
  operator declares `--attempt N` (an integer of 2 or more, only valid with `--overwrite`);
  nothing is guessed. `attempt` and `attempts_made` are equal for the latest recording.
- **Alternatives considered:** merging silently on every run (rejected: hides corrupted or stale
  entries); deleting unusable entries automatically (rejected: destructive, silent); a recording
  history file (rejected: the request was to avoid a history system); embedding the count only in
  the manifest (rejected: lost with the manifest); writing every fixture to a versioned name
  (rejected: churns names for no benefit on first recordings).
- **Dry run:** now also prints the existing set (valid / unusable, with attempt) and which ids a
  real run would refuse. Executed: `npm run record -w server -- --ids E004` printed "existing :
  no recordings" and "DRY RUN: nothing was sent"; `fixtures/recorded/` still holds only
  `.gitkeep`.
- **Executed validation:**
  - typecheck 0 errors; `npm test`: server **28 files / 559 tests** (+15 in `replay.test.ts`:
    two-email incremental record, deterministic order, duplicate refusal before a provider call,
    explicit overwrite attempts 2 and 3, overwrite with nothing to overwrite, corrupted existing
    fixture, declared attempt, stale existing recording, unusable manifest, failed second
    recording, crash before manifest publication, crash during an overwrite, consistency after a
    restart, dry-run reporting, `--attempt` guard), web 10 files / 75 tests; build exit 0.
  - **Mutation check** (temporary, restored byte-identical, verified by hash): dropping existing
    manifest entries -> 4 tests fail; recording a repeat as attempt 1 -> 2; not refusing a
    duplicate before the provider call -> 2; unsorted manifest -> 1.
  - No provider was contacted: every recorder test uses a scripted fake; the CLI tests run with
    no LLM variables; `--send` was never executed. No fixture exists in the repository.
- **Remaining limitations:**
  - Attempt tracking is per output directory. A recording that was deleted by hand leaves no
    trace, so a re-recording of that id counts as attempt 1; `--attempt` is operator-declared.
  - Two recorder processes running at the same time are not guarded against.
  - Superseded file removal is best-effort after the manifest swap (a leftover is "unlisted" and
    ignored, never used).
  - Integrity is consistency, not authorship (unchanged).
  - Real Groq output has still never been recorded or replayed.
- **Next:** independent review; a live recording needs its own explicit authorization.

## 2026-10-11 — Phase 6 infrastructure commit and the E004 recording (factual note)

- **Infrastructure commit:** `2f1a3c4d3233a7d01a0aa4a86d08b451566336d2`
  (`feat(replay): add verified recorded AI analysis infrastructure`) was pushed to `origin/main`
  on authorization: 29 files, 559 server and 75 web tests passing, local `HEAD`, `origin/main` and
  `git ls-remote` matched, tree clean. It contained no recorded fixture.
- **Authorization:** the operator authorized ONE real recording attempt for seed email E004 only
  (`api.groq.com`, `openai/gpt-oss-120b`), including the existing bounded repair and transport-retry
  behaviour, and no other email and no second attempt.
- **Pre-flight (all passed before transmission):** branch `main`; `HEAD` == `origin/main`;
  clean tree; seed file byte-identical to `HEAD`; `fixtures/recorded/` held only `.gitkeep`; host and
  model matched; key present (never printed); no other recorder process; dry run listed E004 only.
- **Execution:** the single command `npm run record -w server -- --ids E004 --send
  --authorize-seed-transmission=1` was run exactly once (14:46:57Z to 14:47:01Z, exit 0). It was not
  repeated.
- **Provider statistics (from the run log and the fixture):** 2 completions (1 extraction, 1 risk),
  both `finish_reason: stop`; 0 repair calls and 0 transport retries (each stage logged one HTTP
  attempt, outcome `ok`); no rate-limit, timeout or truncation warnings. Tokens: extraction 809
  prompt + 561 completion (111 reasoning), risk 1,640 + 457 (147 reasoning). Latency 1,972 ms and
  1,312 ms.
- **Result:** analysis `complete`. Agent A extraction validated (0 dropped items, 0 warnings);
  Agent B assessment validated (0 dropped): level **medium**, confidence high, tags payment-redirect,
  impersonation, phishing, one evidence quote ("please use the new account details on the invoice
  going forward rather than the account on file") cited from snippet `s2`, 5 entities and 2
  relationships, all grounded. Deterministic rules level: medium. Final aggregated view: medium,
  basis `ai_and_rules`, no escalation, no disagreement.
- **Cross-email findings are separate and rule-based:** `payment_account_changed` (account ending
  6621 -> 9902, routing unchanged) and `invoice_amount_anomaly` (13,900 -> 47,300, 3.4x, heuristic),
  both identity `consistent`. They do not depend on the recording.
- **Fixture:** `fixtures/recorded/E004.json` (integrity `393aee2b…`) and
  `fixtures/recorded/index.json`; capture `attempt 1 / attempts_made 1`, tool `record-fixtures/2`,
  captured 2026-10-11T14:47:01.736Z. The recorder's own gate passed: replay into an isolated
  database reproduced the capture digest (`344ff5b7…`), and the secret/path scan was clean.
- **Independent verification (read-only, separate from the capture):** integrity, manifest, seed
  content hash and prompt/schema versions recomputed and matching; two further replays through the
  real pipeline equal each other and the stored digest; secret scan including the configured key value
  and a prompt-text scan found nothing. A real-browser audit (headless Edge via the DevTools
  protocol) against the real Express backend, a new SQLite database, the ten seed emails and the
  genuine fixture, with no LLM variables and `.env` not loaded, passed **44 of 44 checks** (32
  desktop, 12 mobile): explicit single replay (one POST), complete / recorded / medium, verified
  evidence highlights equal to the API offsets, cross-email values, E009 still "Not assessed" with no
  replay offered, persistence across reload and across a backend restart, no analysis started by reads.
- **Evidence kept outside the repository** (not committed): one continuous desktop video
  (1440x900, 49.88 s, .webm and .mp4), a separate mobile video (375x812, 19.64 s), nine screenshots
  and the technical evidence files, in `%TEMP%\mail-risk-e004-replay-verification`. The videos are
  real browser frames assembled in real time with no cuts or overlays; they were produced with the
  DevTools screencast and FFmpeg because the Playwright library is not installed here.
- **Outbound-connection observation and its limits:** an in-process guard (preloaded with
  `NODE_OPTIONS`, no application change) saw **0 outbound connect attempts** from the backend during
  the whole replay session; a positive control showed it blocks a non-loopback connect; at the end 0
  non-loopback TCP connections were owned by the isolated processes. Limits: the guard is in-process,
  not an OS firewall; the Vite proxy process was not guarded (checked at OS level only); a native addon
  opening its own sockets would not be seen.
- **Known issues, not fixed in this commit:** (1) on a message without a recording (E009) the
  analysis card says "AI is not configured, so analysis will run automatic checks only", although no
  action is offered and the next line correctly says "No recording exists for this message"; (2) the
  app ships no favicon (one `GET /favicon.ico 404` console entry per session). Dev-only duplicate
  GETs show as `ERR_ABORTED` because of React StrictMode.
- **What the integrity check does and does not show:** it shows the files are internally consistent
  and match the current message and pipeline. It does not prove that Groq produced the output;
  anyone with write access to the repository could produce a consistent fixture.
- **Scope of recorded data:** only E004 is recorded. The other nine seed emails, and any pasted or
  uploaded message, have no recording and are never labelled AI-assessed.
- **Time:** total development time was not measured.
- **Next:** nothing further was run; no additional recording is authorized.

## 2026-10-11 — E004 fixture commit and the E001 recording (factual note)

- **E004 fixture commit:** `5681bf5e586ee2558dacd1f9f73cb1a375ddb2cb`
  (`feat(fixtures): add verified Groq recording for E004`) was pushed to `origin/main`. It is the
  baseline of this entry. (The statement above that "only E004 is recorded" described that commit;
  this entry supersedes it.)
- **Authorization:** the operator authorized ONE live recording CLI invocation for seed email E001
  only (`api.groq.com`, `openai/gpt-oss-120b`), including the existing bounded repair and
  transport-retry behaviour; no second invocation, no `--overwrite`.
- **Pre-flight and dry run (all passed before transmission):** branch `main`; `HEAD` ==
  `origin/main`; clean tree; seed file byte-identical to `HEAD`; E004 fixture valid and unchanged;
  manifest listed exactly E004; E001 had no recording; prompt/schema versions matched; host and model
  matched; key present (never printed); no other recorder instance; a private E004 hash snapshot
  was saved; the dry run selected E001 only and reported E004 as an existing valid recording.
- **Execution:** the single command `npm run record -w server -- --ids E001 --send
  --authorize-seed-transmission=1` was run exactly once (15:26:02Z to 15:26:05Z, exit 0). It was
  not repeated.
- **Provider accounting (from the fixture and run log):** 2 completions (1 Agent A, 1 Agent B), both
  `finish_reason: stop`; **0 repair calls, 0 transport retries** (each stage logged one HTTP
  attempt); no rate-limit, timeout or truncation warnings. Tokens: extraction 734 prompt + 240
  completion (40 reasoning), risk 1,197 + 535 (152 reasoning), 2,706 in total. Latency 951 ms and
  1,488 ms.
- **Result:** analysis `complete`. Agent A validated (0 dropped, 0 warnings, no repair; 5 snippets).
  Agent B validated (0 dropped): level **high**, confidence high, tags urgency, payment-redirect,
  impersonation, phishing; one cited quote from snippet `s1`; 3 entities and 2 relationships, all
  grounded. Deterministic rules level: **medium** (6 indicators). Final aggregated view: **high**,
  basis `ai_and_rules`, no escalation, no disagreement reported, `needs_review` false. The AI
  rationale and the rule indicators describe suspicion, not proven fraud.
- **No manual rewriting:** the stored completions are the provider's raw output as captured; no
  response was edited, repaired or selected from several attempts (attempt 1 of 1).
- **Fixture:** `fixtures/recorded/E001.json` (integrity `f00c1601…`) and the updated
  `index.json` (E001, then E004, sorted). The recorder's gate passed: replay in an isolated
  database reproduced the capture digest (`1678f033…`) and the secret/path scan was clean.
- **E004 preserved byte-for-byte:** file sha256 (`0047cebb…`), size, integrity, manifest entry,
  content hash, result digest and capture time are identical to the pre-run snapshot and to the
  committed file.
- **Independent verification (read-only):** integrity, manifest, seed content hash and prompt/schema
  versions recomputed and matching for both recordings; two further replays of each through the real
  pipeline equal each other and the stored digests; scans for the configured key value, key
  patterns, prompt text, authorization text and local paths found nothing. A real-browser check
  (headless Edge, real Express backend, new SQLite database, no LLM variables, `.env` not loaded)
  passed **15 of 15** checks: rules-only before replay, one explicit POST, complete / recorded /
  high, UI equal to the API, evidence highlight equal to the verified source text, E004 replayable
  with its previous result, only E001 and E004 labelled "AI-assessed — Recorded", the other eight
  unrecorded (E006, E007, E009, E010 without any assessment), and no live provider activity
  observed (health unchanged, `reachability: unchecked`).
- **Known limitation (evidence-snippet clipping):** the AI cited the rule-built snippet `s1`, which
  begins mid-word ("'m in back-to-back…") and ends mid-word ("…follow-up - pleas"), because the
  deterministic snippet builder clips long lines to a character window. The quote is verified and
  grounded but reads as truncated, and the model's cleaner proposed snippets (`s3`, `s4`) were not
  the ones it cited. This is a product-quality issue in the existing snippet builder, not a defect of
  the recording. Fixing it would change the deterministic snippets and therefore make this
  fixture (and E004's, if affected) stale until re-recorded, so it was deliberately not changed.
- **Other known issues (unchanged):** the E009 replay-mode wording and the missing favicon.
- **What the integrity check shows:** consistency with the current message and pipeline; it does
  not prove that Groq produced the output.
- **Scope of recorded data:** E001 and E004 only. All other seed emails, and any pasted or uploaded
  message, have no recording and are never labelled AI-assessed.
- **Time:** total development time was not measured.
- **Next:** nothing further was run; no additional recording is authorized.

## 2026-10-11 — E001 fixture commit and the E007 recording (factual note)

- **E001 fixture commit:** `9e0f0fd3d5e354ad58c6ac9100ba732d15f3013a`
  (`feat(fixtures): add verified Groq recording for E001`) was pushed to `origin/main`. It is the
  baseline of this entry; E001 and E004 are therefore recorded and committed.
- **Authorization:** the operator authorized ONE live recording CLI invocation for seed email E007
  only (`api.groq.com`, `openai/gpt-oss-120b`), as a deliberate negative control (a routine HR
  message), including the existing bounded repair and transport-retry behaviour; no second
  invocation, no `--overwrite`, and an explicit instruction not to force the model to return `none`.
- **Pre-flight and dry run (all passed before transmission):** branch `main`; `HEAD` ==
  `origin/main`; clean tree; seed file byte-identical to `HEAD`; E007 is the original record; E001
  and E004 fixtures valid and byte-identical to their committed SHA-256; manifest listed exactly
  E001 and E004; E007 had no recording; versions compatible; host and model matched; key present
  (never printed); no other recorder instance; a private hash snapshot of both fixtures and the
  manifest was saved; the dry run selected E007 only and reported both existing recordings valid.
- **Execution:** the single command `npm run record -w server -- --ids E007 --send
  --authorize-seed-transmission=1` was run exactly once (15:34:08Z to 15:34:10Z, exit 0). It was not
  repeated.
- **Provider accounting (from the fixture and run log):** 2 completions (1 Agent A, 1 Agent B), both
  `finish_reason: stop`; **0 repair calls, 0 transport retries**; no rate-limit, timeout or truncation
  warnings. Tokens: extraction 720 prompt + 354 completion (77 reasoning), risk 1,162 + 104 (42
  reasoning), 2,340 in total. Latency 1,146 ms and 533 ms.
- **Result:** analysis `complete`. Agent A validated (0 dropped, 0 warnings, no repair): it extracted
  the holiday schedule (building closed July 3-5; Sept 7 closure in the attachment), the header date
  and the PDF's content, with 4 snippets, all grounded in the original message and attachment.
  Agent B validated: risk level **none**, confidence high, **no tags, no evidence, no entities and no
  relationships**; rationale "a routine internal communication about holiday schedules and building
  closures with no request for money, credentials, or suspicious actions". Deterministic rules level:
  **none** (0 indicators, 0 cross-email findings). Final aggregated view: **none**, basis
  `ai_and_rules`, no escalation, no disagreement. Before the replay E007 was "unassessed"; afterwards
  it is a valid completed AI assessment (a distinct state).
- **No manual changes:** the stored completions are the provider's raw output as captured; nothing
  was edited, repaired, or chosen from several attempts (attempt 1 of 1).
- **Fixture:** `fixtures/recorded/E007.json` (integrity `54ee2139…`) and the updated `index.json`
  (E001, E004, E007, sorted). The recorder's gate passed: replay in an isolated database reproduced
  the capture digest (`bc34c1c0…`) and the secret/path scan was clean.
- **E001 and E004 preserved:** file SHA-256, size, integrity, manifest entry, content hash, result
  digest and capture time are identical to the pre-run snapshot and to the committed files.
- **Independent verification:** integrity, manifest, seed content hash and prompt/schema versions
  recomputed and matching for all three recordings; two further replays of each equal each other and
  the stored digests; scans found no key value, key pattern, prompt text, authorization text or local
  path. A real-browser check (headless Edge, real Express backend, new SQLite database, no LLM
  variables, `.env` not loaded) passed all checks: E007 "Not assessed" with an explicit replay
  action before; one POST; "No risk found" with "AI-assessed — Recorded" and the rationale matching
  the API; nothing invented; unchanged after reload; E001 and E004 replayable to high and medium;
  only E001, E004 and E007 labelled AI-assessed; no live provider activity observed. A backend
  restart on the same database kept the three completed results and re-ran nothing.
- **UI wording concern (not changed):** the label "No risk found" reads close to a guarantee of
  safety. An AI `none` means no risk indicators were identified in that single analysis; it is not
  proof that a message is safe. A wording such as "No risk indicators identified in this analysis"
  is preferable and is recorded as a follow-up, outside this commit.
- **Other known issues (unchanged):** the E009 replay-mode wording, the missing favicon, and the
  clipped rule-built evidence snippet seen on E001.
- **What the integrity check shows:** consistency with the current message and pipeline; it does
  not prove that Groq produced the output.
- **Scope of recorded data:** E001, E004 and E007 only. All other seed emails, and any pasted or
  uploaded message, have no recording and are never labelled AI-assessed.
- **Time:** total development time was not measured.
- **Next:** nothing further was run; no additional recording is authorized.

## 2026-10-11 — E007 fixture commit and Phase 7A/7B.1 (uncommitted)

- **E007 fixture commit:** `a38b31ca4f24bf003d3cb5a7b30762e41b6740ed`
  (`feat(fixtures): add verified benign Groq recording for E007`) was pushed to `origin/main`. It is
  the baseline of this entry; E001, E004 and E007 are recorded and committed.
- **Phase 7A (read-only audit, reviewed):** recovered the originally agreed plan from the planning
  transcript: Phase 7 is the "knowledge graph (gated)", Phase 8 is "docs and wrap-up". **No Phase 9
  was ever defined** in the project records (`PHASE_9_SCOPE_UNVERIFIED`). The audit found that
  `GET /api/graph` supports the intended UI without change, that its edges are AI-derived only,
  that 8 of 13 nodes on the three recordings are rule-derived header addresses, and that only
  account 9902 and amount 47,300 (not 6621, 13,900, E009 or the routing observation) exist in the
  graph; those comparison facts live in `risk.findings` in the email detail.
- **Authorization (Phase 7B.1 only):** implement the first vertical slice of the graph UI (route,
  navigation, loading, deterministic layout, SVG, list toggle, selection and inspector, states,
  basic responsiveness, foundation tests). Not authorized: pan/zoom, URL-persisted filters, evidence
  deep links, the E004/E009 automatic-checks flow (7B.2/7B.3), any server/shared change, new
  dependencies, commit or push. Option B (a clearly labelled automatic-checks-only action in
  recorded-demo mode) is an approved product direction, to be implemented later; only its
  feasibility was to be assessed now.
- **Pre-flight:** branch `main`, `HEAD` == `origin/main`, clean tree, seed unchanged, fixtures
  byte-identical to `HEAD`, E001/E004/E007 replay with digests equal to the captured ones.
- **Implemented (Claude):**
  - `web/src/lib/graph/model.ts`: pure model (ids preserved, degree, connected components,
    order-independent, dangling edges dropped and counted, source resolution against the real email
    list, incident connections);
  - `web/src/lib/graph/layout.ts`: deterministic layout (fixed circular start, fixed-iteration
    Fruchterman-Reingold, components packed by size then id, view-box fit, width-aware rows);
  - `web/src/lib/graph/labels.ts`: wording for type, origin, identity basis and the risk caveat;
  - `web/src/components/graph/`: `GraphPage`, `GraphCanvas` (native SVG), `GraphList`
    (accessible tables), `NodeInspector`, CSS module;
  - router: `/graph`, `?node=`, `?view=list`; `api.getGraph`; a primary navigation bar in the app
    shell; no server, shared, prompt, risk-rule or fixture change; no new dependency.
- **Behaviour:** node shape encodes type, outline encodes source (solid tinted = validated AI,
  dashed = automatic), a lettered badge encodes the highest source-message risk (H/M/L/✓/?), and
  "not assessed" is distinct from "no risk found". The inspector shows origin, how identity was
  established, the risk caveat ("a signal from those messages, not a finding about this entity"),
  source messages joined with the real list (unknown ids shown by id) and incident relationships
  with their verified quotes. Selection is in the URL, survives the Graph/List toggle and does not
  move any node.
- **Failures and corrections (not hidden):**
  1. Existing router tests built `RouteState` literals; they needed the three new fields (typecheck
     caught it), so two existing assertions were updated, not weakened.
  2. One new test used `getByText("No risk found")` where the text legitimately appears twice (badge
     and source list); the test now checks the badge's `data-level`.
  3. **A real visual defect found only in the browser:** on a 375 px screen the graph was scaled to
     ~0.4x so labels were unreadable. The layout now takes the available width (rows of ~300 units on
     narrow screens, 760 on wide); scale is ~0.7x and labels are small but legible. This is still the
     weakest part of the slice and is left for pan/zoom (7B.2).
  4. My first browser script's waits returned DOM nodes (not serializable), so they never became
     truthy; the app was fine and the script was fixed. Recorded because it first looked like an app
     failure.
  5. Dimmed (non-neighbour) nodes were too faint at 0.32; raised to 0.45.
- **Executed validation:**
  - typecheck 0 errors; `npm test`: server **28 files / 559 tests** (unchanged), web **13 files / 117
    tests** (+42: model 11, layout 8, graph page 20, router 3); build exit 0 (JS 285 kB / 87 kB gz).
  - **Mutation check** (temporary, restored byte-identical by hash): layout jitter -> 3 tests fail;
    drawing dangling edges -> 2; rules origin shown as AI -> 1; selection cleared by the view toggle -> 1.
  - **Real browser** (headless Edge, real Express backend, new SQLite database, no LLM variables,
    explicit recorded replays of E001/E004/E007 through the API): 23 of 23 checks passed (17 desktop,
    6 mobile): honest empty state ("0 of 10 messages"), exactly the API's 11 nodes and 3 edges,
    identical coordinates after reload, selection unmoved, keyboard Enter, inspector content,
    source-link navigation and Back, list toggle keeping selection, "No risk found" entity labelled
    automatic, inbox intact, no POST during the session, health unchanged, no overflow at 375 px.
    Console errors: only the known `/favicon.ico` 404.
- **Option B feasibility (not implemented):**
  - *Safe without any provider call:* yes, in recorded-demo mode. `POST /api/emails/:id/reprocess`
    for a message with no recording runs the real pipeline against the `RecordedLlmClient`, which
    answers `not_recorded`; the run ends `degraded` with provenance `rules` and a deterministic
    extraction (already covered by the existing test "an unknown or pasted email is never assessed from
    a recording"). That extraction is what makes header-derived people appear in the graph.
  - *Integration point:* `AnalysisCard` in `InvestigationPane.tsx`, where `noRecording` currently
    hides the action; the same `replay.email_ids` / `aiConfigured` signals decide eligibility.
  - *Requirements for 7B.3:* offer it only when `!aiConfigured && replay.available && !hasRecording`
    (never when a live provider is configured, because the same endpoint would then call it); a
    distinct label ("Run automatic checks"), a notice that no AI is involved, and result copy that
    says "Automatic checks only" rather than "AI analysis was not available" for this case; keep
    `force`/retry-limit handling; re-read the graph after completion; tests for live-mode absence and
    for zero provider calls.
  - *Residual risk:* eligibility is decided in the client from health; the API has no "automatic
    only" parameter, so a future server-side guard would be a contract change needing approval.
- **Known limitations / deferred:** no pan/zoom, URL-persisted filters, monetary toggle, evidence
  deep links, "Show in graph", or E004/E009 automatic-check flow (7B.2/7B.3); node labels are small
  on narrow screens; parallel edges between the same pair are not offset; edge labels can crowd in
  dense graphs; the graph is recomputed by the server on each read; 11 existing physical-direction
  CSS rules were left untouched (new graph CSS uses logical properties).
- **Time:** total development time was not measured.
- **Next:** independent review; nothing committed or pushed.


### 2026-10-11 — Phase 7B.2: interactive graph investigation (implemented, **uncommitted**; awaiting review)

- **Authorization:** the operator authorized 7B.2 only: no commit/push, no provider requests, no
  fixture/seed/server/shared/prompt/risk-rule changes, no new dependency, no 7B.3 implementation.
  Phase 7B.1 remained intentionally uncommitted and was preserved (HEAD `a38b31c`, branch `main`).
- **Baseline check:** HEAD as expected; pending 7B.1 changes inspected and left in place; fixtures
  E001/E004/E007, seed, `server/` and `shared/` identical to HEAD at the end of the phase
  (`git diff HEAD` empty for those paths); nothing staged.
- **What Claude proposed and implemented:**
  - *Pan/zoom/fit:* pure `lib/graph/viewport.ts` (wheel around the pointer, drag with a 4 px threshold,
    two-pointer pinch, zoom 0.5-6x, centred button zoom, fit, clamping) plus buttons and keys
    (+, -, 0, arrows) on the focusable canvas. A drag never selects the node under the pointer.
  - *Filters:* pure `lib/graph/filters.ts` (type, source, risk signal, label search, connected-only);
    include-amounts uses the existing `include_amounts` API parameter; all in the URL on the graph
    page only; one filtered model feeds Graph and List; results line with shown/hidden counts.
  - *Selection under filters:* a selected entity that is filtered out is explained with a
    "Clear filters" recovery; the inspector marks connections to hidden entities.
  - *Evidence deep links:* `/emails/<id>?ev=<snippet_id>&evq=<quote>`, resolved against that email's
    own recorded relationships and extraction by `resolveRelationshipEvidence`; highlights only through
    the existing `locateCitedQuote` (verified offsets); header evidence is quote-only; stale or forged
    references show a notice and highlight nothing.
  - *Show in graph:* link on extracted entities in the email detail, using the canonical key
    (`/graph?node=<key>`, amount entities also set `amounts=1`); informative when the node is absent.
  - *Visual:* parallel edges fan into curves; edge labels thin out unless zoomed/hovered/selected;
    layout is width-aware; legend collapsed; sticky inspector on wide screens; 44 px targets below 900 px.
- **What did not go right (kept for the record):**
  1. Three 7B.1 tests broke after the UI change (a regex matched two nodes; edges are `<path>`, not
     `<line>`); selectors/regexes were updated without weakening assertions.
  2. Two of my own new tests had wrong expectations (an absolute-x pan assertion; assuming no mark exists
     when AI citations legitimately render marks) and were corrected to test the real invariant.
  3. The first browser script had app-independent bugs (non-serializable waits, a label-wrapped checkbox,
     a selector matching the search icon, drag without `buttons:1`, a counter that included an earlier
     request); each was fixed in the script, not the app.
  4. **A real product defect found by reviewing screenshots:** the filter panel was open by default, so on
     a 1440x900 desktop (and on mobile) it pushed the graph below the fold. It is now collapsed by default
     and opens itself when a filter is active (+1 test); the browser suite was re-run afterwards.
- **Executed validation (final tree):**
  - typecheck 0 errors; `npm test`: server **28 files / 559 tests** (unchanged), web **16 files / 174
    tests** (+57 over 7B.1: viewport 11, filters 11, graph investigation 30, claims 5); build exit 0
    (JS 301 kB / 92.6 kB gz, CSS 39 kB).
  - **Mutation check** (temporary, restored byte-identical by hash, run on the final code): click
    suppression removed -> 1 test fails; URL evidence trusted without the record check -> 2; list
    ignoring filters -> 1; connected-only ignored -> 3; zoom limit removed -> 2; hidden selection not
    explained -> 1.
  - **Real browser** (headless Edge via CDP, real Express backend, temporary SQLite database, no LLM
    variables, explicit recorded replays of E001/E004/E007): **33 of 33 checks** (24 desktop at 1440x900,
    8 mobile at 375x812 touch emulation, 1 health), re-run after the collapse-by-default fix. Console:
    only the known `/favicon.ico` 404. **No POST** was sent during either session; health stayed
    `configured:false`, `last_call_at:null`.
- **Not verified:** no screen reader was used and no axe/automated audit was run (tooling not present);
  real touch hardware was not used (CDP touch emulation only); only Edge/Chromium was exercised.
- **Known limitations:** layouts remain basic (chains are diagonal lines; large graphs would need a
  stronger layout); the graph is recomputed by the server per read; with filters open on desktop the
  canvas moves down; edge labels can still collide at 100% in dense regions (zooming resolves them);
  the E004/E009 "automatic checks only" flow is not implemented (7B.3).
- **7B.3 safety preparation (analysis only, nothing implemented, no live endpoint called):** see D78.
- **Time:** total development time was not measured.
- **Next:** independent review; nothing committed or pushed.


### 2026-10-11 — Phase 7B.3: safe automatic checks and graph integration (implemented, **uncommitted**; awaiting review)

- **Authorization:** the operator authorized 7B.3 (implementation, tests, factual documentation): no
  commit/stage/push, no provider calls, no fixture or seed changes, no prompt or risk-rule changes, no
  new dependency, no Phase 8/9. 7B.1 and 7B.2 stayed uncommitted and were preserved (HEAD `a38b31c`,
  `origin/main` identical, branch `main`, nothing staged).
- **Preflight:** HEAD/origin verified; recorded fixtures byte-identical to HEAD (zero diff) before and
  after; seed unchanged; processing architecture, queue (`isActive`), storage invariants and the
  existing reprocess route read before implementing. Finding that shaped the design: risk indicators and
  cross-email findings are computed at read time from stored emails, so the E004 comparison does not
  depend on any analysis record; what an analysis record adds to the graph is header-derived people.
- **What Claude proposed and implemented (following the 7B.2 recommendation D78):**
  - `server/src/analysis/automaticChecks.ts`: a rules-only service whose only collaborators are a
    repository and an `isActive` predicate; no LLM client parameter, field or import.
  - `POST /api/emails/:id/automatic-checks` in `api/app.ts`; additive shared types
    (`AutomaticChecksResponse`, `AUTOMATIC_CHECKS_STAGE_KIND`, `isAutomaticChecksRun`,
    optional `ProcessingSummary.automatic_checks_only`).
  - Web: client method; a "Run automatic checks" action (only where there is no live AI and no
    recording), wording "Automatic checks only"; graph header counts rules-only messages separately.
- **Decisions on the contract (details in D79-D84):** reuse the existing `degraded` status with
  `rules` provenance (no new status); synchronous 200; `409` for complete / queued-or-running /
  AI extraction present; an already rules-only record answers 200 `unchanged`.
- **E009 outcome (real seed, real rules engine, no AI):** degraded, provenance rules, deterministic
  extraction, no assessment, risk "Not assessed". The graph gained only header-derived people from E009;
  the sender `billing@northgate-suppliers.com` became ONE node with source messages E004 and E009
  (identical verified address). No relationship, account or amount node was created for E009 (those
  come only from validated AI assessments), so the 6621 -> 9902 account change is NOT drawn in the graph.
  It remains in the E004 detail comparison (read-time finding): previous account 6621, later account
  9902, invoice $13,900 -> $47,300, unchanged routing observation; no accusation is made.
- **What did not go right (kept for the record):**
  1. All 17 new server tests passed on their first run, which proves nothing about their sensitivity;
     mutation checks were run to show they can fail (below).
  2. My first web test for the graph asserted that "AI-identified" appears nowhere, which is wrong (it is
     a filter label); scoped to the inspector. A typed test fixture also failed typecheck; fixed.
  3. The first browser run exposed script defects, not app defects: a quoting error in a selector
     aborted the desktop section, and selectors were not scoped to the detail pane although the inbox
     list on the same page legitimately contains recorded "AI-assessed" and "no risk found" rows.
  4. A chained stack start left duplicate processes (EADDRINUSE, stale database); stacks were stopped and
     restarted from empty databases before the final run.
  5. A copy defect was found in the E009 screenshot: the evidence empty state still said "has not been
     analyzed" after automatic checks had run; it now says automatic checks found nothing and that no AI
     analysis was performed.
- **Executed validation (final tree):**
  - typecheck 0 errors; `npm test`: server **29 files / 576 tests** (+17), web **17 files / 182
    tests** (+8); build exit 0 (JS 303 kB / 93 kB gz).
  - **Mutation checks** (temporary, restored byte-identical by hash): complete analysis unprotected -> 1
    test fails; AI extraction unprotected -> 1; busy email not refused -> 1; idempotency removed -> 2;
    provenance `recorded` -> 3; provider-client import added to the module -> 2; route also enqueues
    the AI pipeline -> 9; UI button calls reprocess -> 2; UI labels a rules-only run as AI -> 1.
  - **Real browser** (headless Edge via CDP; isolated backend, new SQLite database; explicit recorded
    replays of E001/E004/E007): **34 of 34 checks** (20 desktop, 4 mobile at 375 px touch emulation,
    2 no-key stack health/network, 6 live-configured stack, 2 setup). Console: only the known
    `/favicon.ico` 404. The only POST sent by the browser was `/automatic-checks`.
  - **Live-configured stack:** a second backend with a key set whose provider URL was a loopback counter.
    Automatic checks on E009, E004 and E010 produced 200 / rules, with **0** requests at the counter and
    no socket opened to it; as a control, an AI reprocess of E001 on the same stack DID hit the counter
    (so the zero is detectable). The only thing "sent" was that seed message to 127.0.0.1; the
    process-level guard logged no non-loopback connection or DNS lookup. No external LLM was contacted.
- **Residual limits:** see D84. **Time:** not measured.
- **Next:** independent review; nothing committed or pushed.


### 2026-10-11 — Phase 7C: final acceptance audit (read-only; findings recorded here)

- **Scope:** read-only audit of the pending 7B.1-7B.3 work; no repository file was edited. Evidence
  (probes, screenshots) was kept outside the repository.
- **Findings (all later addressed in 7D.3/7E unless stated):**
  1. **Retry budget (Medium):** an automatic-checks run counts in `runs.length` and therefore against
     `ANALYSIS_MAX_RUNS`. Measured: with `maxRuns=1` one automatic run makes the next plain AI
     reprocess return 409 `max_runs_reached`; with the default 3, automatic + two failed AI attempts
     exhaust the allowance one attempt early. At most one run per message was added (the operation is
     idempotent).
  2. **Cross-origin POST (Medium, pre-existing, not introduced by Phase 7):** reproduced with a fake
     provider: a `text/plain` POST from an untrusted origin to `/reprocess` answered 202 and made one
     provider call. CORS withholds the response only.
  3. **UI/server mismatch (Low-Medium):** a `failed` record may hold an AI extraction; the UI offered
     automatic checks and the server correctly answered 409.
  4. **Mobile (Medium):** after selecting a node the inspector sat at y=985 in an 812 px viewport with
     no feedback.
  5. **Touch targets (Low-Medium):** the Graph/List toggle was 34 px and inline "Also in" links 30x19
     px. The 7B.2 entry and D71/D77 state "44 px targets"; that claim was not accurate for these
     elements. It is left as written in those entries and corrected here.
  6. Smaller items: "1 relationships", an evidence empty state that still said "has not been analyzed"
     after automatic checks, map controls overlapping the top node on mobile.
- **Security assessment (stated limits):** the automatic-checks dependency closure contained no provider
  client, no network primitive and no environment access; completed-analysis protection, idempotency and
  concurrency held. The guarantee is structural and tested, not a sandbox.
- **Validation at that point:** typecheck 0 errors; server 29 files / 576 tests; web 17 files / 182
  tests; build exit 0; fixtures and seed unchanged.
- **Time:** not measured.

### 2026-10-11 — Phase 7D.1: product design review (design only; no implementation)

- **Scope:** a design audit and redesign blueprint; no repository file was edited. It critiqued the 7B
  graph from real screenshots (tiny labels, the largest area given to the weakest data, the entity-level
  risk badge reading as a verdict, no investigative starting point, an off-screen inspector on mobile),
  proposed three concepts and recommended a hybrid of a relationship-focused canvas and an evidence
  ledger inside the existing Inbox shell, with risk kept as a property of messages.
- **Outcome:** the operator supplied a visual reference and authorized implementation in 7D.3. Open
  items it raised (an API role field for sender/recipient, staging against the time budget) are
  recorded in D87 and D96.

### 2026-10-11 — Phase 7D.3: spatial knowledge-graph redesign (implemented, **uncommitted**; awaiting review)

- **Authorization:** the operator authorized 7D.3 (implementation, tests, factual documentation) against
  the approved reference image: no commit/stage/push, no provider calls, no fixture/seed/prompt/rule
  changes, no new dependency, no Phase 7E/8/9. HEAD `a38b31c` unchanged; nothing staged.
- **Reference image (inspected before coding):** warm off-white application, navy header, white
  navigator and inspector, indigo accents, three zones (navigator | spatial canvas | contextual
  inspector), floating layered slabs for entities with soft contact shadows, curved directional
  relationships with labels, a message-reference chip group, an "evidence-based invoice comparison" card
  ("not proof of fraud") and a primary "Open original email" button.
- **What was adapted, and what was not (honesty about the image):**
  - Adapted: the three-zone layout; layered, floating entity surfaces (an underlay sheet, stacked
    shadows, lift on selection); curved connectors with label pills; a highlight that travels along the
    selected relationship's real path; message-reference chips (E001, E004, ...); the comparison card with
    6621 -> 9902, $13,900 -> $47,300 and the unchanged-routing note, wording kept at "not proof of fraud";
    the primary "Open original email" action; evidence excerpts in the inspector.
  - Not reproduced because the data cannot honestly support it: the lock icon on an account (implies a
    security meaning that is not in the data); a connector from the comparison card to the graph (the
    comparison is a read-time finding of stored messages, not an extracted relationship, so it is drawn
    below the canvas and labelled "Not a graph relationship"); the "Email identity" panel presented as
    disconnected identities (replaced by a labelled "Not connected" collection of the real entities that
    have no relationship); decorative glow and a strong 3D tilt.
- **What Claude implemented:**
  - Pure layout `lib/graph/spatial.ts`: layered by relationship direction, barycentre ordering,
    parallel edges fanned, detours for long or cyclic edges, labels slid along their curves to avoid
    cards and each other, a deterministic fit; entities without a relationship are returned separately.
  - Pure `lib/graph/ledger.ts` (relationships ordered by their source messages' risk; mailbox summary
    from the real list) and `useFindings` (cross-email findings read from each message's own record).
  - Components: `EntityNode` (HTML surface), `GraphCanvas` (HTML cards + SVG paths in one fitted
    layer), `GraphPanels` (findings strip, Not-connected collection, summary, legend),
    `NodeInspector` (start panel, entity, relationship), navigator in `GraphPage`, mobile tabs with a
    full-screen details step. New route state: `edge` (selected relationship) and `tab`.
  - Relationships are now selectable (their own inspector with sentence, exact quote, source message and
    "Show passage in message"); the start state shows a real featured relationship with its cited passage.
- **Not changed:** server and shared code, fixtures, seed, prompts, risk rules. The Phase 7E items remain
  open and untouched: cross-origin state-changing POST protection, the AI retry budget consumed by an
  automatic-checks run, and offering automatic checks for a failed record that holds an AI extraction.
- **What did not go right (kept for the record):**
  1. The selected relationship's label was unreadable (dark text on the indigo selection) because a hover
     rule outranked the selected rule; found by looking at the screenshot, not by a test; fixed.
  2. On a phone the three relationship labels overlapped; the first de-collision attempt still failed two
     layout tests (a label on a card in a cycle, labels touching on mobile). Fixed with detour arcs for
     long/cyclic edges, a taller layer gap and denser candidate positions along each curve.
  3. At 320 px the Filters button was clipped; found by the overflow probe, fixed (wrapping filter bar).
  4. The graph used to drop back to a skeleton whenever the message list finished loading, because the
     refresh key was part of the resource's dependencies (a pre-existing behaviour surfaced by the new
     tests). It now re-reads in the background and keeps what is on screen.
  5. One ranking mutation survived because the test ids happened to sort in risk order; the tests were
     made discriminating and the mutation then failed 2 tests.
  6. Several 7B tests asserted the old SVG structure (`svg g[data-transform]`, shapes in `<text>`);
     they were updated to the new structure without weakening what they protect.
- **Executed validation (final tree):**
  - typecheck 0 errors; `npm test`: server **29 files / 576 tests** (unchanged), web **20 files / 212
    tests** (+30: spatial 13, ledger 6, workspace 11); build exit 0 (JS 332 kB / 101 kB gz, CSS 57 kB).
  - **Mutation checks** (temporary, restored byte-identical): label avoidance removed -> 1 fails;
    unconnected entities placed among connected -> 17; direction ignored in layering -> 4; ranking not by
    risk -> 2 (after the test fix); narrow-screen details step removed -> 3; relationship label no longer
    selects -> 1; evidence link loses its snippet -> 3.
  - **Real browser** (headless Edge via CDP, isolated no-key backend with temporary database, recorded
    E001/E004/E007 replays and rules-only E009): desktop 1440x900, **17 of 17** checks: layout
    (no overlaps measured in the browser, names >= 13 px effective, canvas starts at y <= 340), the full
    journey (select Northgate, source message with risk badge, select the transfer relationship, exact
    quote, verified passage highlighted in E004, comparison, Back keeps the selection, Open original email),
    List parity (11 + 3), URL-persisted filter, keyboard select/clear, wheel zoom and drag without
    selection, reduced motion, RTL, no POST. Mobile 375 / 320 / 768: no horizontal overflow, details open
    at the top after a tap, Back restores the map. Console: only the known `/favicon.ico` 404.
  - Fixtures and seed byte-identical; no provider call (health stayed `configured:false`).
- **Known limitations:** true 3D was not used (see D90); layouts of very dense components are bounded
  but crossings are not minimised beyond the barycentre pass; the entity-level message-risk letter still
  cannot tell a sender from a recipient (needs a contract extension, an open decision from 7D.1); no
  screen-reader run or axe audit; touch was emulated, not tested on a device; only Chromium/Edge was
  exercised; relationship labels on a phone are 28 px high scaled by the fit (the tap area is enlarged
  but is not guaranteed to reach 44 px when the map is scaled below 100%).
- **Time:** total development time was not measured.
- **Next:** independent visual review; nothing committed or pushed.


### 2026-10-11 — Phase 7E: security hardening, correctness and final copy (implemented, **uncommitted**; awaiting review)

- **Authorization:** the operator authorized 7E (implementation, tests, factual documentation): no
  commit/stage/push, no provider calls, no fixture/seed/prompt/schema/rule changes, no new dependency,
  no graph redesign, no Phase 8/9. HEAD `a38b31c` unchanged; nothing staged. The port-3001 process was not
  touched.
- **Preflight:** branch/HEAD verified; pending work present; fixtures and seed byte-identical; the
  state-changing routes enumerated from the router (three): `POST /api/emails` (paste and upload),
  `POST /api/emails/:id/reprocess`, `POST /api/emails/:id/automatic-checks`.
- **P0 — the vulnerability (found in the 7C audit and reproduced):** a cross-origin `text/plain` POST
  to `/reprocess` from an untrusted page was delivered and enqueued AI work (202, one provider call).
  CORS only withholds the response; it was never a boundary for side effects.
  **Fix:** `api/originGuard.ts`, mounted before the body parser and every route: an untrusted
  `Origin` (including `null` and a DNS-rebinding page whose Origin equals an untrusted Host) is refused
  with 403 `origin_not_allowed`; a request without Origin is allowed unless the browser marks it
  `Sec-Fetch-Site: cross-site|same-site`; a state-changing request may carry no body or an
  `application/json` body (multipart only on the upload route), anything else is 415. Content type
  cannot be used to bypass the origin check, and the origin check does not depend on CORS headers.
- **P1 — retry budget:** an automatic-checks run was a run in `runs` and counted against
  `ANALYSIS_MAX_RUNS`. `aiAttempts(runs)` now counts every run except one explicitly marked as an
  automatic-checks request; it is used by `enqueue`, restart recovery, the background retry and
  `can_reprocess`. `run_count` and the full history are unchanged; historical unmarked degraded runs
  still count; no migration.
- **P1 — eligibility:** the server reports `automatic_checks_available` (shared
  `canRunAutomaticChecks`, mirroring its own refusals); the action is shown only when true. A 409 race
  refreshes the page and says nothing was changed.
- **P2 — header wording (approved text only):** "Recorded AI Replay" with the explanation and the
  live-LLM prompt, shown only when no live model is configured and recordings exist. No README or guide
  exists in the repository, so "View LLM Setup Guide" is non-clickable text with a note until a target is
  set in `lib/docs.ts`.
- **P2 — minimal UX:** singular/plural in the filter result line; touch size of "Also in" links on
  narrow screens; recovery wording after a 409. The graph layout, styling and animations were not changed.
- **What did not go right (kept for the record):**
  1. My first origin rule accepted a same-origin request by comparing `Origin` with `Host`. All unit
     tests passed, but the real browser run showed the in-app "Run automatic checks" button failing with
     403 behind the Vite dev proxy, because the proxy sends the TARGET as Host. The dev-proxy case is
     therefore covered by the allow-list (the default `CORS_ORIGIN` includes the default Vite origins
     5173), not by the Host rule; any other dev port must be added to `CORS_ORIGIN`. I had also named
     a unit test after the dev proxy that actually tested direct same-origin access; renamed.
  2. The 7D.3 demo stack used Vite on port 5199, which is not in the default list; it was restarted with
     `CORS_ORIGIN` including it (the documented setting).
  3. Two web tests needed `findAllByText` (the status text legitimately appears twice).
- **Executed validation (final tree):**
  - typecheck 0 errors; `npm test`: server **31 files / 600 tests** (+24: origin 14, retry budget 10),
    web **21 files / 224 tests** (+12); build exit 0 (JS 335 kB / 102 kB gz, CSS 58 kB).
  - **Mutation checks** (temporary, restored byte-identical), 10 of 10 caught: guard not mounted -> 7
    fail; untrusted Origin accepted -> 4; rebinding host check removed -> 1; content types unrestricted
    -> 2; cross-site marker ignored -> 1; enqueue/`can_reprocess`/recovery/background retry counting
    automatic runs -> 3 / 1 / 1 / 1; availability ignoring a held AI extraction -> 1.
  - **Real browser** (headless Edge, isolated backends, temporary databases): a real attack page on
    another origin sent four simple cross-origin POSTs (reprocess, forced reprocess, automatic checks,
    paste with `analyze:true`) to a live-configured backend whose provider is a loopback counter: all
    four answered 403, no email stored, no record changed, **0** provider requests; a control (trusted
    no-Origin reprocess on the same stack) reached the counter. In-app actions through the dev proxy
    (default port 5173 and the listed 5199) answered 200. Header wording, panel, non-clickable guide
    label, E004/E009 relationship and the graph design verified; offline replay of E001/E004/E007 and
    rules-only E009 through the real endpoints; no external connection (guard log).
  - Fixtures and seed byte-identical; secret scan clean.
- **Unresolved / residual:**
  - There is still no authentication or authorization: any non-browser client that can reach the port
    can call every route. This work removes the browser-mediated attack only.
  - A page served from an allow-listed origin, or malicious software running as the same user, is
    trusted by this policy.
  - `MAX_RUN_LOGS` (10) still bounds the stored history; AI attempts older than the last 10 runs are
    no longer counted, as before.
  - The setup-guide target does not exist yet (Phase 8).
- **Time:** total development time was not measured.
- **Next:** independent review; nothing committed or pushed.


### 2026-10-11 — Phase 7 final commit gate

- **Authorization:** the operator authorized validating, committing and pushing the existing Phase 7
  work to the private `origin/main`, with no new feature work. No Groq call, no new recording, no
  fixture or seed change, no new dependency.
- **Pre-commit review:** branch `main`; remote `SaadAmaria/mail-risk-intelligence` (private);
  `HEAD`, `origin/main` and the remote ref all `a38b31c`; nothing staged. The complete combined
  change set was reviewed as one: 21 modified and 35 new files, all source, test, stylesheet or
  documentation. No credentials, temporary databases, screenshots, build output or environment files
  are among them (`.env`, `web/dist`, `server/data` and the `node_modules` folders are ignored).
  The only edit made at the gate was documentation: this entry, the missing 7C and 7D.1 entries, and a
  corrected comment in `.env.example` (the 7E guard means the dev origin must be in `CORS_ORIGIN`).
- **Validation executed at the gate (not carried over):** typecheck 0 errors in all workspaces;
  `npm test`: server 31 files / 600 tests, web 21 files / 224 tests; production build exit 0; the
  security and replay subset (origin guard, retry budget, automatic checks, API security, replay): 5
  files / 96 tests; `git diff --check` clean; fixtures and seed byte-identical to the baseline.
- **Commit strategy:** one commit. The phases share rewritten files (router, inspector, claims, copy,
  the API app and the stylesheet), so two commits would have required reconstructing intermediate
  states that never existed or leaving a broken one.
- **Headings above:** the entries for 7B.1-7E were written before this commit and are headed
  "uncommitted"; they are left unchanged as a record of their time, and this entry supersedes that
  status.
- **Known limitations carried forward:** no authentication or authorization (the 7E guard removes the
  browser-mediated attack only); a non-default dev origin must be added to `CORS_ORIGIN`; the
  setup-guide target does not exist yet and the header's "View LLM Setup Guide" is non-clickable until
  the README section is written in **Phase 8**; the sender/recipient role for entity risk marks needs an
  API extension; the force-layout module is unused by the interface; no screen-reader or axe audit,
  touch was emulated, only Chromium/Edge was exercised.
- **Time:** total development time was not measured.


### 2026-10-11 — Phase 8: documentation, developer experience and reviewer handoff (implemented, **uncommitted**)

- **Authorization:** implementation only; no commit/push, no Groq call, no recordings, no fixture or
  seed change, no new dependency, no graph redesign. Baseline `9a6dc20`, clean tree, remote private.
- **Reviewer's overview of how AI tooling was used (a summary; the chronology above is the record):**
  - *Claude Code (model `claude-sonnet-5-5`)* planned, implemented, tested and documented every
    phase under written governance (`CLAUDE.md`): implementation only inside an authorized phase,
    decision records for significant choices, no claims without an executed test, nothing committed
    without explicit authorization.
  - *The human candidate* set the phases and scope, approved or rejected decisions, authorized every
    commit and push, chose the visual direction (supplying a reference image for the graph) and decided
    what to defer. An independent AI reviewer's findings were relayed by the candidate and are recorded
    where they changed the work.
  - *Where the agent was corrected or corrected itself:* the early rules-only-as-zero-config design;
    a health-handler defect; unverifiable highlights; a first-pass "same origin" security rule that
    failed in a real browser; an inaccurate "44 px targets" claim; several tests that passed without
    being able to fail (found by mutation checks). Each is in the dated entries above.
  - *Recordings:* produced by a genuine run against Groq by the operator-controlled recorder, sealed
    with integrity hashes; replay passes through the same validation. See D59-D68.
  - *Security testing:* an audit found a cross-origin POST starting AI work; it was reproduced with a
    fake provider, fixed (D92) and re-proved with a real browser attack page against a stack whose
    provider was a loopback counter.
- **Clean-room verification (executed):** a fresh clone of HEAD into a temporary directory, then
  `npm ci` (about 10 s), `npm run build`, `npm run dev` with no `.env`. Observed: seed 10 created;
  health `configured:false`, replay available for E001/E004/E007; recorded replay of E004 through the
  dev proxy returned 202 and ended `complete` / `recorded` / medium; rules-only checks 200; a pasted
  email and an `.eml` upload were stored (201); the graph returned entities and edges; the frontend
  and `/graph` were served; the clean clone's own typecheck and test suites passed (31 + 22 files).
  No provider was contacted.
- **What did not go right (kept for the record):**
  1. My first clean-room start ran Vite from the repository root instead of `web/` and served 404;
     that was my test command, not the project. The documented command (`npm run dev`) was correct.
  2. Port `3001` and `5173` were occupied on this machine (the operator's own dev server and a
     leftover Vite of mine). The clean room therefore used `PORT=3411` and Vite port 5411 with
     `CORS_ORIGIN` listing it; this is why the README says a non-default Vite port must be listed.
     The default ports themselves could not be exercised in the clean room here.
  3. The header's guide link was activated with a GitHub blob URL. The repository is private, so it
     opens only for people with access; the URL's anchor cannot be fetched from GitHub until this
     change is pushed. It is verified here against the README's own headings by a test, not against
     the remote.
- **Documentation produced:** `README.md` (with `#live-llm-setup`), `docs/REQUIREMENTS_TRACEABILITY.md`,
  four real screenshots in `docs/screenshots/`, a corrected `.env.example` comment (no claim that a
  local model is supported), and tests that keep the README's anchors, relative links and claims
  honest (`web/src/lib/docs.test.ts`).
- **Not done / limits:** no screen recording; total development time was not measured and none is
  claimed; the README's statement about Groq's free tier points the reader to Groq's current terms
  rather than quoting limits; local-model support is untested.
- **Next:** independent review, then an explicit commit authorization.


### 2026-10-11 — Phase 8 final acceptance gate

- **Authorization:** review, correct and, if every gate passed, commit and push the Phase 8 changes
  (message `docs: complete reviewer setup and requirements guide`). No Groq call, no tag, no release.
- **Corrections made:** README test counts (server 31 files / 600, web 22 files / 231); the free-tier
  or local LLM requirement restated (the brief allows either; Groq's free tier is what was implemented
  and exercised; Ollama and local models are not implemented or tested); a "Time spent" section stating
  that total focused time was not measured.
- **Traceability count reconciled:** the table always had 24 rows. The discrepancy was in my previous
  chat summary (I reported 18 Done), not in the file. Counted from the file: 19 Done, 4 Partial, 1 Not
  done. Two rows were then re-classified on their merits: the PDF row (OCR is not required by the brief
  and is not offered, so text-layer-only is a limitation of a Done requirement) and the LLM row (either
  option suffices). Final: **21 Done, 2 Partial (narrow viewport; time statement), 1 Not done (optional
  screen recording)**, now stated at the top of the document.
- **Four ingestion paths, executed in an isolated environment (temporary database, no LLM variables,
  port 3421):** pasted text, a `.txt` upload, an `.eml` upload and a text-layer `.pdf` (generated by
  the test helper) were each stored (201, `source_kind` paste/txt/eml/pdf), reported
  `not_started` and eligible for automatic checks, accepted automatic checks (200, `degraded` /
  `rules`), survived a server restart with the same state, and appeared in the inbox and detail view
  labelled "Automatic checks only / Not assessed". A blank (image-only) PDF was refused with 422
  `ocr_unsupported`. No new message received an AI analysis; health stayed `configured:false`.
- **Not verified:** the remote README anchor (the repository is private and the file is not yet
  pushed) beyond the test that matches the link to the README's own heading.
- **Time:** total development time was not measured.


### 2026-10-11 — Phase 9B: independent audit remediation (implemented, **uncommitted**)

- **Context:** an independent audit (Codex) reported reproducible correctness defects that Phase 9A
  had not found. The operator asked that each be reproduced against the current source before any fix.
  Each was reproduced; none was accepted on trust. Phase 9A's uncommitted changes were preserved.
- **Findings and outcome (each reproduced by a test that fails on `HEAD` and passes now):**
  1. **P1 timeout.** Confirmed by reading and by test: the abort timer was cleared when the response
     headers arrived, so a stalled body held the single worker forever. Fixed: one deadline covers
     connect, headers and body, enforced by racing so a transport that ignores abort cannot hold it;
     the body is read with a size cap (default 1 MiB). 6 of 6 new deadline tests failed on `HEAD`
     (timing out at the test limit), plus a queue-progress test.
  2. **P1 relationship grounding.** Confirmed: a real quote was enough for any predicate
     (the audited `threatens` with an invoice subject was accepted). Fixed (D98): endpoint-type table,
     a necessary-wording filter for `threatens` / `alleges_against`, unknown predicates dropped
     instead of mapped to `related_to`. The audit's E001 amount case: an amount is kept only as the
     thing transferred and labelled "requests transfer of"; the recorded E001 still replays to its
     captured digest, so no fixture needed to change.
  3. **P1 person identity.** Confirmed: a model-supplied address was trusted merely because it
     appeared somewhere in the message, so an unrelated person could be merged into the sender.
     Fixed (D99): only an address the message itself ties to the name (header display name, or
     "Name <addr>" / "(addr)" / "at addr" in its evidence text) or an entity named by the address.
  4. **P2 malformed JSON.** Confirmed: one syntactically invalid column made `listAnalyses` throw
     and took the inbox and graph down. Fixed (D100): per-column safe parse, the record is
     downgraded, the email and healthy records are untouched, nothing is rewritten or invented.
  5. **P2 organizations and masked accounts.** Confirmed: "Acme Inc." and "Acme LLC" merged;
     "checking ... 1234" and "savings ... 1234" of one owner merged. Fixed (D101): legal forms are
     kept apart only when the data contains both, and differently described masked accounts of one
     message stay apart. Verified merges still merge.
- **Behaviour changes to disclose:** an older stored analysis is not rewritten, so existing live
  graphs can still contain relationships accepted under the old rules until re-analysed; the
  display wording changed for a transfer whose target is an amount; the graph's identity keys can
  differ from before only where the data shows an ambiguity.
- **Documentation corrected:** the README no longer implies every AI claim is verified; it has a
  "What is verified, and what is not" table; it says that capturing the recordings needed the
  operator's Groq key and replaying them needs none; the time section states that a retrospective
  estimate is not possible. The Phase 9A storyboard's wording "explainable risk evidence" is
  qualified in the report: quotes are verified, interpretations are the model's.
- **What did not go right:** several of my edit scripts were mangled by shell quoting and were redone
  with file-based scripts; two older tests asserted the defective behaviour and were rewritten
  (they are named in the diff); my own first browser wait used a case-sensitive pattern against
  upper-cased CSS text.
- **Time:** total development time was not measured and cannot be reconstructed.

### 2026-10-11 — Phase 9C: independent re-audit findings closure (implemented, **uncommitted**)

- **Context:** a second independent audit concluded PASS_WITH_FINDINGS / fix before shipping: the 9B
  improvements were valid but not complete. Each remaining finding was reproduced before being fixed.
- **Reproduced and fixed:**
  1. **Cancellation hang.** `await body.cancel()` in the failure path never returned for a stream whose
     cancel never settles (oversized declared length), so the original error and the worker were held.
     Cleanup is now fire-and-forget with no unhandled rejection. 2 new tests hang on the earlier code.
  2. **Structural stored-JSON failures.** `attempts_json=[null]`, `[{}]`, `to_json=[null]` and
     related shapes crashed reads. Elements are validated individually; bad elements are dropped and
     reported; 11 new tests crash without the schemas. Nothing is rewritten on read.
  3. **Masked accounts across messages.** "checking ... 1234" and "savings ... 1234" of one owner
     merged. Masked mentions now merge only when described identically; complete numbers merge.
  4. **Relationship semantics.** My 9B filter used an English word list to *drop* relationships: that
     both missed negated and reversed threats and rejected valid uncommon phrasing. I removed the
     drop. Validation is now structural only; a read-time advisory flags weak support (names not in
     the quote, order, wording present/absent/negated) and the UI shows "Check this quote". Legacy
     stored analyses are re-checked structurally on read and impossible relationships are excluded
     and counted, without rewriting them.
- **Disclosure:** the 9B behaviour (dropping accusations without cue wording) is reversed here; D98 is
  superseded by D103. Relationships dropped by 9B for lack of cue wording are no longer dropped.
- **Documentation:** overstatements corrected; "No authentication" is an exemption; implementation
  status is separated from independent verification; `docs/AUDIT_CLOSURE.md` added.
- **Development time:** not measured. The earlier statement that a retrospective estimate was
  impossible was too strong: timestamps give an upper-level indication (about 9.1 h elapsed span of
  agent-session events, about 6.9 h of continuous activity at a 5-minute gap threshold). That is
  session activity, not focused human time, and it is disclosed as such in the README.
- **What did not go right:** my 9B cue list was a poor design that I presented as conservative; shell
  quoting corrupted three of my edit scripts and a regular expression (found by the compiler); I had
  to redo them as file-based scripts.

### 2026-10-12 — Phase 9D: final audit P2/P3 closure (implemented, **uncommitted**)

- **Prompt (human, relayed from the final independent review):** no P0/P1; FIX_BEFORE_SHIPPING over
  inconsistent relationship-uncertainty presentation (P2), silently dropped email-field elements
  (P3), and two misleading timeout tests (P3). Targeted fixes only; no commit, push, live provider or
  port-3001 process.
- **Preserved:** HEAD `633ddd1`; all 9A–9C changes, including untracked files, left intact; seed and
  recorded fixtures byte-identical (SHA-256 compared with HEAD).
- **P2 (done):** the server's existing `review`/`support` metadata now drives one shared
  note/chip on the email-detail rows, Graph List, canvas accessible names (dashed outline as the visual
  cue), graph inspector (unchanged) and graph-to-evidence callout. The callout now reads "This passage
  was cited for this AI-inferred relationship", and separates found-in-text from meaning. No heuristic
  runs in the browser (D107).
- **Found during P2 testing:** `applyFilters` dropped the edge-level `review` flag, so the
  legacy-shape tests failed in every graph view. Fixed.
- **P3 address reporting (done):** `read_issues` computed on read; partial lines marked incomplete,
  "Could not be read" instead of "No recipients listed"; D105 and D100 overstated the earlier behaviour
  and are corrected (D105 note, D108).
- **P3 tests (done):** inspection confirmed both findings. Beyond that, the rejecting-cancel test never
  reached the stream's cancel because the stream was locked to the reader. The client now cancels via
  that reader. Tests were rewritten so each reaches its named path, and a separate synchronous-throw test
  was added. 3 rewritten tests fail when the 9C release logic is temporarily restored; the file was then
  restored and re-run (18/18).
- **Executed validation:** typecheck 0 errors; server **38 files / 701 tests**, web **23 files / 259
  tests**, all passing; production build exit 0; `git diff --check` clean; secret scan (Groq/OpenAI/AWS
  key and private-key patterns over tracked and untracked files) no matches; real-recording replays of
  E001/E004/E007 checked by digest in `relationship-grounding.test.ts`. Isolated Edge run (API 3491 / web
  5491, new temporary database, no env file, 0 LLM/Groq variables, outbound guard loaded, 0 sockets
  opened): recorded replays, E009 partly and E002 wholly corrupted in that temporary database only;
  **46/46** checks at 1440x900 and 375x812. The isolated processes were stopped afterwards.
- **Corrections during the phase (mine):** my first browser script assumed the graph-linked passage
  had one relationship. In the real E001 data the same quote is cited by two relationships (one
  flagged), and the UI correctly used the plural with the note under the flagged one. The script was
  fixed, not the app. Two other script errors (CSS-uppercased label read via `innerText`, an escaped
  newline) were also script-side.
- **Not verified:** screen-reader run, axe audit, non-Chromium browsers, physical touch device, real
  provider outage. The inbox and graph do not display read issues.
- **Time:** human focused time not measured. Agent activity for this phase: first timestamped command
  15:23 local, this entry about 15:40; the initial inspection before 15:23 has no timestamp.

### 2026-10-12 — Phase 9D delta: remaining review findings (implemented, **uncommitted**)

- **Prompt (human, relayed from the independent review of 9D):** two P2 findings
  (`FeaturedRelationship` ignores review; both inspectors ignore edge-only legacy review) and P3
  documentation inaccuracies. Targeted fixes only; no commit or push.
- **Correction to the 9D entry above:** it said the review metadata drove the note "on … graph
  inspector (unchanged)" and the README said "wherever a relationship is shown". Both were too broad.
  The desktop featured relationship never showed the note; my own 9D screenshot shows the flagged
  "James sent email to Arcline" featured without it, and I did not notice. The inspectors missed
  edge-only flags.
- **Reproduced first:** the new tests were run against the 9D code: 9 of 19 inspector tests failed
  (4 featured, 4 inspector legacy, 1 accessibility). The 3 new filter tests failed against the pre-9D
  filter, which was temporarily restored and then put back.
- **Fixed:** `unattributedReview()` (relationship-level flag that no citation explains, shown once);
  both inspectors and the featured panel use it; the featured panel features the flagged citation;
  `claims.ts` follows the same rule. Still no heuristic in the browser (D107 correction).
- **Docs corrected (with notes, not silent rewrites):** README place list (no "every surface"), test
  counts, which tests use real SQLite, recording-key contradiction; traceability counts;
  `AUDIT_CLOSURE.md` delta table; D107 correction.
- **Executed validation:** typecheck 0 errors; server **38 files / 701 tests**, web **24 files / 281
  tests**, all passing; build, `git diff --check`, fixture SHA-256 and secret scan as listed in the
  report. Isolated Edge stack (new temporary database, 0 LLM/Groq variables, outbound guard, no sockets
  opened): delta checks **25/25** and the 9D checks re-run **46/46** at 1440 and 375 px. The stack was
  stopped afterwards. The edge-only legacy shape cannot be produced by the current server (it always
  attaches per-quote support), so that path is verified in jsdom only.
- **My mistakes this round:** a test helper first matched nested quotes (tightened to direct children
  before the final failure run); the browser script again used `innerText` on CSS-uppercased headings;
  my first README wording miscounted the SQLite test files (five vs six) and was corrected before
  finishing.
- **Time:** human focused time not measured; agent activity about 15:42–16:00 local.

### 2026-10-12 — Historical audit ledger reconciliation (documentation only, **uncommitted**)

- **Prompt (human):** a historical closure audit (C) found 71 findings across the two original audit
  reports (A, B), 17 of them missing from `docs/AUDIT_CLOSURE.md`, the duration requirement unmet,
  and recommended HOLD. Documentation-only reconciliation; no code, tests, fixtures or commits.
- **Agent's first response:** the reports were not in the workspace, so I asked for them instead of
  guessing the 71 findings. The operator then supplied all three, plus a retrospective estimate of
  about 8 hours of total personal involvement, including planned demo preparation; the video is not
  finished.
- **Done:** read A, B and C completely. `AUDIT_CLOSURE.md` now has one master matrix (H01–H71) with
  C's original severities and sources, checked by script: 71 unique IDs, totals sum to 71, every
  severity and source matches C. It also has individual rows for the 17 missing findings, a
  development-time section, a mapping from the former rows, and the pre-reconciliation ledger kept
  verbatim as an appendix. Traceability gained an independent-evidence column and an evaluation
  criteria and delivery section; row 24 changed from "Partial" to "Estimate". README: the time
  section, the prompt-clipping limit, and author versus independent test counts.
- **Corrections of earlier records (dated, not silent):**
  - DECISIONS D98: "16 grounding tests … failing on HEAD" were import failures (`relationshipRules.ts`
    did not exist at HEAD). The same applies to item 2 of the Phase 9B entry above ("each reproduced
    by a test that fails on `HEAD`"): for that item the file failed at import, not test by test.
  - The Phase 9B entry's "a retrospective estimate is not possible" and the Phase 9C wording are
    superseded by the operator's estimate. Measured focused time remains unmeasured.
  - README session-activity figures: recounted from the transcripts. The 2026-10-11 window gives 4,201
    events (4,199 had been written) with the same hour figures; 2026-10-12 was added.
  - The test totals 701/281 are the author's. Audit C executed 563 server tests (31 files) and 281
    web tests.
- **Judgment calls left for review:** H40 is classified NOT_INDEPENDENTLY_VERIFIED (estimate
  disclosed, measured duration UNMET) rather than OPEN, because the brief asks to be told honestly how
  long was spent and an estimate now answers that. The estimate includes time not yet spent. H34 (real
  hostile PDFs) is an accepted confidence gap, explicitly untested by anyone. H39 (scope compression)
  is an accepted evaluation judgment, not a product defect.
- **Not done:** no runtime code, test, fixture, seed, environment or dependency change. The
  "legitimate relationships" test title (H54) needs a test edit and is deferred. No PROCESS index
  (H44, deferred).
- **Time:** human focused time not measured; agent activity for this pass about 16:32–16:45 local.

### 2026-10-12 — H40/H41 duration wording (documentation only, **uncommitted**)

- **Prompt (human):** the independent Codex verification of the reconciled ledger confirmed all 71
  findings accounted for and no reproducible P0/P1/P2 product defect in the verified scope. Its only
  remaining blocker was inconsistent duration wording in H40/H41. The operator supplied the exact
  statement: "**Estimated Project Duration:** Approximately 8 hours, including planning, development,
  testing, code review, documentation, and demo video production." It is the operator's approximate
  overall project-effort estimate, not a precisely measured duration.
- **Classification now:** disclosure SATISFIED (approximate estimate); precise focused-time
  measurement NOT AVAILABLE; independent verification NOT PERFORMED; demo video PLANNED, NOT YET
  COMPLETED. H40 and H41 keep the status NOT_INDEPENDENTLY_VERIFIED; neither is counted as open or
  unmet. Traceability row 24 is "Satisfied (estimate)", kept separate from "Done".
- **Supersedes, does not erase:** the previous entry's "measured duration UNMET" and its judgment
  call about H40. The earlier wording ("about 8 hours of total personal involvement") is noted in the
  README and the ledger.
- **Not changed:** runtime code, tests, fixtures, seed, environment, dependencies; DECISIONS.md (it
  has no duration statement); the ledger appendix (pre-reconciliation record).

---

<!-- Append new entries below. Format: date, prompt, agent output, human correction, decision, observed result. -->
