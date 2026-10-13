# Mail Risk Intelligence — Engineering Delivery & Acceptance Report

This report answers one question: **was the agreed assignment scope delivered, how was it
engineered, and what objective evidence supports acceptance?**

It is also the `PROCESS.md` deliverable of [`candidate_task_brief.md`](candidate_task_brief.md):
section 3 describes the AI-assisted workflow the brief asks about (planning and prompting approach,
where the agent ran on its own, where the candidate stepped in, how the work was divided).

The complete dated record behind this report — every prompt summary, agent result, correction and
validation run, in order — is preserved unchanged in
[`docs/PROCESS_HISTORY.md`](docs/PROCESS_HISTORY.md). References elsewhere in this repository to
"Phase N" records point to that chronology.

## 1. Engineering Delivery Summary

**Delivered.** A full-stack application that ingests emails and attachments, runs two chained LLM
agents (extraction, then risk and graph), persists the results, and presents an evidence-first
investigation interface with a cross-email knowledge graph. It starts with `npm ci && npm run dev`
and needs no API key.

| Scope in the brief | Result |
|---|---|
| Mailbox: seeded list; add by paste or `.txt` / `.eml` / `.pdf` upload through the same pipeline | Delivered |
| Agent A (structured extraction) chained into Agent B (risk level, rationale, tags, entities, relationships) | Delivered |
| Free-tier or local LLM, documented; runs without a paid key | Delivered (Groq free tier; a no-key replay mode is included) |
| Unhappy path: model call fails, times out or returns garbage | Delivered |
| Persistence of processed emails, entities and relationships | Delivered (SQLite) |
| UI: inbox with risk badge, detail view, entities and relationships panel, narrow viewport | Delivered |
| Bonus: interactive cross-email knowledge graph | Delivered |
| React + TypeScript, Node/Express, `.env.example`, documented fallback, tests | Delivered |
| `README.md`, `PROCESS.md` | Delivered |
| Optional: screen recording | Completed; published as a Release asset, delivery to the interviewer pending (section 6) |

**Acceptance position.** Every functional requirement of the brief is implemented and exercised by
the project's automated tests or by recorded real-browser checks. The findings of three independent
audit reports were addressed and reconciled; the audit ledger records **no open requirement**. The
evidence supports accepting the assignment scope as delivered. It does not certify production
readiness, detection accuracy or behaviour on physical mobile devices, none of which the brief
requires; section 7 states those boundaries.

In this report, *author-run* means executed inside the project by the AI agent under the candidate's
direction; *independent* means executed or inspected by a separate auditor.

**The evidence in numbers** (each is traced in sections 5, 6 and 8):

- 18 commits from 11 to 13 October 2026 up to `35237a2`, the commit this report was prepared
  against; application source unchanged since the audit-remediation commit `ea6c588`.
- 62 test files and 982 tests (server 38 / 701, web 24 / 281), all passing with clean type checks in
  an author-run execution for this report on 13 October 2026 at commit `35237a2`.
- 108 decision records with alternatives, trade-offs and verification
  ([`docs/DECISIONS.md`](docs/DECISIONS.md)).
- 71 independent audit findings, each with a recorded disposition
  ([`docs/AUDIT_CLOSURE.md`](docs/AUDIT_CLOSURE.md)).
- 24 brief requirements traced to code, tests and limits
  ([`docs/REQUIREMENTS_TRACEABILITY.md`](docs/REQUIREMENTS_TRACEABILITY.md)).

## 2. System Architecture & Design Rationale

```
shared/        API types and zod schemas used by both sides
server/src/
  ingestion/   parse and normalize (text, .eml, .pdf, seed) into one NormalizedEmail
  agents/      Agent A (extraction), Agent B (risk and graph), prompts, bounded JSON repair
  analysis/    orchestration, bounded queue, restart recovery, rules-only automatic checks
  risk/        deterministic indicators, aggregation, cross-email checks, entity identity
  llm/         one OpenAI-compatible client, configuration, observed-status tracking
  replay/      recorded-analysis client and the operator-run recorder
  storage/     repository interface with SQLite and in-memory implementations
  api/         thin Express layer, origin guard, error contract
web/src/       React application: inbox, investigation view, knowledge graph
```

