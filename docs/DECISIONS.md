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

## Phase 1 records (storage and ingestion)

All Phase 1 records are **contemporaneous** (written 2026-10-11 while implementing) and
their status is **implemented within the authorized Phase 1 scope; awaiting independent
review** unless stated otherwise.

Each record that was revised after review separates five kinds of statement, so that
original choices are not rewritten into hindsight:

- **Original** — what was decided and implemented in the first Phase 1 pass (unchanged text
  above the corrective block).
- **Review finding** — what the independent reviewer raised.
- **Reproduced defect** — behaviour I observed by running the code, not just argued.
- **Human-approved correction** — the change the candidate authorized.
- **Verification (executed)** — tests/commands actually run after the correction.

Test counts: the first Phase 1 pass ended at 80 tests in 6 files (all passing at that time).
After the corrective round the suite is 138 tests in 8 files, all passing (see PROCESS.md).
Alternatives marked "considered" were considered conceptually in the planning rounds or the
review; **none was benchmarked or trialled** unless a record says so explicitly.

## D14. Ingestion as four stages around one normalized contract

- **Context:** seed JSON, pasted text, TXT, EML, and PDF must flow through one pipeline and
  yield the same structure; failures must be explicit.
- **Selected:** parse (source-specific) → validate (structure) → normalize (shared zod
  `NormalizedEmail`) → persist. Missing headers are `null`/`[]` plus a `missing_headers`
  list; nothing is invented. Text with a header block goes through the same MIME parser as
  EML; header-less text keeps all headers missing.
- **Alternatives considered:** the candidate's brief asked for explicit missing values
  rather than invented ones. **(retrospective)** sentinel strings such as "(unknown
  sender)"; one monolithic ingest function per source.
- **Trade-offs:** an explicit contract costs a shared schema and a mapping layer; consumers
  must handle `null`.
- **Known limitations:** pasted text needs a blank line after the header block to be
  recognized (strict), so a block without one is treated as body.
- **Verification:** `ingest-text`, `ingest-eml`, `ingest-pdf` tests; every source asserts the
  normalized shape, including header-less and partial-header input.

**Corrective round (2026-10-11):**
- **Review finding (F3):** the "nothing is invented" principle was not honored for dates, and
  lenient PDF header recovery could consume body lines.
- **Reproduced defects:** `Date: June 5` became `2001-06-04T21:00:00Z` (invented year, shifted
  by the machine timezone); a PDF body line `Re: …` after the headers disappeared from
  `body`.
- **Human-approved correction:** uncertain sender, recipient, date and subject stay missing:
  see D20 for the date gate and the header whitelist. Address warnings now show the raw
  value (the old message printed an empty string). EML/paste behaviour otherwise unchanged.
- **Verification (executed):** 12 negative-date cases, 9 accepted-date cases, a four-timezone
  determinism test, and PDF header-absorption/memo/prose regressions all pass; existing EML
  tests pass unchanged.

## D15. EML/MIME parsing with `postal-mime` (not `mailparser`)

- **Context:** parse EML safely, with bounded work and no filesystem or network access.
- **Selected:** `postal-mime` 4.0.5, with caps on nesting depth, header bytes, and part count,
  and embedded `message/rfc822` parts kept as attachments rather than parsed inline.
- **Alternatives considered:** `mailparser` was named as a candidate in the Round 2 plan.
  Not benchmarked or trialled side by side.
- **Why this one here:** it declares no runtime dependencies (checked in its package.json)
  and exposes parser limits as options. This is a judgment about fit, not a measured
  comparison; `mailparser` is the more widely used library and I did not test it.
- **Trade-offs:** smaller ecosystem; behaviours observed only through the test corpus.
- **Verification:** 9 EML tests (QP + encoded words, HTML fallback, PDF/text/unsupported
  attachments, limits, embedded message, malformed). **Not verified:** a large corpus of
  real-world EML files.

## D16. PDF text extraction with `unpdf` (pdf.js build)

- **Context:** text-layer PDF is mandatory; scanned PDF must report OCR unsupported; corrupt
  PDF must be distinguishable.
- **Selected:** `unpdf` 1.8.1. Signature check, then page-by-page extraction bounded by page
  count, character count, and a wall-clock budget. Statuses: `ok`, `ocr_unsupported`
  (valid, no text), `invalid_pdf` (bad signature, corrupt, or password-protected), `timeout`.
- **Alternatives considered:** `pdf-parse` and direct `pdfjs-dist` were named in earlier
  notes. Not trialled; a remembered quirk of `pdf-parse` was never verified here.
- **Trade-offs/limitations:** parsing is in-process, so the timeout bounds async stalls but
  cannot interrupt a synchronous CPU-bound loop inside the parser; no OCR; text order and
  line breaks depend on the producing tool.
- **Verification:** extraction, ocr_unsupported vs invalid_pdf, page cap, and signature tests.
  **Important limitation:** test PDFs are generated by a small builder (Helvetica text,
  single font), not produced by real-world PDF tools or containing real scans.

**Corrective round (2026-10-11):**
- **Review finding (F5):** the password-protected and timeout mappings existed in code but
  had no test, so they were unverified.
- **Human-approved correction:** add tests for those mappings.
- **Verification (executed) and its limit:** `pdf-errors.test.ts` (6 tests) replaces the
  pdf.js entry point with a mock, so it verifies **our** status/code mapping
  (`PasswordException` → `invalid_pdf`; a never-settling parse → `timeout` /
  `pdf_timeout` / attachment `failed`). It does **not** show that a genuinely encrypted PDF
  or a genuinely stalled parse behaves that way in pdf.js.

## D17. Repository abstraction: SQLite + in-memory, synchronous

- **Context:** persistence with clean boundaries; repeatable init; safe close; test double.
- **Selected:** `EmailRepository` interface; `SqliteRepository` (better-sqlite3, parameterized
  SQL, WAL for files, `user_version` migration guard, handle closed if init fails) and a
  Map-backed `MemoryRepository`, both run through one shared contract test suite. Address
  lists are JSON columns; `analyses`, `entities`, `entity_mentions`, `relationships` tables
  exist as foundations but have no repository methods yet.
- **Alternatives considered:** JSON file store and `sql.js` (Rounds 1–2). **(retrospective)**
  an async interface; an ORM.
- **Trade-offs:** sync API is simplest with better-sqlite3 but would change if a networked
  DB were substituted; JSON columns are not queryable by address; the unused tables are
  unexercised beyond existence and cascade.
- **Verification:** contract suite on all three backends, persistence across reopen,
  repeated init, newer-schema refusal, cascade delete, hostile-string insertion.
  `better-sqlite3` 13.0.3 loaded and passed on Node 24.11.1/Windows (closes the D2 install
  risk **for this machine only**).

## D18. Idempotent seeding and duplicate handling

- **Selected:** seed ids are preserved as primary keys; an existing id or an identical
  content hash is skipped (`id_exists` / `duplicate_content`). The content hash covers
  from/to/cc/date/subject/trimmed body/attachment names and text. Seeding runs at server
  start. Invalid seed records are reported without aborting the rest; chronology comes from
  dates, not array order.
- **Alternatives considered:** the brief's "restart must not duplicate" requirement fixed
  idempotency. **(retrospective)** dedupe by `Message-ID`; a separate `npm run seed` command.
