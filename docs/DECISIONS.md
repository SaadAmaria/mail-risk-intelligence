# Decision Records

Significant architectural decisions for the Mail Risk Intelligence take-home.

**How to read this file**
- **Owner:** the candidate owns every decision. "Proposed by" says who suggested it.
- **Recorded:** `contemporaneous` = written when the decision was made; `retrospective` =
  written afterwards from the conversation record. Entries D1–D12 are retrospective
  (written 2026-10-11 during Phase 0 closure). Only D13 was written as the change was made.
- **Alternatives** lists only options that were actually raised in the planning rounds.
  Where an alternative is listed that was *not* discussed at the time, it is marked
  **(retrospective)**.
- **Verification** states only what has actually been executed. "None yet" is common
  because only the Phase 0 scaffold exists.
- Nothing here claims an option is universally best; each is judged for this assignment
  (5–6 focused hours, reviewer-run on an unknown machine, no paid API key).

Planning rounds referenced below are logged in `PROCESS.md`: Round 1 (independent
analysis), Round 2 (cross-review), Round 3 (four mandatory corrections → Freeze V1.1).

---

## D1. Stack: Node/Express + TypeScript backend, React + TypeScript + Vite frontend

- **Context:** brief requires React + TS and Node/Express *or* Python/FastAPI.
- **Selected:** Node + Express + TS end to end; shared zod contracts.
- **Alternatives considered:** Python/FastAPI (Round 1); Next.js full-stack (Round 1).
- **Rejected/deferred because:** FastAPI adds a second toolchain and a type-sync seam;
  Next.js deviates from the stated Express/FastAPI constraint.
- **Trade-offs/limitations:** gives up Python's PDF/email ecosystem conveniences;
  Node-specific install concerns (see D2, D12).
- **Verification:** Phase 0 typechecks, build, and dev boot executed (see D13 and PROCESS.md).
  No feature-level evidence yet.
- **Proposed by:** Claude (Round 1). **Status:** approved by candidate with Freeze V1.1;
  independent reviewer agreed with this foundation in Round 2.
- **Open:** candidate was asked whether Python is their stronger language; no answer on record.

## D2. Storage: SQLite behind a repository interface

- **Context:** persist emails, analyses, entities, relationships; data model quality is
  evaluated on the full-stack track.
- **Selected:** SQLite via `better-sqlite3`, ~5 tables, repository interface with an
  in-memory implementation for tests.
- **Alternatives considered:** JSON file store (Round 1/2); `sql.js` (WASM) named as an
  install-failure contingency (Round 2).
- **Trade-offs/limitations:** native module may fail to install on some machines; JSON is
  simpler but weaker for the entity/relationship model.
- **Verification:** **none yet** — not implemented, `better-sqlite3` not installed.
- **Proposed by:** Claude. **Status:** approved with Freeze V1.1; install risk unverified.

## D3. Two sequential LLM agents with an evidence-snippet grounding chain

- **Context:** brief requires Agent A (extraction) → Agent B (risk & graph), B's input is A's output.
- **Selected:** B receives only validated A output. A emits `evidence_snippets` with
  locations (code appends deterministic snippets). B cites snippet ids plus quotes that must
  be substrings of the cited snippet; chain B ⊂ A snippet ⊂ original is checked in code.
- **Alternatives considered:** feeding code-computed signals into B (my Round 1 design);
  grounding B directly against raw text.
- **Rejected because:** extra inputs complicate B's contract and bias the model (Round 2);
  direct raw-text grounding contradicts "B receives only A's output" (Round 3 correction).
- **Trade-offs/limitations:** grounding is transitive; a poorly chosen snippet set can
  starve B of evidence (mitigated by deterministic snippets). A's `summary` is untrusted.
- **Verification:** schemas typecheck (Phase 0). Validator and tests are Phase 2.
- **Proposed by:** Claude; correction raised by the independent reviewer (Round 3).
  **Status:** approved with Freeze V1.1.

## D4. Analysis modes and the "none only from validated AI" invariant