The layers map directly onto the separation the brief evaluates: ingestion, agent orchestration,
storage, API and UI. Seven HTTP routes expose them (health, list, detail, add, analyse, automatic
checks, graph).

**Pipeline.** An email is normalized and stored. Agent A receives it as delimited, untrusted text
and returns JSON; code locates each quoted snippet in the original and drops what it cannot find.
Agent B receives only Agent A's validated output and returns the risk assessment, entities and
relationships. The outcome is stored as `complete`, `partial` (Agent A only), `degraded` (code-only
extraction) or `failed`. Deterministic indicators and cross-email findings are combined with the AI
result when a message is read.

**Decisions that shaped the system**

| Decision | Rationale | Alternative considered | Record |
|---|---|---|---|
| Evidence-snippet chain: the model quotes, code locates and verifies the position | A highlight is shown only where its position is proven; an AI risk level above "none" must cite a verifiable quote or it is withheld | Grounding Agent B directly against the raw text | D3, D23, D29 |
| "None" only from a validated AI assessment; rule-based signals capped at medium | An unassessed message is never presented as safe, and rules alone cannot produce a high verdict | Rules-only analysis as a peer of AI analysis (the first design) | D4, D5, D32 |
| Agent B sees only Agent A's validated output | Keeps the chain the brief specifies and a simple contract for Agent B | Feeding code-computed signals into Agent B (the first design) | D3, D24 |
| Cross-email findings and the graph derived at read time | No stored copy to go stale or depend on processing order; acceptable cost at this data size | A stored post-processing step with re-evaluation | D6, D11, D34 |
| One OpenAI-compatible client with bounded retries; one deadline for connect, headers and body; response size cap | Simple and fully testable with scripted responses; a stalled provider cannot hold the single worker | A multi-provider failover chain; a second provider API | D7, D22, D102, D106 |
| Recorded analyses replayed at the client boundary | The reviewer sees genuine two-agent output without a key, passing through the same validation as a live call | Hand-authored expected outputs; inserting stored assessments directly; a pre-analysed seed database | D8, D59–D68 |
| Rules-only route built without any LLM client | Safe to offer in every configuration; no path to a provider by construction | A flag on the analysis route | D79 |
| State-changing requests authorized by origin before any side effect | The brief excludes accounts; this removes the browser-mediated attack on an unauthenticated local API | A custom header or CSRF token; JSON-only bodies | D92 |
| SQLite behind a repository interface with an in-memory twin | Durable locally, no provisioning, fast deterministic tests | A JSON file store | D2, D17 |
| Graph drawn as HTML cards over an SVG relationship layer with a deterministic layout | Crisp text, keyboard focus and testable geometry without a graph dependency | Graph and canvas libraries | D69, D85, D86 |
| CSS Modules with a design-token file; no UI library | Scoped styles with no runtime cost and no added dependency | A component library | D46, README |