- **Limitations:** whitespace/quoting variants of a message are **not** deduplicated; a
  pasted message identical to a not-yet-seeded seed record would claim the content and the
  seed id would be reported as `duplicate_content`.
- **Verification:** seed tests (10 emails, idempotent, restart persistence, verbatim fields,
  chronology, error isolation); manual double boot: 10 created, then 10 existing, 10 rows.

**Corrective round (2026-10-11):**
- **Review finding (F1):** content ingested before seeding could prevent a seed message from
  receiving its original id; I should also not have described the collision as reported as
  `duplicate_content` (see below).
- **Reproduced defect:** pasting content identical to E001 and then seeding left E001
  absent. The seed report said `created 9, existing 1, errors []`, because the loader counted
  both `id_exists` and `duplicate_content` as "existing". The same happened for an EML copy.
  The original wording in the "Limitations" bullet above was inaccurate: the collision was
  **not** reported as an error.
- **Human-approved correction (no schema change):**
  - Seed messages hash with a scope key derived from their own id
    (`computeContentHash`), so user content can never occupy a seed identity. Non-seed hashes
    are unchanged; an existing database with unscoped seed hashes still reseeds as
    `id_exists`.
  - Only `id_exists` counts as "existing". Any other non-created result for a seed record is
    an error, and startup verifies that every seed id is actually stored (D21).
  - Duplicate record ids inside a seed file are reported instead of being skipped.
- **Accepted trade-off:** a user pasting a verbatim copy of a seed email *after* seeding now
  creates a separate record (it is no longer deduplicated against the seed message).
  Repeated pastes of that copy are still deduplicated among themselves. Restoring
  dedupe-against-seed would need an additional column and migration, which was not approved.
- **Alternative considered, not implemented:** re-keying an existing pasted row to the seed
  id (destructive and loses provenance).
- **Verification (executed):** paste-before-seed and EML-before-seed keep E001–E010
  (11 rows when the copy exists); idempotent re-seed; legacy-hash row; collision reported as
  error; duplicate-id file; documented post-seed paste behaviour.

## D19. Upload safety policy

- **Selected:** extension allow-list (`.txt`, `.eml`, `.pdf`) plus Content-Type consistency;
  5 MB file / 1 MB paste / 200k stored characters / 10 attachments / 5 MB per attachment /
  30 PDF pages; NUL-byte binary sniff; `%PDF-` signature; embedded content never fetched or
  rendered; filenames reduced to display names. An attachment that cannot be read is stored
  with an explicit status and message (`unsupported_type`, `too_large`, `skipped_limit`,
  `invalid_pdf`, `ocr_unsupported`, `failed`); the message itself is still ingested.
- **Alternatives considered:** **(retrospective)** reject the whole EML if any attachment
  fails (loses the message and its evidence); trust the declared Content-Type alone.
- **Limitations:** the numeric limits are judgment values, not measured; no virus/malware
  scanning; no sandboxing of the PDF parser.
- **Verification:** `upload-safety` and attachment tests.

**Corrective round (2026-10-11):**
- **Review finding (F5):** the original record claimed the tests covered "the exact size
  boundary". That was **overstated**: the boundary test used a 52-byte file and a 65-byte
  file against a 64-byte limit, so it never tested a file of exactly the limit.
- **Human-approved correction:** the claim is corrected here; the test now uses a file of
  exactly 64 bytes (accepted) and 65 bytes (rejected). The same inclusive boundary is tested
  for attachments (16 vs 17 bytes). Added: an undecodable text attachment is recorded as
  `failed` and kept; a fetch spy asserts that HTML with remote links/images triggers no
  `fetch` call (previously asserted only by the output text).
- **Remaining limitation:** the fetch spy covers `globalThis.fetch` only; it does not prove
  the absence of other network paths such as `node:http`, though the code uses none.

## D20. Date normalization, lenient header recovery for PDFs

- **Selected:** dates normalize to UTC ISO-8601 at second resolution so string order is
  chronological; unparseable dates become `null` with a warning. For PDF-sourced text only,
  the header block ends at the first non-header line, because pdf.js drops blank lines.
- **Found by test:** my first PDF test assumed a blank line would survive extraction; it did
  not (see PROCESS.md), so strict detection correctly refused to guess. The lenient rule is
  a correction to that false assumption.
- **Alternatives:** **(retrospective)** keep raw date strings and add an epoch column;
  apply lenient splitting to pasted text as well (rejected: increases false header detection
  in prose).
- **Limitations:** original UTC offset is only retained in `raw_source`; a PDF body line that
  resembles a header or starts with whitespace right after the header block can be
  misclassified.
- **Verification:** header/body split tests (strict vs lenient), PDF header test.

**Corrective round (2026-10-11):**
- **Review finding (F3):** the original rule accepted whatever `Date.parse` accepted, and
  lenient mode treated any `Word:` line after the headers as a header.
- **Reproduced defects (observed by running the code):**
  1. `Date: June 5` → `2001-06-04T21:00:00Z`; `06/07/2026` read as 7 June;
     `2026-06-01 12:00` and `2026-06-01T12:00:00` taken as the machine's local time, giving
     different instants under `TZ=America/Los_Angeles` (so output also depended on the machine).
  2. PDF lines `From`, `Subject`, `Re: your payment is overdue`, `Please pay today.` produced
     a body containing only `Please pay today.`.
  3. A related fix: the MIME parser's own pre-coerced `date` was used, so the raw header
     value is now read instead.
- **Human-approved correction:**
  - **Dates:** accept only RFC 5322 date-times with an explicit zone (numeric offset, `GMT`/
    `UT`/`UTC`/`Z`, or the US named zones) and ISO 8601 date-times with `Z` or a numeric
    offset. Parsing is done from the matched components, not `Date.parse`, so it is identical
    in every timezone and rejects calendar rollover (31 Feb) and 2-digit years. Anything else
    → `null` plus a warning. Date-only values are rejected.
  - **Lenient PDF headers:** the block continues only for recognized header names
    (`from, to, cc, bcc, subject, date, sent, reply-to, sender, message-id, in-reply-to,
    references, return-path`); any other `Word:` line ends the block and stays in the body.
    Folded continuation lines are not honored in lenient mode.
- **Alternatives considered (not benchmarked):** keep `Date.parse` and add warnings;
  default missing years/zones (rejected: that is exactly the invention being prevented).
- **Limitations:** a genuinely wrapped long subject in a PDF is truncated at the wrap (the
  rest lands in the body); a date with an unusual but valid zone abbreviation is rejected;
  weekday names are not cross-checked against the date.
- **Verification (executed):** negative and positive date tables, timezone determinism over
  `UTC`, `America/Los_Angeles`, `Asia/Kolkata`, `Pacific/Auckland`; PDF absorption regressions
  (`Re:`, `Note:`, `Regards:`, `Attachments:`, indented line), memo and prose cases.

## D21. Strict startup policy for mandatory seed data

- **Context:** the seed mailbox is a mandatory deliverable. The first pass kept the server
  healthy when seeding failed, which the reviewer rejected.
- **Review finding (F2):** a reviewer must never see a healthy demo whose seed data silently
  failed.
- **Reproduced defects:** with a missing file, malformed JSON, wrong shape, a UTF-8 BOM, or
  invalid records, the server stayed up with `/api/health` → 200 and a console line only;
  invalid records produced `Required; Required; …` with no field names; a database failure
  printed a raw stack trace.
