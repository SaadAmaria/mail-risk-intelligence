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

---

<!-- Append new entries below. Format: date, prompt, agent output, human correction, decision, observed result. -->