**What the code establishes and what remains the model's judgement.** That a quote appears in the
message at a given position is proven by exact match. That a relationship type fits the entity kinds
it connects is checked structurally. Whether a quote *means* what the model says, and whether a risk
level is right, is asserted by the model and is neither verified by code nor scored for accuracy; a
read-time advisory ("Check this quote") flags weak support without removing anything. The full
table is in the [README](README.md#what-is-verified-and-what-is-not).

## 3. Engineering Ownership & Execution Strategy

**Responsibilities, as the records show them**

| Party | Responsibility |
|---|---|
| The candidate | Set the phases and their scope; approved the architecture freeze; approved or rejected individual decisions; relayed independent review findings; chose the visual direction; supplied the provider key and controlled the recording runs; authorized every commit, push and release; decided what to defer |
| Claude Code (AI coding agent) | Analysis, design proposals, implementation, tests, validation runs and documentation inside each authorized phase |
| Independent AI reviewers | Phase reviews during the build and three audit reports afterwards; their findings reached the agent through the candidate |

The application code, tests and documentation were written by the agent under the candidate's
direction. This report makes no claim of manual authorship. The underlying record is the agent's own
log, kept under written rules ([`CLAUDE.md`](CLAUDE.md)): no implementation outside an authorized
phase, a decision record for every significant choice, no claim of a passing test that was not
executed, and nothing committed without explicit authorization.

**Planning before code.** Three planning rounds preceded any implementation:

1. An independent analysis of the brief and the seed data: a requirements matrix (explicit,
   assumption, optional), a seed audit identifying which of the ten emails carry which risk, and
   architecture options with a recommendation.
2. A cross-review of four concerns raised by a second reviewer (LLM versus rules fallback, false
   positives in risk aggregation, cross-email consistency, security boundaries), with the instruction
   not to agree merely for consensus.
3. Four mandatory corrections, after which the candidate approved the architecture freeze.

These rounds changed the design materially: rules-only analysis stopped being a peer of AI analysis,
Agent B's input was reduced to Agent A's validated output, evidence grounding and the
genuine-recordings-only rule were added, PDF ingestion became mandatory, and rule-based signals were
capped at medium.

**Prompting approach.** Each phase was started by a prompt that stated its scope, its explicit
exclusions and the evidence required at the end. A representative instruction, summarised from the
record: *"Implement Phase 1 only: SQLite persistence behind a repository, idempotent seeding of all
ten emails, a normalized ingestion pipeline for seed, paste, TXT, EML and text PDF, upload safety,
deterministic tests; no agents, risk engine, graph, commit or push."* Every phase ended with a report
of what was implemented, what was executed, what was not verified, and the repository state.

**Division of the work.** The work was divided into sequential phases, each a reviewable unit:
scaffold; storage and ingestion; LLM client, agents and orchestration; risk intelligence and
cross-email checks; REST API; frontend; recorded replay; knowledge graph (including a read-only
audit, a design review and a security-hardening step); documentation and handoff; audit remediation.
The records show no use of parallel sub-agents.

**Where the agent ran autonomously.** Inside an authorized phase the agent designed the modules,
wrote the code and tests, ran type checks, test suites, builds and real-process or real-browser
checks, and corrected what its own runs exposed — for example a database handle left open on an
initialization failure, found by its first test run, and several tests that could not fail, found by
its own mutation checks.

**Where the candidate stepped in**

| Point | Intervention | Effect |
|---|---|---|
| Planning | Put four independent-review concerns to the agent, then required four corrections before approving the freeze | Rules-only analysis is no longer a peer of AI analysis; four explicit outcome states; "none" only from validated AI |
| Scaffold | Approved three deviations and required three review findings fixed before the scaffold was committed | Database path, proxy port and loopback binding corrected |
| Ingestion review | Decided seed-scoped hashing, fail-fast start-up and "never invent a date" | A defective seed file stops start-up with a clear message instead of serving a partial mailbox |
| Agents | Approved the provider, the model and a single-client design; at the quality gate, authorized the reviewer's evidence finding to be fixed | An ungrounded assessment is withheld and the analysis is stored as `partial` |
| Risk engine | Approved five judgment calls with qualifications and requested three targeted checks | Threat context, entity identity and rule evidence re-examined before commit |
| Knowledge graph | Requested a read-only audit and a design review, then supplied a visual reference | The graph was redesigned around relationships and evidence; a security defect was found and fixed |
| Audit remediation | Required every audit finding to be reproduced against the current source before any fix | No finding was accepted on trust; regression tests were added with each fix |
| Submission | Set the wording of the time estimate, the storytelling rule for the demo video and the delivery steps | Documentation and video reflect the candidate's decisions |

## 4. Implementation & Technical Milestones

| Milestone | Commit | Date | What it delivered | Tests passing at the gate |
|---|---|---|---|---|
| Scaffold and governance | `9631fa6` | 11 Oct | Workspaces, shared schemas, health endpoint, loopback binding | none yet |
| Storage and ingestion | `78ce39b` | 11 Oct | SQLite repository, idempotent seeding, text / EML / PDF parsing, upload safety, strict start-up | 138 |
| Two-agent pipeline | `4b79cdc` | 11 Oct | LLM client, Agent A and Agent B with grounding and repair, orchestration states, health reporting | 292 |
| Risk intelligence | `00ddf8a` | 11 Oct | Deterministic indicators, aggregation, cross-email vendor comparison, entity identity | 424 |
| REST API | `5eec050` | 11 Oct | Mailbox, ingestion, analysis control, graph endpoints, error contract | 514 |
| Investigation interface | `0988ea4`, `f3065ff` | 11 Oct | Inbox, evidence-first detail view, responsive master–detail layout | server 514, web 68 |
| Recorded replay | `2f1a3c4` to `a38b31c` | 11 Oct | Replay infrastructure and three genuine recordings (high, medium and benign cases) | server 559, web 75 |
| Knowledge graph and security hardening | `9a6dc20` | 11 Oct | Interactive graph, rules-only automatic checks, origin guard | server 600, web 224 |
| Reviewer documentation | `633ddd1` | 11 Oct | README, requirements traceability, screenshots, documentation tests | 31 server and 22 web test files, run from a fresh clone |
| Audit remediation | `ea6c588` | 12 Oct | Deadline and cancellation, relationship and identity rules, stored-data robustness, audit ledger | server 701, web 281 |
| Submission documentation and demo | `48cf19f` to `35237a2` | 12–13 Oct | Installation notes, demo video and Release, final documentation | server 701, web 281 |

Counts are the author's executions recorded at each gate. No application source file changed after
`ea6c588`; the later commits are documentation only.

## 5. Quality Gates & Independent Verification

**The gate applied to every phase:** author validation (type checks, test suites, build, and where
relevant a real server process or a real browser) → independent review → reproduction of each finding
→ correction → regression test → commit on the candidate's authorization.

**Closed engineering feedback loops.** The cases below are representative; the ledger and the
decision records hold the rest.

| Discovery | Root cause | Correction | Regression verification |
|---|---|---|---|
| Phase review: a risk level with fabricated or missing evidence was stored as a complete assessment | Validation only added a warning | A level above "none" must cite a verifiable quote; one repair attempt, then the finding is withheld and the analysis is `partial` (D29) | Scripted-model tests in six combinations; all now end `partial` with no assessment |
| Phase review: a duplicate paste could leave a seed email missing, and a malformed seed file left the server running with a partial mailbox | Duplicates counted as existing; no start-up validation | Seed-scoped hashing; whole-file validation and fail-fast start-up (D18, D21) | Start-up test suite; seven failure modes exercised against a real process, each exiting with a clear message |
| Read-only audit: a page on another origin could start AI work with a simple cross-origin POST | CORS withholds the response but does not stop the request | Origin guard mounted before the body parser and every route (D92) | Origin tests; ten of ten deliberate mutations caught; a real attack page in a browser received four refusals and produced zero provider requests |
| Independent audit: a stalled response body held the single worker indefinitely | The abort timer was cleared when headers arrived | One deadline for connect, headers and body, a size cap, non-blocking clean-up (D102, D106) | Deadline and cancellation tests that hang on the earlier code; independently executed by the closure audit |
| Independent audit: any relationship type was accepted if its quote existed | Only quote presence was checked | Structural rules for endpoint types. A first fix that dropped relationships by an English word list was withdrawn after the re-audit showed it missed negated threats and rejected valid phrasing; support is now a read-time advisory (D98, superseded by D103) | Relationship-grounding and support tests; the limit that meaning is model-asserted is recorded, not closed |
| Independent audit: unrelated people, differently formed organizations and masked accounts could merge | Identity keys trusted model-supplied or partial identifiers | Conservative identity rules; uncertain cases stay apart (D99, D101, D104) | Identity tests, including that verified merges still merge |
| Independent audit: one malformed stored value took down the inbox and the graph | Stored JSON was parsed without isolation | Per-column and per-element validation; a damaged record is isolated and reported, never rewritten (D100, D105, D108) | Corrupt-record tests against SQLite |

**Independent verification.** Three reports by a separate AI auditor were supplied by the candidate:
an original audit of the documented build (pass with findings; ship after small fixes), a re-audit of
the first remediation (pass with findings; fix before shipping), and a historical closure audit that
consolidated both into 71 findings and at first found the ledger incomplete. The ledger was then
reconciled against all three. As relayed by the candidate, the auditor's verification of the
reconciled ledger confirmed that all 71 findings are accounted for and found no reproducible P0, P1
or P2 product defect in the scope it verified.

The dispositions are not all "fixed", and this report does not present them as such:

| Disposition in the ledger | Count | Meaning |
|---|---:|---|
| Fixed and verified | 26 | Corrected, with evidence the audit executed or inspected |
| Accepted, documented limitation | 25 | A stated boundary of the delivered scope (section 7) |
| Not independently verified | 14 | Author evidence exists; no audit re-ran it |
| Deferred, non-blocking improvement | 3 | Optional refinements that do not affect a requirement |
| Open requirement | 0 | — |
| Requires the candidate's decision | 3 | Interviewer access, video delivery, and inclusion of the reviewed work in the submission (since committed and pushed) |

**What the test results establish.** The 982 tests use scripted model clients and never contact a
provider; they establish the behaviour of the application code, including its failure paths. They do
not measure the quality of the model's extractions or risk judgements, and no accuracy is claimed.
The totals are author-run. The closure audit independently executed all 281 web tests and 563 of the
701 server tests; it did not run the seven suites that write database files. It also reproduced
selected mutation checks, not all of them, and one earlier "fails on the previous code" claim was
corrected in the ledger: those tests had failed at import, not one by one. Real-browser checks
(desktop and 320–768 px) were author-run in headless Chromium-based Edge and were not repeated by an
audit.

## 6. Acceptance Evidence & Delivery Readiness

**Requirement-to-evidence summary.** The full 24-row mapping, with code locations and limits, is in
[`docs/REQUIREMENTS_TRACEABILITY.md`](docs/REQUIREMENTS_TRACEABILITY.md).

| Brief requirement | Implementation | Evidence | Recorded status |
|---|---|---|---|
| Inbox seeded from the provided file | `ingestion/seed.ts`, `startup.ts`, `GET /api/emails` | Seed, start-up and API tests | Done |
| Add by paste or `.txt` / `.eml` / `.pdf`, same pipeline | `ingestion/*`, `POST /api/emails` | Ingestion, upload-safety and API tests | Done |
| Agent A: structured extraction | `agents/extractionAgent.ts`, shared schemas | Agent tests with scripted model output; replay of three real recordings | Done |
| Agent B: risk level, rationale, tags, entities, relationships, from Agent A's output | `agents/riskAgent.ts`, `risk/*` | Agent, aggregation and pipeline tests; chaining independently verified by replay | Done |
| Free-tier or local LLM, documented, no paid key | `llm/*`; README "Live LLM setup" | Client and configuration tests; clean start with no `.env` | Done |
| Failure path: failure, timeout, malformed output | `llm/client.ts`, `agents/callJson.ts`, `analysis/service.ts` | Failure-path tests; deadline and cancellation probes independently executed | Done |
| Persistence | `storage/sqliteRepository.ts` | Storage and recovery tests on real SQLite files | Done |
| Detail view and entities/relationships panel | `InvestigationPane.tsx` and related components | Component tests; author browser checks | Done |
| Bonus: interactive cross-email graph | `web/src/components/graph/*`, `GET /api/graph` | Graph logic and component tests; author browser checks | Done |
| Usable on a narrow viewport | Responsive layout; Overview / Map / Entities on small screens | Viewport tests; author browser runs at 320, 375 and 768 px | Partial: verified in a desktop browser engine, not on devices |
| React + TypeScript, Node/Express, `.env.example`, fallback described | `web/`, `server/`, `.env.example`, README | Type checks, build, documentation tests | Done |
| No auth or user accounts | Not built | The brief excludes it | Exempt |
| Tests | 62 test files | `npm test` | Done |
| `README.md`, `PROCESS.md` | README; this report and its archive | Fresh-clone set-up check; documentation tests | Done |
| Optional screen recording | Release asset, linked from the README | Byte-identity of the uploaded file verified | Completed, not delivered |
| Honest time statement | README "Development Time" | Candidate's approximate estimate | Satisfied by estimate |

The statuses are the traceability's own words. "Partial" on the narrow viewport reflects the depth of
verification, not a missing layout. The brief's evaluation criteria, including those of both
evaluation tracks, are mapped in the same document. The planning record adopted the
full-stack/pipeline track as its working priority and noted it as an assumption.

**Release acceptance.** The candidate approved the final video, the documentation and the Release on
13 October 2026. For this report the type checks (clean in all three workspaces) and the full test
suites (server 701 of 701, web 281 of 281) were re-executed, author-run, at commit `35237a2`. Set-up
from fresh clones was verified on 12 October 2026 on Windows 11 with Node 24.11.1 and npm 11.7.0,
starting with no `.env` and no provider contact; macOS and Linux were not tested
([Installation notes](README.md#installation-notes)). The audit ledger shows no open requirement.

**Readiness for evaluation.** A reviewer needs Node 22.9 or newer and two
commands ([Quick start](README.md#quick-start)). With no key, the three recorded analyses (a
high-risk, a medium-risk and a benign case) replay through the real pipeline, and every other message
can be processed by the rules-only checks. With the reviewer's own provider key, messages can be
analysed live.

**Handoff action with the candidate.** The repository was private throughout development. On 13
October 2026 the candidate decided to publish it as a portfolio project, after the recruiter
confirmed that it may be shared publicly. Once it is public, the code and the demo video (an asset
of the repository's Release, linked from the README's [Demo video](README.md#demo-video) section)
are reachable without an access grant. Sending the submission to the interviewer remains the
candidate's action; it is a delivery step, not engineering work.

## 7. Scope Decisions & Architectural Boundaries

**Required scope:** delivered in full (section 6).

**Optional capabilities delivered:** the interactive knowledge graph and the screen recording. Beyond
the brief, and added because they serve its stated goals: a no-key replay of genuine model output,
rules-only automatic checks, proven evidence highlighting, a cross-email vendor comparison, an origin
guard, and restart recovery of interrupted analyses.

**Explicitly excluded by the brief**

- *Authentication and user accounts* ("No auth/user accounts needed"). The API is unauthenticated by
  design. It binds to loopback, and the origin guard refuses state-changing requests from web pages
  on other origins. That guard is not authentication.
- *Production polish* ("We don't expect production polish"). The application is built and verified
  for local evaluation. What a public deployment would additionally need is listed in the
  [README](README.md#security-boundaries-and-limitations).

**Not required, and not built:** a local model (the brief accepts a free-tier *or* a local LLM; Groq's
free tier was chosen and documented) and OCR for scanned PDFs (a scanned PDF is refused with an
explicit message).

**Accepted implementation boundaries**

| Boundary | How the application handles it | Implication for local evaluation |
|---|---|---|
| Without a key, three of the ten seed emails carry an AI assessment | The others are labelled "Automatic checks only" or "Not assessed", never as safe | The full pipeline is visible on the recorded cases; a free-tier key extends it to any message |
| Detection quality is not measured | Findings are presented as leads with their evidence | Tests show the software's behaviour, not model accuracy |
| The meaning of a relationship is the model's reading | The quote is verified; weak support is flagged "Check this quote" | A relationship without the flag is not thereby proven |
| The model reads a bounded excerpt (6,000 characters of body, 3,000 per attachment) | Clipping is recorded with the extraction | A "no risk found" result covers the text the model was shown |
| Retry and rate-limit handling was verified against scripted responses | Bounded retries, one deadline, a clearly labelled degraded state | A real provider outage was not observed |
| The work queue is in-process | Interrupted jobs are recovered on restart and not re-sent without consent | Appropriate for a single local user |
| Entity identity rules are conservative heuristics | Uncertain cases are kept apart | A missed merge is likelier than a wrong one; neither is excluded |
| Narrow-viewport and accessibility checks ran in one browser engine | Responsive layout, keyboard operation, visible focus | No device, screen-reader or cross-browser run was performed |

**Scope against the time guidance.** The brief suggests five to six focused hours. The delivered
scope went beyond that guidance through the graph redesign, the security hardening and the audit
remediation. The first audit raised this as an evaluation concern about scope compression; the ledger
records it as an accepted evaluation judgement rather than a product defect (H39).

The complete list of documented limitations and their audit dispositions is in
[`docs/AUDIT_CLOSURE.md`](docs/AUDIT_CLOSURE.md).

## 8. Delivery Artifacts & Engineering Evidence

| Artifact | Location | What it evidences |
|---|---|---|
| Source and history | GitHub repository and its commit history | The implementation and the order in which it was built |
| Set-up, architecture, decisions, limits | [`README.md`](README.md) | How to run and evaluate the application |
| Decision records | [`docs/DECISIONS.md`](docs/DECISIONS.md) | 108 records: context, alternatives, trade-offs, verification, approval status (the first twelve were written retrospectively and are marked so) |
| Requirements traceability | [`docs/REQUIREMENTS_TRACEABILITY.md`](docs/REQUIREMENTS_TRACEABILITY.md) | Each requirement mapped to code, tests, limits and independent evidence |
| Audit ledger | [`docs/AUDIT_CLOSURE.md`](docs/AUDIT_CLOSURE.md) | All 71 independent findings and their dispositions |
| Process chronology | [`docs/PROCESS_HISTORY.md`](docs/PROCESS_HISTORY.md) | The dated workflow record: prompts, results, corrections, validation runs |
| Automated tests | `server/src/__tests__/`, `web/src/**/*.test.*` | 62 files, 982 tests; run with `npm test` |
| Recorded analyses | `fixtures/recorded/` | Three genuine two-agent runs, sealed with integrity hashes |
| Screenshots | `docs/screenshots/` | Real captures of the running application |
| Demo video | Release `demo-v1.0`, linked from the [README](README.md#demo-video) | A narrated walkthrough of about 5 minutes 57 seconds, including a live analysis |
| Working rules | [`CLAUDE.md`](CLAUDE.md) | The governance the AI-assisted work was carried out under |

## 9. Development Effort & References

**Estimated project duration: approximately 8 hours.** This is the candidate's approximate estimate,
covering planning, development, testing, code review, documentation and demo video production. It
was not tracked or measured, and it has not been independently verified. The brief's guidance was
five to six focused hours; section 7 explains where the scope exceeded it. The supporting detail is
in the ledger's [Development time](docs/AUDIT_CLOSURE.md#development-time) section.

**References**

- Assignment: [`candidate_task_brief.md`](candidate_task_brief.md)
- Set-up and evaluation guide: [`README.md`](README.md)
- Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Requirements: [`docs/REQUIREMENTS_TRACEABILITY.md`](docs/REQUIREMENTS_TRACEABILITY.md)
- Audit findings: [`docs/AUDIT_CLOSURE.md`](docs/AUDIT_CLOSURE.md)
- Full process chronology: [`docs/PROCESS_HISTORY.md`](docs/PROCESS_HISTORY.md)

**Document history.** 13 October 2026: the chronological development log that was `PROCESS.md` until
this date was archived unchanged as `docs/PROCESS_HISTORY.md`, and this report took its place.
References to that log in the README, the traceability, the audit ledger and the decision records
were re-pointed to the archive on the same day; no finding, disposition or decision was altered.
Later that day the documentation was prepared for the repository's public release: statements that
assumed a private repository were made independent of its visibility, the README gained a note on
which files the hiring organisation supplied, and a local folder path was removed from the audit
ledger's provenance paragraph.