- **Human-approved policy (strict fail-fast):** exit non-zero with a clear message when the
  database cannot be opened/initialized, the seed file is missing/unreadable/malformed/the
  wrong shape/empty, any record is invalid or duplicated, any record fails to insert, or any
  seed id is absent after seeding (checked directly, not from counters). The whole file is
  validated before any write, so a bad file never leaves a half-seeded database. Messages
  carry paths, ids and field paths only (no bodies, no credentials) and no stack traces. A
  UTF-8 BOM is tolerated. Per-message normalization warnings (e.g. an ignored date) stay
  non-fatal and are stored with the email. The health contract is unchanged.
- **Alternative considered, not implemented:** a degraded mode that starts and reports
  `seed` status in `/api/health` (needs a shared API contract change that was not approved).
- **Trade-offs:** a single bad record in a user-edited seed file prevents startup; the
  operator must fix the file. `SEED_PATH` pointing at another file is held to the same rule.
- **Verification (executed):** 13 unit tests in `startup.test.ts`, plus real-process checks
  for seven failure modes (all exit code 1, no stack trace, no body leaked, server not
  reachable) and a valid start/restart (10 created, then 10 present; ids E001–E010;
  4 attachments preserved).

## Phase 2 records (LLM client, agents, orchestration)

All Phase 2 records are **contemporaneous** (written 2026-10-11 while implementing). Status is
**implemented within the authorized Phase 2 scope; awaiting independent review** unless a record
says otherwise. "Verification" names only what was actually executed: 244 deterministic tests in
15 files (all passing), plus the small live Groq run and real-process checks listed in
PROCESS.md. Alternatives were considered conceptually; **none was benchmarked**.

**Test provenance (stated once, applies to every record below):** every agent, validation,
orchestration, retry, recovery and health test uses a scripted `FakeLlm` or a scripted `fetch`;
**no automated test contacts a provider**. The only real provider traffic in all of Phase 2 was
one manual run of 6 calls with synthetic emails (7,007 tokens), recorded in PROCESS.md. After
the quality-gate round the suite is 292 tests in 16 files (the 244 quoted above were the count
before that round).

**Human approvals recorded (candidate, quality-gate instruction, 2026-10-11):** nullable
sender/subject with explicit missing headers (D23); `ANALYSIS_AUTOSTART=false` until an
explicit API-triggered flow exists (D26); health that distinguishes configured/valid
configuration from actual provider reachability (D28, D30). Findings F1 and F2 were raised by
the independent reviewer; their corrections are D29 and D30.

**Human-approved configuration (candidate, 2026-10-11):** Groq free tier; model
`openai/gpt-oss-120b`; OpenAI-compatible Chat Completions; JSON output validated with Zod;
configurable reasoning effort starting at `low`; one provider implementation with local Ollama
compatibility where practical; no automatic multi-provider fallback chain.

## D22. One OpenAI-compatible client with bounded retries and rate-limit handling