- **Context:** a rules-only engine must not look like two working LLM agents.
- **Selected:** modes `complete | partial | degraded | failed`; `none` reachable only from a
  validated AI assessment; failed/unprocessed is shown as "not assessed".
- **Alternatives considered:** rules-only engine as the zero-config path presented as
  equivalent (my Round 1 proposal).
- **Rejected because:** the brief requires LLM agents; reviewer challenged it (Round 2).
- **Trade-offs:** no-key reviewers see degraded or recorded output unless they supply a provider.
- **Verification:** none yet (schema enums only). **Proposed by:** Claude, reshaped by reviewer.
  **Status:** approved with Freeze V1.1.

## D5. Risk aggregation: tiered signals, rules capped at `medium`

- **Context:** avoid false-positive "high" from heuristics; edit distance and URL mismatch
  are not proof of phishing.
- **Selected:** lookalike-domain/URL-mismatch are *observations*; contextual indicators
  (action request, pressure, impersonation claim) combine with them; rules alone cap at
  `medium`; `high` requires a grounded AI `high`; every escalation carries a rationale and
  evidence; negative tests required.
- **Alternatives considered:** unconditional `max(AI, rules floor)` (Round 1); relying on the
  LLM alone (discussed in Round 2 as the alternative to any floor).
- **Rejected/modified because:** unconditional floors over-escalate benign mail (Round 2/3);
  LLM-only is inconsistent for small models and injection-prone.
- **Trade-offs:** degraded mode under-rates E001/E008 (max `medium`) by design.
- **Verification:** none yet. **Proposed by:** Claude; narrowed by reviewer (Round 2, 3).
  **Status:** approved with Freeze V1.1.

## D6. Cross-email intelligence is derived at read time

- **Context:** E004 vs E009 payment-detail change needs history.
- **Selected:** persist only per-email LLM outputs and deterministic facts; compute findings
  and final risk at read time, comparing against earlier-dated peers; vendor identity ladder
  `consistent | tentative | unknown`.
- **Alternatives considered:** a stored post-step with re-evaluation (Round 1); LLM-based
  cross-email reasoning (listed as excluded).
- **Rejected because:** stored results create ordering/staleness problems at no benefit
  for 10 emails.
- **Trade-offs:** O(n²) at read time; regex/format-dependent fact extraction.
- **Verification:** none yet. **Proposed by:** Claude, per reviewer concern (Round 2).
  **Status:** approved with Freeze V1.1.

## D7. LLM access: one OpenAI-compatible client, no provider fallback chain

- **Context:** free-tier or local LLM, no paid key, document the choice.
- **Selected:** a single OpenAI-compatible client configured by `LLM_BASE_URL`,
  `LLM_MODEL`, `LLM_API_KEY`; Groq free tier or local Ollama.
- **Alternatives considered:** Gemini free tier; multi-provider failover chain (Round 2).
- **Rejected because:** Gemini needs a different API shape; a chain adds config and
  failure combinations disproportionate to the time box.
- **Trade-offs:** no automatic cross-provider failover; small local models may need repair retries.
- **Verification:** none yet; free-tier limits and model names were **not** verified.
- **Proposed by:** Claude. **Status:** approach approved with Freeze V1.1;
  **the concrete default provider/model is still undecided and awaits the candidate.**

## D8. Recorded fixtures only from genuine dual-agent runs

- **Context:** reviewers likely have no key; replay must not misrepresent AI analysis.
- **Selected:** `npm run record` writes fixtures only after successful live runs of both
  agents, with provider, model, versions, timestamp, content hash; loader rejects mismatches;
  otherwise degraded analysis, clearly labeled.
- **Alternatives considered:** hand-authored or rules-derived "expected" outputs
  (rejected in Round 3).
- **Trade-offs:** needs a live provider run by the candidate; checksum detects accidental
  edits only, not tampering.
- **Verification:** none yet; no fixtures exist. **Proposed by:** Claude; constrained by
  reviewer (Round 3). **Status:** approved with Freeze V1.1.

## D9. Asynchronous processing with polling

