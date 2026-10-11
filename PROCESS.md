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


---

<!-- Append new entries below. Format: date, prompt, agent output, human correction, decision, observed result. -->