- **Context:** the free-tier provider is rate limited (a per-minute token budget of roughly 8,000
  tokens is *suggested* by response headers seen in the preflight; not verified against the
  provider's documentation) and reasoning models spend completion tokens on reasoning.
- **Selected:** a small `fetch`-based client (no SDK dependency). Transient failures (timeout,
  network error, 408/409/425, 429, 5xx) are retried at most `LLM_MAX_RETRIES` times with
  exponential backoff and jitter; `Retry-After` is honored when within a 20 s cap, otherwise the
  call fails immediately as `rate_limited`; 401/403 and 400 are not retried; the remaining-token
  and reset headers pause a call that would exceed the stated budget; `finish_reason: length`
  is detected so the budget can be raised once. Errors are sanitized and the key is redacted
  from any provider-echoed text.
- **Alternatives:** the earlier multi-provider fallback chain was rejected in Round 2 (D7).
  **(retrospective)** a vendor SDK (`groq-sdk`/`openai`): not evaluated; a plain client keeps
  the dependency list unchanged and makes the retry/redaction behaviour testable.
- **Trade-offs/limitations:** no streaming; pacing is a conservative estimate (prompt chars / 3 +
  `max_completion_tokens`) and can wait longer than needed. In the live run one call took about
  21 s of wall time for about 1 s of HTTP time; I attribute that to the pacing pause reaching its
  20 s cap, but the sleep itself was **not logged**, so this is an inference from timings, not
  a recorded observation. `reasoning_effort` is sent only when configured, and a provider that
  rejects it would need `LLM_REASONING_EFFORT=none`.
- **Verification (executed):** 26 client tests, all against a **scripted `fetch`** (no network):
  Retry-After, over-cap Retry-After, 5xx backoff, auth/400 non-retry, network, timeout, header
  pacing, malformed bodies, key redaction. Real provider traffic was limited to the single
  6-call live run (all HTTP 200, 1 attempt each, 7,007 tokens). Retry/429 behaviour was **never
  exercised against the real provider**; it is verified only against scripted responses.

## D23. Agent A grounding: model quotes, code locates and verifies

- **Context:** Freeze V1.1 requires evidence snippets with locations, traceable to the original.
- **Selected:** the model proposes quotes (`where` + text); code finds each quote in the matching
  source segment (whitespace/case tolerant, never different wording), computes exact offsets,
  and drops (and counts) anything not found. Header fields (sender, recipients, date, subject,
  missing headers) always come from the Phase 1 normalized email. Deterministic regex findings
  (amounts incl. K/M suffixes, account/routing numbers, invoice ids, URLs including defanged
  `hxxp`) are added by code regardless of the model, as separate `origin: "rules"` snippets
  (budget 12 rules + 12 model snippets <= 24). Model-reported amounts/references/dates/
  attachments are kept only when the original text supports them. The header "segment" is a
  canonical rendering of the parsed headers.
- **Alternatives:** asking the model for character offsets (rejected: models are unreliable at
  counting); verifying against raw email bytes (not applicable: Phase 1 already normalizes).
- **Contract adjustment (human-approved 2026-10-11):** `Extraction.sender` and
  `Extraction.subject` were non-nullable in the Phase 0 shared schema, which contradicts
  Phase 1's explicit-missing headers. They are now nullable and `missing_headers` was added to
  `Extraction`. I made this change during Phase 2 and flagged it; the candidate then approved
  "nullable sender/subject and explicit missing headers" in the Phase 2 quality-gate instruction.
- **Limitations:** a truthful date given in a normalized form (e.g. "2026-07-03" for "July 3") is
  dropped because it does not appear as written; attachments sharing a filename are located by
  the first match; the model sees at most 6,000 body characters and 3,000 per attachment (4
  attachments), noted in `notes` when applied (verification still uses the full text).
- **Verification (executed):** 19 Agent A tests, including exact-offset checks, fabricated
  quotes/amounts/references/dates, overriding headers, missing headers, snippet cap, repair,
  truncation, and delimiter/injection handling.

## D24. Agent B validation and the entity store

- **Context:** B must receive only A's validated output and produce grounded evidence,
  entities and relationships.
- **Selected:** B's prompt is built only from the validated `Extraction`. Output is checked
  against that extraction: evidence and relationship quotes must be substrings of the cited
  snippet; entities must appear in a snippet, sender/recipient, subject, or match a fact (amount
  value, account/routing number); duplicate refs, unknown types, unknown tags, and relationships
  with unknown endpoints are dropped and counted; unknown predicates become `related_to`;
  rationale > 500 is truncated; an invalid risk level is a hard failure that triggers one
  repair call.
- **Corrected after review (see D29):** the original implementation kept a non-`none`
  assessment with no surviving evidence and only flagged it in warnings, which let it reach
  `complete`. That was a reproduced defect and is no longer the behaviour: such a finding is
  now rejected, given one repair attempt, and otherwise withheld (`partial`).
- **Deferred (not a deviation from the freeze):** entities and relationships are stored inside
  the validated assessment JSON. Canonical keys, global entity de-duplication, and the
  `entities`/`entity_mentions`/`relationships` tables are Phase 3 per the freeze; those tables
  remain unused.
- **Limitations:** grounding is transitive (B is checked against A's snippets, not the raw
  email, as designed), so facts A failed to select cannot be cited; a model that follows an
  injected instruction *and* quotes real text is not detected here (see D27).
- **Verification (executed):** 14 Agent B tests (see PROCESS.md for the list).

## D25. Orchestration states, outcomes and persisted invariants

- **Selected:** per email, sequential A then B. Outcomes: `complete` (A and B validated; the only
  state with an assessment), `partial` (A validated, B failed: extraction kept), `degraded` (no
  validated A: no LLM configured, or A failed; code-only extraction labeled in `notes`,
  provenance `rules`, **no assessment**), `failed` (unexpected internal error). A stored live
  extraction is reused when B is retried. Every run is logged per stage (calls, error kind,
  token usage, latency, dropped items), keeping the last 10 runs. Writes are guarded by
  `assertAnalysisInvariants` (assessment only with `complete`; `complete` needs extraction and
  assessment; assessment requires live/recorded provenance); reads re-validate stored JSON and
  downgrade a "complete" whose data no longer matches the schema to `failed`.
- **Alternatives:** rules-only assessment in degraded mode (explicitly excluded until Phase 3
  by the candidate's scope); storing a provisional risk level (rejected: could be read as
  "assessed"). **Limitation:** `analysis_mode` mirrors the terminal status (the column exists
  from Phase 1 and was given this meaning); the `analyses` schema is unchanged.
- **Verification (executed):** 21 service tests + 5 storage tests: success, A provider failure,
  A garbage twice, B failure, B invalid twice, no LLM, internal error, retry-resume (A not
  repeated), invariant rejections, SQLite reopen round-trip, corruption downgrade.

## D26. In-process queue, restart recovery, and autostart off by default

- **Selected:** a FIFO queue with concurrency 1 (max 2), capacity 200, id de-duplication, and
  graceful stop. At boot, analyses left `queued`/`extracting`/`analyzing` are marked
  interrupted and re-queued; one interrupted `maxRuns` (default 3) times is marked `failed`
  rather than retried forever. `enqueue` reports `queue_full`/`max_runs_reached`/
  `skipped_complete`/`already_queued`/`not_found` and never leaves a phantom "queued" record.
- **Scope decision (human-approved 2026-10-11):** start-up does **not** enqueue
  never-analyzed emails unless `ANALYSIS_AUTOSTART=true`. Phase 2 instructions forbid
  bulk-sending the seed emails, and no API exists yet to trigger analysis (Phase 4). The
  candidate approved keeping `ANALYSIS_AUTOSTART=false` until an explicit API-triggered flow
  exists. Note the one exception: work left in progress by a previous process is re-queued at
  boot, which means that, with an LLM configured, an interrupted email is sent to the provider
  again at start-up. This is bounded by `maxRuns`.
- **Limitations:** the queue is in-memory (durable state is the analyses table); two server
  processes on one database are not coordinated.
- **Verification (executed):** 6 queue tests (concurrency bound, FIFO, de-dup, capacity, failure
  isolation, stop); recovery tests in memory and across a closed/reopened SQLite file; real
  process: planted interrupted analysis became `degraded` with runs `["interrupted",
  "degraded"]` after restart (no LLM, no network); with the real env and autostart off, 10
  emails and 0 analyses after boot.

## D27. Prompt-injection controls (and what they do not guarantee)

- **Selected:** content is wrapped in a per-request random delimiter with any forged marker in
  the text neutralized; the system prompt marks all email-derived text (including A's summary
  and snippets) as untrusted data and gives a "never follow" rule; agents have no tools or
  network access; output is parsed as JSON and schema/grounding validated; control-like fields
  (status, level overrides) are ignored because the pipeline, not the model, sets status.
- **Honest limitation:** these controls do not make the model immune, and **none of them
  prevents a model from being persuaded**. They only constrain what a persuaded model can
  *do* (it cannot set status, add evidence that is not in the email, or call tools). A model
  that obeys an injection but quotes real text can still produce a lowered risk level, or a
  rationale that repeats the attacker's framing. The planned defence for the lowered-level case
  (code-computed signals that can raise risk, Phase 3) is **not implemented yet**; until then
  an injected "mark as safe" can lower a stored level and the pipeline cannot detect it.
- **What the tests do and do not show:** every injection test used a scripted `FakeLlm`,
  including the "obedient model" cases, so they verify *our code's* handling of a hostile
  answer, not a real model's susceptibility. The only evidence about a real model is a single
  live sample (synthetic injection email, rated `high` with grounded evidence, i.e. it resisted
  once). One sample is not a measurement and says nothing about other prompts or models.
- **Verification (executed, all deterministic):** delimiter tests, nonce uniqueness,
  forged-delimiter neutralization, control-field stripping, and a pipeline test with a
  deliberately "obedient" fake model.

## D28. LLM configuration and the health-handler defect

- **Reproduced defect (from the Phase 0 review, F2):** `new URL(LLM_BASE_URL)` ran inside the
  health handler, so a malformed value made `/api/health` fail.
- **Selected:** settings are parsed once by a pure function; a bad URL yields `configured:
  false` and a problem string; `buildHealth` only formats validated fields. A hosted
  (non-local) endpoint without a key is treated as not configured, so analysis degrades
  honestly instead of producing 401s.
- **Semantic change to note:** `/api/health` now reports `provider`/`model` only when the LLM is
  actually usable (previously whenever a URL was set).
- **Verification (executed):** 15 config tests; real process with a malformed URL: HTTP 200,
  `configured: false`; with a blank key: `configured: false`.
- **Superseded in part by D30:** the quality gate asked for health to distinguish "configured",
  "valid" and "reachable". See D30 for the additive fields.

## D29. Evidence-quality invariant for risk findings

- **Review finding (quality gate F1):** can Agent B produce a non-`none` assessment with zero
  valid grounded evidence and still reach `complete`?
- **Reproduced defect (deterministic, scripted fake model, before the fix):** yes, in all 6
  combinations tried (`high`/`medium`/`low` x fabricated quote / empty evidence array) the run
  ended `complete` with an assessment of that level and 0 evidence items. The previous code
  only added a warning.
- **Human-approved correction:** a risk level above `none` must cite at least one quote that
  verifiably appears in the snippet it cites. Otherwise the answer is rejected as invalid, the
  model gets the normal single repair attempt (with the reason), and if it is still
  ungrounded the finding is **withheld**: stage `risk` fails with `error_kind:
  ungrounded_assessment`, the analysis ends `partial` (extraction kept, **no assessment**).
  `none` needs no evidence. The level is never changed to `none` and no evidence is invented.
- **What is preserved for review:** the stage log keeps the proposed level, confidence, allowed
  tags and counts as a sanitized sentence in `error_message`. The model's free-text rationale is
  deliberately **not** retained (it is the unverified part); keeping it would need a new
  persisted field, i.e. a shared-contract addition, which was not made. The existing
  write/read invariants are unchanged.
- **Trade-offs:** one extra provider call for each ungrounded answer; a correct-but-poorly-cited
  finding is withheld until a retry grounds it (an under-report, not a false "safe": a
  `partial` email is shown as unassessed); a model that cites real but irrelevant text passes
  this check (relevance is not verified).
- **Verification (executed, deterministic):** 24 regression tests: 17 at agent level (3 levels
  x 4 ways of being ungrounded = 12, plus repair-then-grounded succeeds, grounded high
  completes on the first call, partial evidence accepted with drops counted, `none` accepted,
  nothing returned on failure) and 7 at pipeline level (3 levels -> `partial` with the stage
  log entry, repaired -> `complete`, grounded -> `complete`, retry re-runs only B, `none`
  complete). One earlier test that asserted the old behaviour ("kept but flagged") was removed.
  Re-running the original reproduction script gives `status=partial assessment=null` for all
  six combinations. **No live provider call was made for this fix.**

## D30. Health: configured, valid, and observed reachability

- **Review finding (quality gate F2):** a valid configuration must not be described as a
  confirmed-reachable provider; health must not crash on malformed configuration; a health
  request must not call the provider; the response must stay backward compatible.
- **Inspection:** the Phase 2 handler already never called the provider and could not throw
  (settings are parsed once). But it also gave consumers no way to tell "configured" from
  "working", so `configured: true` was easy to over-read.
- **Human-approved decision:** health distinguishes configured/valid configuration from actual
  reachability.
- **Implemented (additive, optional fields; existing fields and meanings unchanged):**
  `llm.configured` stays "valid, usable configuration" (documented as *not* a reachability
  claim). New: `llm.reachability` = `unchecked | reachable | unreachable |
  credentials_rejected`, `llm.last_call_at`, `llm.last_error_kind`, `llm.problems`. These come
  from a small tracker fed by the client after each *real* analysis call; reading health only
  reads that cache. It stays `unchecked` until a real call happens, and is forced to
  `unchecked` when the configuration is unusable. Mapping: success -> reachable;
  network/timeout -> unreachable; 401/403 -> credentials_rejected; 429/4xx/5xx/bad body ->
  reachable (the endpoint answered; the kind is recorded).
- **Alternatives:** an active probe on each health request (rejected: sends traffic and spends
  quota on every poll); a separate `/api/health/llm` probe endpoint (not built; an explicit
  API belongs to Phase 4 and should be a deliberate action).
- **Limitations:** the status is only as fresh as the last real call and is per-process
  memory; "reachable" after a 5xx means "answered", not "healthy".
- **Verification (executed, deterministic):** 25 health/tracker tests, including a spy proving
  no `fetch` during health reads (also with a malformed URL), a stale-observation case,
  malformed URLs (4 variants), key never serialized, the extended payload parsing under the
  previous schema, and the client-to-tracker wiring (success, network, 401, final outcome only
  after retries).

## Phase 3 records (risk intelligence, cross-email enrichment, entity identity)

All Phase 3 records are **contemporaneous** (2026-10-11). Status: **implemented within the
authorized Phase 3 scope; awaiting independent review**. Test provenance: every Phase 3 test is
deterministic (no network, no provider); seed-based tests run the real Phase 1 ingestion and the
real Phase 3 code on the unmodified seed file, and AI assessments are built directly or by the
real orchestrator with a scripted fake model. The suite is now 424 tests in 21 files: 292 at
the end of Phase 2, +107 in the first Phase 3 pass, +25 in the targeted quality gate recorded
as D37. Alternatives below were considered conceptually; none was benchmarked.

**What was already approved (Freeze V1.1 / Round 3, and the Phase 3 instruction):** rules alone
never exceed `medium`; `high` requires a valid, grounded AI `high`; edit distance or URL
mismatch is an observation, not proof; vendor matches are `consistent` / `tentative` /
unknown and a tentative match is never claimed as confirmed; cross-email findings are derived
at read time, order-independent, and never re-run the LLM; no fuzzy person merging.

**Introduced in this phase:** (a) new shared types in `shared/src/risk.ts` (additive; no
existing contract changed); (b) `ORG_DOMAINS` configuration defaulting to `arcline.com`; (c) the
thresholds and phrase lists in D31/D33 (my judgment, not measured); (d) a `tampering`
indicator category; (e) the "several distinct threatening phrases is enough for `medium`" rule.
Items (b) to (e) and the single-indicator `low` floor were **human-approved with
qualifications on 2026-10-11**; the qualifications are recorded verbatim-in-substance in D37.

## D31. Deterministic observations and contextual indicators

- **Context:** the pipeline needs signals that do not depend on a model, are explainable, and
  cannot be switched off by text inside an email.
- **Selected:** `computeIndicators(email)` reads only the stored email text (headers, body,
  readable attachments). Two kinds, all evidence-linked (a located quote is mandatory; an
  indicator without one is dropped):
  - *Observations* (verifiable structure): a sender domain that resembles an organization domain
    (edit distance with a length-dependent limit, confusable characters, brand token with extra
    words, different TLD, subdomain trick); a link whose host resembles ours, uses punycode, or is
    a raw IP. An ordinary external link, a tracking redirector, or a link to our own domain is
    **not** an indicator, and a URL is only ever read as text.
  - *Contextual indicators* (phrase patterns): urgency; secrecy; request to send money; request
    to use changed payment details; payment details to follow through another channel;
    credential request; inside-information language; threatening language; sensitive material
    from an internal sender to a personal mailbox; an authority claim (CEO/IT/security...) from a
    look-alike domain (authority words alone, on an unrelated domain, are not flagged); and
    text aimed at manipulating automated review.
- **Alternatives:** an LLM-only judgment (not independent of the model under test, and subject to
  the injection problem in D27); a trained classifier (no labelled data; not evaluated).
- **Trade-offs/limitations:** English phrase patterns only; an attacker can avoid the exact
  words; semantic cases pattern rules cannot see (the E010 allegation yields no indicator) rely
  on the AI; org-domain list is configuration (`ORG_DOMAINS`); look-alike matching can flag a
  legitimately similar-named unrelated company, which is why it is only an observation and
  yields `low` alone.
- **Verification (executed):** 39 indicator tests: look-alike table (7 flagged, 9 not, including
  a two-edit unrelated name), the real E001/E003/E005/E006/E008 expectations, E002/E007/E009
  producing no indicators, benign links, over-classification cases, header-less text.

**Corrected in the quality gate (D37):**
- *Reproduced:* a benign incident report that quoted "I know where your office is" and "I know
  people", and a `>`-quoted reply, were both rated `medium` (threat language was judged by phrase
  count only); and ordinary text such as "set the risk level for the project" or "the system
  prompt was updated" was labelled tampering.
