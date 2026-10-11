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

---

<!-- Append new entries below. Format: date, prompt, agent output, human correction, decision, observed result. -->
