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

## Minor choices (grouped, not independently evaluated)

Express 4, React 18, Vite 6, zod 3, `concurrently`, Node's built-in env-file loading, a
root-level `.env`, plain CSS variables file as the styling start. These were picked by
Claude as known-compatible versions/defaults; newer majors were **not** compared or tested.
Status: part of the approved Phase 0 scaffold, low-risk and reversible.

Phase 1 additions of the same kind: `vitest` as the test runner. The three `.gitkeep` files
in directories that became populated were removed in the corrective round (review finding
F4, human-approved); `.gitkeep` files in still-empty directories remain.