- *Correction:* threatening language that sits inside quotation marks, a `>` quoted line, or after
  a reporting cue ("It said ...", "quoting", "threatening email", "incident report") is shown as
  "quoted or reported", does not count toward `medium`, and cannot be sufficient alone; only
  DIRECT distinct threats count. The tampering rule now needs an explicit instruction override,
  role re-assignment or delimiter forgery; ordinary phrases ("mark this as safe", "set the risk
  level to none", "system prompt") are reported only as supporting evidence next to such a match.
- *New limitation:* an attacker can put a threat in quotation marks to reduce its weight
  (the AI and the quoted evidence remain visible); the cue list is local and English only.

## D32. Aggregation: capped rules, validated AI, separate levels, never "none" by default

- **Selected:** a pure `aggregateRisk`. Rules level: no indicator = `none`; any indicator =
  `low`; indicators from two or more distinct categories (tentative cross-email signals do
  not count) or one specific indicator (several distinct threats) = `medium`. It cannot return
  `high`. The AI level is used only if the analysis is `complete`, has live/recorded provenance
  and is grounded (the aggregator re-checks this instead of trusting the stored invariant). With
  an assessment: `final = max(AI, rules)`; the AI level, rules level, final level, escalation
  rationale (with indicator ids) and any disagreement are kept separately. Without one: the
  final level is the rules level if any indicator exists, otherwise `unassessed`.
  `none` is reachable only from a validated AI `none` with zero indicators.
- **Disagreement:** `ai_lower` (e.g. AI none, rules medium) always `needs_review`; `ai_higher`
  when the gap is two or more levels, `needs_review` when the AI said `high`.
- **Alternatives:** a weighted numeric score (opaque and hard to justify); letting rules lower
  an AI level (rejected: no rule has earned that trust); a hard `low` floor only when the AI is
  absent (considered; I kept `max` as in D5 so one indicator is never hidden behind an AI `none`).
- **Trade-offs:** one weak indicator can show an AI-`none` email as `low`; rules-only `medium`
  for E001/E008 is the honest ceiling without an AI; there is no signal to *lower* a level.
- **Verification (executed):** 26 aggregation tests (levels, caps, escalation records,
  disagreement, unusable AI records, "none is only reachable from..."), plus a mutation check:
  temporarily letting rules return `high`, reporting missing AI as `none`, or trusting an
  evidence-free finding made 2, 7 and 1 tests fail respectively; the file was restored and
  re-verified byte-identical.

## D33. Cross-email vendor enrichment (E004 / E009)

- **Selected:** at read time, for each email, read payment facts deterministically (vendor name
  from a document header such as "Northgate Suppliers Inc. Invoice #...", amount due, the account
  the document asks to pay, routing number, change-of-details language, with the account
  described as "previous" excluded) and compare them with *earlier-dated* emails. Ordering is by
  `(date, id)`; an undated email is not ordered and yields nothing. Identity ladder:
  `consistent` = same sender domain and same normalized vendor name; `tentative` = same domain
  with a missing/different name, or the same name from another domain; otherwise nothing is
  claimed. Findings: `payment_account_changed` (the document's account differs from earlier
  ones; records whether the routing number is unchanged and whether the message asks for the new
  details) and `invoice_amount_anomaly` (>= 2x the largest earlier amount from the same vendor).
  Each finding lists both email ids and quoted evidence from each email. Consistent findings
  count toward `medium`; tentative ones are shown but excluded from the medium count. Nothing is
  stored and the AI record is untouched.
- **Result on the seed data:** E004 gets both findings against E009 (account 6621 -> 9902, amount
  $13,900 -> $47,300, ratio 3.4, routing number unchanged, identity consistent); E009 gets none;
  ingestion order does not matter; adding the baseline later makes the finding appear.
- **Alternatives:** LLM cross-email reasoning (excluded in the freeze); storing findings and
  re-evaluating on arrival (rejected in Round 2: staleness/ordering).
- **Limitations:** regex over invoice-like text (other layouts are missed); "consistent" means
  the *claimed* identity matches, not that the sender is authentic (a compromised mailbox looks
  consistent); a changed account can be legitimate; legal-suffix differences are ignored in
  names; multiple distinct accounts in one document are treated as ambiguous and nothing is
  claimed; the 2x threshold is my judgment; O(n^2) at read time (fine for tens of emails).
- **Verification (executed):** 17 cross-email tests (see PROCESS.md).

**Quality-gate additions (D37):** the 2x rule is documented in the finding itself as a size
heuristic ("not evidence of fraud: a larger invoice can be legitimate"; `values.heuristic: true`).
It yields `low` alone; it is an `observation`, so it reaches `medium` only together with another
category (for example a consistent account change). Its evidence is the exact quoted amount lines
from both emails. Known gap, not changed: the ratio has no minimum amount, so a $5 -> $11 invoice
produces a (low) finding.

## D34. Entity identity keys and relationship aggregation (graph foundation)

- **Selected (as corrected in the quality gate, D37):** `buildEntityGraph(analyses)`, derived at
  read time, not persisted. Person: merged across emails ONLY on an identical e-mail address that
  the email itself contains (its headers or its evidence text). A name is never an identifier,
  and an address the model asserts but the email does not contain is ignored; without a verified
  address a person stays scoped to the one email. An AI-named person that exactly equals a
  header display name in the same email takes that header's address (unless two addresses share
  the name). *My first version also merged identical full names; that was a reproduced defect
  (two different people named "Jane Roe" became one node) and was removed.* Organization: normalized
  name without legal suffix. Account: number plus owning organization (from a validated
  `owns_account` relationship), otherwise scoped to the email. Amounts and unknown cases are
  never merged. Each entity keeps `origin` (`ai`/`rules`), every mention with its source email,
  and relationships aggregate by (source, predicate, target) with a count, email ids and the
  verified quote per email. Only complete, validated assessments contribute AI entities and
  relationships; rule-derived people (header addresses) are marked `rules`.
