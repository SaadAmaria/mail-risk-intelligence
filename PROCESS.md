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

---

<!-- Append new entries below. Format: date, prompt, agent output, human correction, decision, observed result. -->