- **Context:** LLM calls may take seconds to tens of seconds; seeds must not block startup.
- **Selected:** in-process FIFO queue (concurrency 1–2), status in the DB, UI polling.
- **Alternatives considered:** synchronous request/response; SSE/WebSockets (Round 2).
- **Trade-offs:** polling latency; in-process queue is lost on restart (requeue on boot planned).
- **Verification:** none yet. **Proposed by:** Claude. **Status:** approved with Freeze V1.1.

## D10. PDF ingestion: mandatory, text layer only

- **Context:** brief lists `.pdf` uploads.
- **Selected:** TXT, EML, and text-based PDF are mandatory; scanned PDFs return an explicit
  "OCR unsupported" error.
- **Alternatives considered:** deferring PDF as a cut item (Round 2) — reversed by reviewer
  in Round 3; OCR (excluded).
- **Verification:** none yet. **Proposed by:** Claude; reversed by reviewer (Round 3).
  **Status:** approved with Freeze V1.1.

## D11. Knowledge graph: gated bonus built on derived aggregation

- **Selected:** attempt only if Phases 0–6 finish by about T+4:55; otherwise ship an entity list.
- **Alternatives considered:** skip the bonus; build the graph before testing/docs.
- **Trade-offs:** the seed data yields mostly per-email stars, so the graph may look sparse.
- **Verification:** none yet. **Proposed by:** Claude. **Status:** approved with Freeze V1.1
  (gate included). Rendering library not yet chosen.

## D12. Phase 0 build/runtime choices

- **Context:** time-boxed scaffold that a reviewer can run with minimal steps.
- **Selected:**
  1. Run the server through `tsx` (no separate compiled backend build).
  2. Consume `@mri/shared` directly from TypeScript source.
  3. Support Node `>=22.9.0`, with Node 24 recommended and tested (`.nvmrc` = 24); the floor
     exists because `--env-file-if-exists` needs 22.9+.
- **Alternatives:** **(retrospective — not evaluated at decision time)** compiling the
  server with `tsc`/a bundler to `dist/`; a pre-built `shared` package with project
  references; `dotenv` instead of Node's env-file flag.
- **Trade-offs:** (1) fewer steps, but not a production-style artifact and slower cold
  start; (2) no build step, but the web and server toolchains must both transpile shared
  source; (3) older Node versions fail on the flag rather than degrading gracefully.
- **Verification (executed):** clean-copy `npm ci`, typecheck, `vite build`, and
  `npm run dev` boot with health via direct and proxied calls (Phase 0 verification, see
  PROCESS.md). Older Node versions were **not** tested.
- **Proposed by:** Claude. **Status:** explicitly approved by the candidate on 2026-10-11;
  applies to this take-home, not as a general production recommendation.

## D13. Phase 0 closure: loopback binding and proxy port (F1, F3, F4)

- **Recorded:** contemporaneous (2026-10-11).
- **Context:** independent verification found (F1) a wrong relative `DB_PATH`, (F3) a
  hardcoded dev-proxy port, (F4) the server binding all interfaces.
- **Selected:** `DB_PATH=./data/mail-risk.db`; server binds `127.0.0.1` by default
  (`HOST` override); Vite proxy target reads `PORT` (default 3001) and uses `127.0.0.1`.
- **Alternatives:** **(retrospective)** keep the default all-interface bind and rely on a
  firewall; keep `localhost` as the proxy target.
- **Trade-offs:** loopback-only means no LAN access for mobile-device testing unless `HOST`
  is set. Using `127.0.0.1` in the proxy avoids an IPv6 `localhost` mismatch with an
  IPv4-only listener.
- **Verification:** see the Phase 0 closure entry in PROCESS.md for what was executed.
- **Proposed by:** independent reviewer (findings); implemented by Claude.
  **Status:** authorized by the candidate.

## Minor choices (grouped, not independently evaluated)

Express 4, React 18, Vite 6, zod 3, `concurrently`, Node's built-in env-file loading, a
root-level `.env`, plain CSS variables file as the styling start. These were picked by
Claude as known-compatible versions/defaults; newer majors were **not** compared or tested.
Status: part of the approved Phase 0 scaffold, low-risk and reversible.