- **Alternatives:** fuzzy/phonetic or edit-distance name matching (rejected: a false merge
  asserts something untrue); persisting into the Phase 1 entity tables (deferred: derived data
  needs no migration and cannot go stale).
- **Limitations:** the same person without a shared verified address (J. Harrington / James
  Harrington, or the same name in two emails) produces separate nodes, which understates links;
  an unowned account cannot link across emails, so a bank-account link needs the model to emit
  `owns_account`; the graph is only as good as Agent B's entities.
- **Verification (executed):** 18 entity tests (address-only merging, identical full names NOT
  merged, unverified model addresses ignored, address found in evidence text, initials and single
  names, owner-scoped accounts, amounts, provenance/origin, ambiguity, aggregation, determinism
  under reordering).

## D35. Security regression at the aggregation boundary (and its limits)

- **Selected tests:** instructions in an email cannot remove or reduce any indicator (the same
  indicators are present with and without an injected suffix, and the injection is itself
  reported as an indicator); an obedient model returning `none` cannot override validated
  medium indicators, shown both with a hand-built record and through the real orchestrator; an
  evidence-free positive claim is not trusted as assessed; every indicator carries evidence;
  hostile text is never executed or fetched and a large adversarial body is processed well
  inside a time bound.
- **What this does NOT show:** immunity to prompt injection. The deterministic layer cannot be
  switched off by text, but (1) an attacker can phrase a request to avoid the exact patterns, so
  a *missing* indicator is not evidence of safety; (2) a model that is persuaded still writes
  the stored rationale and level, which the aggregator can raise but never rewrites; (3) all
  injection tests used scripted models, not a real model.
- **Verification (executed):** 9 pipeline/security tests plus the aggregation tests above.

## D36. Assumptions introduced in Phase 3

- The organization's domain is `arcline.com` (from the brief's fictional organization name),
  configurable through `ORG_DOMAINS`. Look-alike detection is meaningless without it.
- English-language phrase patterns, written against the seed data and general knowledge of
  business-email-compromise wording; they are not a validated corpus.
- Thresholds: two distinct indicator categories for `medium`; invoice amount at least 2x the
  largest earlier invoice; at least two distinct threatening phrases to be sufficient alone.
- Emails with no usable date cannot be compared chronologically and produce no cross-email finding.
- Housekeeping: the three `.gitkeep` files in now-populated directories were removed
  (`agents/prompts`, `analysis`, `__tests__/fakes`).

## D37. Phase 3 targeted quality gate: approvals, reproduced defects, corrections

**Human-approved judgment decisions (candidate, 2026-10-11), with the qualifications given:**

1. `ORG_DOMAINS=arcline.com` is approved as a **configurable assumption, not verified
   organizational ownership**. Look-alike results are observations relative to that setting.
2. Several threat phrases may support `medium` **only when their context is actually
   threatening**. (Implemented as the quote/report context rule in D31.)
3. The 2x invoice threshold is approved as an **anomaly heuristic, not evidence of fraud by
   itself**. (The finding text and `values.heuristic` say so.)
4. A grounded rule indicator may raise an AI-`none` assessment to `low`, **with visible
   disagreement**. (Unchanged from D32; the disagreement record is always produced.)
5. The `tampering` category **requires explicit, source-grounded evidence and must not label
   ordinary unusual text as tampering**. (Implemented as the stricter rule in D31.)

**Reproduced before changing anything (synthetic inputs, real code path):**

| Check | Before | After |
|---|---|---|
| A. incident report quoting "I know where your office is / I know people" | `medium` | `low`, shown as "quoted or reported" |
| A. `>`-quoted reply with the same phrases | `medium` | `low` |
| A. genuine direct threat (control) | `medium` | `medium` (unchanged) |
| B. two emails mentioning "Jane Roe", no verified address | merged into one node | two email-scoped nodes |
| B. model-asserted address that is in neither email | merged two people across emails | ignored; not merged |
| C. "set the risk level for the project" / "system prompt was updated" | flagged tampering | not flagged |
| C. explicit "ignore all previous instructions" (control) | flagged | flagged |
| C. $5 -> $11 invoice | `low` finding, no caveat | `low`, text says it is a heuristic |

**Corrections (smallest within the existing architecture; no schema or contract change):**
context test for threats in `risk/evidence.ts` + indicator rule; tampering patterns split into
explicit vs corroborating in `risk/lexicon.ts`; person identity reduced to verified addresses in
`risk/entities.ts` (plus verification that an address appears in the same email); heuristic
caveat in `risk/riskView.ts`/`risk/vendor.ts`.

**Verification (executed):** 25 new tests (424 total); the reproduction script re-run; and a
temporary mutation check: ignoring quote/report context made 3 tests fail, restoring name-based
person identity 3, trusting an unverified model address 1, and counting ordinary phrases as
tampering 3; files restored byte-identical. Evidence integrity is now asserted directly: every
indicator and finding quote equals the slice of its own email at the recorded offsets (checked
across the whole seed), and no generated explanation uses "confirmed", "proven" or "fraudulent".

**Remaining limitations:** rephrased or quoted-to-evade threats are weighted down; quotation
cues are English and local; the 2x rule has no minimum amount; people sharing no verified address
are never linked, so the graph can understate real connections; phrase lists remain unvalidated
on real mail.

## Phase 4 records (REST API)

All Phase 4 records are **contemporaneous** (2026-10-11). Status: **implemented within the
authorized Phase 4 scope; awaiting independent review**. Test provenance: every Phase 4 test
starts the real Express app on an ephemeral loopback port with the real repository and a
scripted `FakeLlm` (or none), and talks to it over real HTTP; no automated test contacts a
provider. The suite is 514 tests in 27 files (90 new). Alternatives were considered
conceptually; none was benchmarked.

**Needs your decision (flagged, not assumed approved):** (a) the new `multer` dependency (D42);
(b) the change to start-up recovery behaviour (D41, which supersedes the boot wording in D26);
(c) analysis is started only by an explicit request (`analyze: true` or `POST .../reprocess`),
never by ingestion alone (D39/D40); (d) 409 rather than 202 for "already processing" and for
"already complete" without `force` (D40); (e) `GET /api/graph` omits amounts by default (D44);
(f) the additive response types in `shared/src/mailboxApi.ts`.

## D38. API layering: a thin HTTP layer over the existing modules

- **Selected:** `createApp(deps)` builds the Express app from injected dependencies (repository,
  analysis service, config values). Routes parse and validate input, call existing ingestion,
  orchestration, risk and entity modules, and shape the response. Read-side composition lives in
  `api/views.ts` as plain functions of stored data. The server entry point only wires real
  dependencies and starts listening. Response contracts are types in
  `shared/src/mailboxApi.ts`.
- **Alternatives:** business logic inside route handlers (rejected: untestable without HTTP and
  duplicates Phase 1-3 rules); a controller/service class hierarchy (more structure than a
  six-route API needs); OpenAPI-generated or RPC-style contracts (extra tooling; not evaluated).
- **Trade-offs:** the list endpoint computes risk for every email on every call (O(n^2) from the
  Phase 3 cross-email step) and the detail endpoint rebuilds the entity graph; fine for tens of
  emails, not for thousands, and there is no pagination beyond `limit`.
- **Verification (executed):** all 90 API tests run against the real routes and repository;
  the full earlier suite (424 tests) passes unchanged.

## D39. Mailbox and ingestion endpoints

- **Selected:**
  - `GET /api/emails`: newest first (`order=asc` supported), filters `q` (subject/sender/body,
    case-insensitive), `risk` (`none|low|medium|high|unassessed`, comma list), `status`
    (`not_started` plus the analysis states), `limit` 1-500. Each item carries sender, subject,
    date, processing state (with provenance and `in_progress`) and a risk summary whose
    `final_level` can be `unassessed`, which is distinct from `none`.
  - `GET /api/emails/:id`: original content and attachments, extraction, the validated assessment
    (only when `complete`), the risk view (indicators, cross-email findings, escalations,
    disagreement), and this email's entities and relationships. It omits raw source text, content
    hash and prompts. A missing or malformed id is a uniform 404.
  - `POST /api/emails`: JSON `{ raw_text }` or multipart `file` (TXT/EML/PDF), through the Phase 1
    ingestion unchanged (same limits and error codes). 201 stored, 200 identical content already
    stored (returns the existing id, `created: false`), 202 when `analyze: true` was also
    accepted. No analysis runs unless asked.
- **Alternatives:** separate endpoints per source type (more surface, same behaviour);
  automatically analyzing on ingestion (rejected: it sends content to a provider as a side
  effect of storing it, against the "no silent provider requests" requirement).
- **Limitations:** search is a substring match, not ranked; the list is not paginated by cursor.

## D40. Explicit processing control and polling

- **Selected:** `POST /api/emails/:id/reprocess` calls the existing bounded queue. 202 when
  accepted; 409 `already_processing` if it is already queued or running (so a double click never
  creates two concurrent jobs); 409 `already_complete` and 409 `max_runs_reached` unless
  `?force=true`; 503 `queue_full` with `Retry-After`; 404 for an unknown email. Clients poll
  `GET /api/emails/:id` (or the list): `processing.status` and `processing.in_progress` expose
  `queued/extracting/analyzing/complete/partial/degraded/failed`. A validated extraction from a
  previous attempt is kept and reused when only Agent B must be retried.
- **Alternatives:** WebSockets/SSE (excluded by the brief's scope and the instruction); returning
  202 for "already processing" (idempotent and friendly, but it hides that no new job was
  created, so I chose 409); making `reprocess` always force (would let a repeated click re-send
  content to the provider).
- **Limitations:** polling latency; the in-memory queue is lost on restart (durable state is the
  analyses table); two server processes on one database are not coordinated.
- **Verification (executed):** gated-model tests observe `extracting` mid-run and then
  `complete`; concurrent request -> 409 with exactly one A and one B call; force re-run; Agent A
  failure -> degraded; Agent B failure -> partial then retry runs only B; ungrounded finding ->
  partial; no LLM -> degraded; `maxRuns`; queue full leaves no phantom "queued" record.

## D41. Start-up recovery: when an interrupted job may call the provider (changes D26)

- **Problem:** Phase 2 re-queued interrupted analyses at every boot, so a restart could send an
  email to the provider again without anyone asking. That conflicts with "do not silently trigger
  external provider requests merely because a reviewer opened the mailbox".
- **Selected:** `recoverInterrupted({ run })`. At boot, interrupted analyses are always marked
  `interrupted` and normalized to `queued` (nothing looks "in progress", nothing looks safe).
  They are handed to the worker, and therefore may trigger a provider call, **only** when
  `ANALYSIS_AUTOSTART=true`. Otherwise they wait until `POST /api/emails/:id/reprocess`.
  `bootstrapAnalysis` returns `externalCallsMayStart`, true only with autostart on, an LLM
  configured and work present. A job interrupted `maxRuns` times is marked `failed` either way.
- **So an external call can start from exactly three things:** autostart at boot, an explicit
  reprocess request, or `analyze: true` on ingestion. Reading (list, detail, graph, health) never can.
- **Alternatives:** keep re-queuing at boot (rejected, above); never recover and leave rows in
  `extracting` (rejected: misleading state); mark them `failed` (rejected: loses a retriable result).
- **Deviation:** this changes the behaviour I recorded in D26 and is **flagged for approval**.
  The Phase 2 default (`run: true`) is retained for direct callers so existing tests are unchanged.
- **Verification (executed):** with a real SQLite file across a simulated restart: autostart off
  -> status `queued`, run marked interrupted, 0 provider calls even after reads, then an explicit
  reprocess completes with 2 calls; autostart on -> submitted, `externalCallsMayStart: true`;
  autostart on with no LLM -> degraded, `externalCallsMayStart: false`; repeated interruption ->
  `failed`, 0 calls either way; a second restart is idempotent.

## D42. Multipart uploads with `multer`

- **Selected:** `multer` 2.4.0 with memory storage, one `file` field, `fileSize` equal to the
  Phase 1 upload limit (inclusive), and bounded field/part counts. Three new transitive packages
  (`append-field`, `busboy`, `streamsearch`; `type-is` was already present through Express), plus
  the `@types/multer` dev dependency; `npm audit` reported 0 findings.
- **Alternatives:** `busboy` directly (lower level, more code to get error handling right);
  accepting a raw body with the filename in a header (not what a browser form sends). Neither was
  trialled. A hand-written multipart parser was rejected as an avoidable security risk.
- **Limitations:** the whole file is buffered in memory (capped at 5 MB by default).
- **Flagged:** a new runtime dependency; please confirm.

## D43. Cross-origin and transport safeguards

- **Selected:** a small allow-list CORS middleware (exact origins from `CORS_ORIGIN`, default
  the Vite dev origin); no wildcard; no credentials; preflight answered with 204 for any origin
  but granted only to allowed ones; requests without an `Origin` header are untouched. Every
  response carries `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`; the framework
  header is removed. The server still binds `127.0.0.1` by default. No authentication (excluded
  by the brief).
- **Alternatives:** the `cors` package (another dependency for ~20 lines); reflecting any origin
  (rejected).
- **Limitations:** CORS is a browser control only; anything on the machine can still call the
  API directly, which is why loopback binding matters.

## D44. Graph API

- **Selected:** `GET /api/graph` returns `{ nodes, edges, meta }` built from Phase 3
  `buildEntityGraph`: node identity key, type, label, origin (`ai`/`rules`), key basis, source
  email ids, mention count, and `max_risk` (highest source level; a node seen only in unassessed
  emails is `unassessed`, never `none`); edges carry predicate, supporting email ids, count and
  the verified quotes. Amount nodes (and their edges) are omitted unless `include_amounts=true`.
  The response is sorted and byte-identical for identical data; people are linked only by a
  verified address, so no edge is invented for an unverified identity.
- **Alternatives:** returning every entity including amounts (noisy; kept behind a flag);
  persisting the graph (rejected: derived data that would go stale).
- **Limitations:** quality depends on Agent B; people without a shared verified address are not
  linked; the default amount omission is a presentation choice to confirm.
- **Verification (executed):** 8 graph tests (cross-email organization and account nodes,
  separate new-account node, deterministic bytes across ingestion order, amount handling, no
  dangling edges, same-name people not merged, rule-derived people labelled, empty mailbox).

## D45. Error contract and information hygiene

- **Selected:** every error is `{ error: { code, message } }` with a stable `code`. Ingestion
  codes map to HTTP status (400 empty/invalid, 413 too large, 415 type, 422 unreadable
  PDF/EML/scan); body-parser and multer failures are mapped; anything unexpected is a generic
  500 and only the error's NAME is logged (never its message or stack). Responses never include
  credentials, prompts, raw sources, or stack traces; text from an email is only ever returned
  as a JSON string value.
- **Alternatives:** returning the underlying error message (rejected: leaks paths and content).
- **Verification (executed):** 10 security tests: CORS allow/deny/preflight/none configured; the
  API key (placed in the settings object on purpose) absent from every body, header and log; prompt
  and internal field names absent after a full analysis; a repository that throws a message
  containing the key and a path yields a generic 500 and a name-only log; headers on every response.
- **Found by a real-server check:** the unknown-endpoint message initially dropped the `/api`
  prefix; fixed and asserted.

## Minor choices (grouped, not independently evaluated)

Express 4, React 18, Vite 6, zod 3, `concurrently`, Node's built-in env-file loading, a
root-level `.env`, plain CSS variables file as the styling start. These were picked by
Claude as known-compatible versions/defaults; newer majors were **not** compared or tested.
Status: part of the approved Phase 0 scaffold, low-risk and reversible.

Phase 1 additions of the same kind: `vitest` as the test runner. The three `.gitkeep` files
in directories that became populated were removed in the corrective round (review finding
F4, human-approved); `.gitkeep` files in still-empty directories remain.
