# Independent audit closure ledger

This file accounts for every finding of the independent audits (by a separate AI reviewer, "Codex")
and what became of each. Nothing here claims that the auditors accepted a closure; that decision is
theirs.

## Sources and provenance (reconciled 2026-10-12)

Until 2026-10-12 this ledger was built only from findings relayed in remediation prompts; the reports
themselves were not available to the implementing agent (see the appendix). The operator then
supplied the three complete reports, and the ledger was reconciled against them:

| Ref | Report | Verdict |
|---|---|---|
| **A** | Original independent audit (`Pasted text(20261011-185417).txt`), against `633ddd1` | `PASS_WITH_FINDINGS`; release: `SHIP AFTER SMALL FIXES` |
| **B** | Phase 9B independent re-audit (`Pasted text(20261011-191630).txt`) | `PASS_WITH_FINDINGS`; release: `FIX_BEFORE_SHIPPING` |
| **C** | Historical closure audit (`Pasted text(20261012-132539).txt`): 71 distinct findings and sub-findings from A and B | `HISTORICAL_AUDIT_CLOSURE: INCOMPLETE`, 17 unaccounted findings, `FINAL_COMMIT_RECOMMENDATION: HOLD` |

The report files are kept by the operator outside the repository
(`C:\desktop memory\Darya Interview Audit Reports\`) and are not committed. The master matrix below
uses C's numbering (H01–H71 = C's IDs 01–71). C's original-severity column is kept. Where C says
"unspecified" but A or B attached a severity to a grouped row, that is noted.

Two later reviews (of Phase 9D and of its delta) produced further findings that are **not** among the
71. They are listed separately under [Later reviews](#later-reviews-not-among-the-71).

*Reference note, 2026-10-13:* the audits read the chronological development log, which was then
named `PROCESS.md`. On 2026-10-13 that log was archived unchanged as
[`PROCESS_HISTORY.md`](PROCESS_HISTORY.md), and `PROCESS.md` became an Engineering Delivery &
Acceptance Report that no audit has seen. Evidence citations of "Phase N" records in this ledger now
name the archive. Finding texts, severities, sources and dispositions were not changed; where a
finding's own wording says "PROCESS" (H43, H44), it means that log.

### Status words

| Status | Meaning |
|---|---|
| **FIXED_AND_VERIFIED** | Fixed, and audit C independently executed or inspected the fix. Used **only** where C recorded this. |
| **ACCEPTED_DOCUMENTED_LIMITATION** | A stated boundary of this assignment-scale build, documented here and, where named, in the README or DECISIONS. Not a hidden defect. |
| **DEFERRED_NONBLOCKING_IMPROVEMENT** | A recommendation not carried out. It does not affect mandatory functionality. |
| **NOT_INDEPENDENTLY_VERIFIED** | Implemented or claimed, possibly checked by the author, but not independently executed. This includes corrections made in this reconciliation, which await re-verification. |
| **OPEN_REQUIREMENT** | A requirement still unmet with no accepted disposition. |
| **REQUIRES_USER_DECISION** | Only the operator can act (access, handoff, optional material). |

Evidence levels: **[C: executed]** = run by audit C; **[C: inspected]** = source or document
inspected by C, not run; **[author]** = run or written by the implementing agent, not independent.

## Master matrix (71 findings)

| ID | Source | Original severity | Finding | Disposition | Evidence | Outstanding action |
|---|---|---|---|---|---|---|
| H01 | A §3; B §§2–4 | P1 | LLM deadline stopped at the response headers; a stalled body could block indefinitely | FIXED_AND_VERIFIED | `server/src/llm/client.ts`: one deadline races headers and body; `llm-deadline.test.ts` [C: executed] | — |
| H02 | B §§2–4,10 | P1 | Awaited cancellation could prevent the error from settling | FIXED_AND_VERIFIED | Fire-and-forget cleanup that cancels the reader holding the lock (9D); hostile-cancellation tests; C's cancellation mutation gave 3 expected failures [C: executed] | — |
| H03 | A §3; B §§2,4 | unspecified (part of A's P1 correction) | Response size must be bounded for oversized or endless bodies | FIXED_AND_VERIFIED | 1 MiB streamed cap and declared-length check [C: executed] | — |
| H04 | A §§3,6; B §§2,4 | P1 | A stalled analysis monopolized the single worker | FIXED_AND_VERIFIED | Queue tests; the next message reaches processing [C: executed] | — |
| H05 | A §§3,8; B §§2,3 | P1 | An existing quote let structurally impossible relationships through | FIXED_AND_VERIFIED | `server/src/risk/relationshipRules.ts`; impossible endpoints, self relations and unknown types tested [C: executed] | — |
| H06 | A §§3–5; B §§2,3,6 | P1/P2 | Quote occurrence does not prove predicate, direction or participants; repository invariants do not prove meaning | ACCEPTED_DOCUMENTED_LIMITATION | README "What is verified, and what is not"; negated, reversed and unrelated quotes get the advisory "Check this quote" (`relationship-support.test.ts`) [C: executed] | Never describe a retained relationship as semantically verified |
| H07 | B §§3,8 | P2 | The cue filter rejected legitimate uncommon threats | FIXED_AND_VERIFIED | Cue lists no longer remove relationships (D103) [C: executed] | — |
| H08 | B §2 | unspecified | Unsupported predicates were turned into invented `related_to` edges | FIXED_AND_VERIFIED | `riskAgent.ts` removes unknown predicates [C: executed] | — |
| H09 | A §3; B §§2,6 | unspecified | A transfer to an amount was shown as the money being the destination | FIXED_AND_VERIFIED | `predicateLabel` reads "requests transfer of" for an amount [C: executed, web suites] | — |
| H10 | B §6 | unspecified | The stored `requests_transfer_to` predicate serves both the destination role and the transferred-object role | ACCEPTED_DOCUMENTED_LIMITATION | `relationshipRules.ts:23` allows account, organization, person **or amount** as target; only the label differs for an amount; recordings and stored data unchanged (D98) [C: inspected] | Recorded here (newly). A separate predicate would change the schema and invalidate the recordings; not planned |
| H11 | A §3; B §§2,6 | P1 | An unrelated person merged through a model-supplied address that merely appeared in the message | FIXED_AND_VERIFIED | `risk/entities.ts`; `risk-identity-9b.test.ts` [C: executed] | — |
| H12 | B §§2,6 | unspecified | Keep correct name/address pairs; withhold ambiguous same-name pairs | FIXED_AND_VERIFIED | Positive and negative identity tests [C: executed] | — |
| H13 | B §6 | unspecified | The English, capitalisation-based name-pair parser can miss legitimate merges | ACCEPTED_DOCUMENTED_LIMITATION | README identity disclosure [C: inspected] | — |
| H14 | A §3; B §§2,4 | P2 | Acme Inc./LLC over-merged; synonymous legal forms should still merge | FIXED_AND_VERIFIED | Dataset-wide legal-form context; identity tests [C: executed] | — |
| H15 | A §§3,5; B §6 | unspecified | Organization names cannot establish real-world identity | ACCEPTED_DOCUMENTED_LIMITATION | README calls identity heuristic [C: inspected] | — |
| H16 | B §6 | unspecified | Adding a conflicting legal form can change an organization's canonical key | ACCEPTED_DOCUMENTED_LIMITATION | `orgKey()` (`risk/entities.ts:148`) adds the legal-form suffix to the key only while the data holds more than one form of that name, so ingesting "Acme LLC" changes the key of an existing "Acme Inc." node. An older `/graph?node=…` link then shows "That entity is not in the graph"; nothing is merged wrongly or lost [author: code inspected] | Recorded here (newly). Stable keys would need a persisted identity table; not planned |
| H17 | A §3; B §2 | P2 | Differently described masked accounts over-merged within one email | FIXED_AND_VERIFIED | Owner, digits and description identity [C: executed] | — |
| H18 | B §§3,4,6 | P2 | Checking/savings suffix collision across emails | FIXED_AND_VERIFIED | `risk-account-identity.test.ts`, incl. order independence and the preserved E004/E009 merge [C: executed] | — |
| H19 | A §3; B §6 | unspecified | Partial account identifiers stay insufficient; identical descriptions can still collide | ACCEPTED_DOCUMENTED_LIMITATION | README admits same-owner, same-description wrong merges [C: inspected] | Do not claim universal account identity |
| H20 | A §3; B §§2,4 | P2 | Invalid stored JSON syntax crashed mailbox and graph reads | FIXED_AND_VERIFIED | Per-column parsing and downgrade; SQLite `:memory:` tests [C: executed] | — |
| H21 | B §§3,4,8 | P2 | Structurally invalid run/address arrays (`[null]`, `[{}]`) crashed reads | FIXED_AND_VERIFIED | Element schemas; `storage-corrupt.test.ts` [C: executed] | — |
| H22 | A §6; B §§2,4 | unspecified | Corruption must isolate one record, keep healthy data and never rewrite on read | FIXED_AND_VERIFIED | Tests compare retained records and stored bytes [C: executed] | — |
| H23 | B §§3,6 | P2 | Legacy saved relationships bypassed current structural restrictions | FIXED_AND_VERIFIED | Structural checks on graph/detail read; legacy API tests [C: executed] | — |
| H24 | A §§5,6; B §2 | unspecified | Global aggregation, shared identities, per-message provenance, retained relationships | FIXED_AND_VERIFIED | `graph-aggregation.test.ts` (7) [C: executed] | — |
| H25 | A §§2–5; B §7 | unspecified | Summaries, rationales, attachment summaries and semantic attributes remain model assertions | ACCEPTED_DOCUMENTED_LIMITATION | README separates checked presence from meaning [C: inspected] | No comprehensive semantic-validation claim |
| H26 | A §5; B §§7,10 | unspecified (B §10: accepted limitation) | Prompt clipping limits coverage; a `none` result does not prove every stored passage was examined | ACCEPTED_DOCUMENTED_LIMITATION | `agents/prompts/extraction.ts:36` `DEFAULT_SEGMENT_LIMITS`: body 6,000 characters, 3,000 per attachment, at most 4 attachments; clipping is noted in the extraction notes [C: inspected]. README sentence added 2026-10-12 [author] | — |
| H27 | A §§2,5; B §10 | unspecified | Detection and extraction quality has no labelled accuracy evaluation | ACCEPTED_DOCUMENTED_LIMITATION | README makes no accuracy claim [C: inspected] | — |
| H28 | A §5; B §10 | unspecified | Scripted injection tests do not establish resistance against a real model | ACCEPTED_DOCUMENTED_LIMITATION | README "Prompt-injection resistance is mitigated, not guaranteed" [C: inspected] | — |
| H29 | A §§3,5; B §§2,9 | unspecified | Fixture hashes prove consistency, not provider authorship, billing or absence of prior attempts | ACCEPTED_DOCUMENTED_LIMITATION | README fixture caveat; `replay/fixture.ts` [C: inspected] | — |
| H30 | A §§5,12; B §§5,10 | unspecified | Retry/429/outage behaviour checked only against scripted transports | ACCEPTED_DOCUMENTED_LIMITATION | Controlled transport tests [C: executed] | — |
| H31 | A §§2,12; B §12 | unspecified | Provider availability, account entitlement and historical billing tier unverified | NOT_INDEPENDENTLY_VERIFIED | No provider contacted by any audit | No independent-verification claim |
| H32 | A §§5,7,8; B §§7,9 | unspecified | New inputs without a key get rules-only handling, not a fresh AI assessment | ACCEPTED_DOCUMENTED_LIMITATION | README four modes; three recordings only [C: inspected] | — |
| H33 | A §§4,12; B §§5,10 | unspecified (B §10: accepted limitation) | The in-process PDF timeout cannot preempt synchronous CPU work | ACCEPTED_DOCUMENTED_LIMITATION | `server/src/ingestion/pdf.ts`; DECISIONS D16 trade-offs; README deployment list names PDF-parsing exposure [C: inspected] | — |
| H34 | A §§6,12; B §5 | unspecified | Genuinely encrypted, hostile or stalled PDFs are not established by generated fixtures or mocked exceptions | ACCEPTED_DOCUMENTED_LIMITATION (confidence gap; untested, not verified) | D16 "Important limitation": builder-generated test PDFs; `pdf-errors.test.ts` only maps mocked parser errors [C: inspected] | Do not present the mapping tests as parser acceptance |
| H35 | A §4; B §§2,10 | unspecified (B §10: accepted limitation) | Queue and rate pacing are process-local; multi-process robustness absent | ACCEPTED_DOCUMENTED_LIMITATION | `server/src/analysis/queue.ts`; README "in-process queue … lost on restart" and "a job queue that survives restarts" before deployment [C: inspected] | — |
| H36 | A §4; B §§2,10 | unspecified (B §10: accepted limitation) | Bounded run history eventually stops counting older AI attempts | ACCEPTED_DOCUMENTED_LIMITATION | `MAX_RUN_LOGS = 10` (`shared/src/analysis.ts:57`); histories sliced in `analysis/service.ts` and `automaticChecks.ts`; disclosed in `PROCESS_HISTORY.md` (Phase 7E residuals) [C: inspected] | — |
| H37 | A §4; B §2 | unspecified | Cross-email findings are recomputed on every read; poor scaling beyond a small mailbox | ACCEPTED_DOCUMENTED_LIMITATION | README trade-off "derived at read time … costs recomputation on each read (fine at this size)"; README future work names pagination [C: inspected] | — |
| H38 | A §§4,9; B §§2,10 | P3 | Large UI components and the custom graph increase maintenance burden | ACCEPTED_DOCUMENTED_LIMITATION | e.g. `InvestigationPane.tsx`, `web/src/components/graph/*`; B §10: "Accept for submission; simplify during future maintenance" [C: inspected] | No pre-submission redesign |
| H39 | A §§2,4,9; B §§2,7 | P2 evaluation concern (A E01) | Weak scope compression for a short take-home | ACCEPTED_DOCUMENTED_LIMITATION (an evaluation judgment, not a product defect; cannot be undone after the fact) | README "Time spent": scope grew beyond the 5–6 h guidance; the operator's estimate is about 8 h [author]. *Note, 2026-10-13:* the README section is now "Development Time" and no longer carries that sentence; it is kept in [Development time](#development-time) below | Add no further scope |
| H40 | A §§2,3,7,10; B §§3,7,10 | P2 | The requested actual development duration was absent | NOT_INDEPENDENTLY_VERIFIED. Disclosure **SATISFIED** by the operator's approximate overall estimate; precise focused-time measurement **NOT AVAILABLE**; independent verification of duration **NOT PERFORMED**. Not an open product defect or unmet requirement | README "Time spent": "Approximately 8 hours, including planning, development, testing, code review, documentation, and demo video production", stated as an approximate estimate. Until 2026-10-13 this row said the demo video was "planned, not yet recorded", so its share was expected effort. *Resolution note, 2026-10-13:* the video has been completed (see H52); its production is included in the estimate, which the operator confirmed unchanged. *Later on 2026-10-13:* the README section was renamed "Development Time" and shortened to the operator's wording: "Estimated project duration: Approximately 8 hours", the same list of activities, and "an approximate estimate, not precisely tracked time". The agent-session activity, reported separately, moved from the README to [Development time](#development-time) below [author] | None required; the figure cannot be independently verified |
| H41 | A §8; B §§3,7,11 | P3 | Honest inability to measure was conflated with partial completion of the duration requirement | NOT_INDEPENDENTLY_VERIFIED (corrected 2026-10-12) | Traceability row 24 now reads "Satisfied (estimate)": the disclosure is made through the approximate estimate, kept separate from "Done" and from any measurement claim [author] | Re-verify |
| H42 | A §§2,8; B §7 | unspecified | 5–6 hours is guidance, not a hard cutoff; actual compliance unknown | ACCEPTED_DOCUMENTED_LIMITATION | README states the scope exceeded the guidance; the ≈8 h estimate is above it [author]. *Note, 2026-10-13:* that statement moved from the README to [Development time](#development-time) below when the README section was shortened | No invented deadline violation |
| H43 | A §§2,7,12; B §2 | unspecified | Workflow and historical runtime claims cannot authenticate themselves | NOT_INDEPENDENTLY_VERIFIED | `PROCESS_HISTORY.md` (the log, named `PROCESS.md` when C inspected it) labels transcribed early rounds [C: inspected] | Keep the provenance qualification |
| H44 | A §7 | unspecified | PROCESS length (about 1,700 lines) makes reviewer navigation difficult | DEFERRED_NONBLOCKING_IMPROVEMENT | `PROCESS.md` is chronological, with no index. *Reference note, 2026-10-13:* that sentence describes the log, now archived unchanged as `PROCESS_HISTORY.md` (still without an index); `PROCESS.md` is now a short delivery report that links to it. The disposition is left as recorded | Optional: a phase index at the top |
| H45 | A §§2,5,6; B §§2,7,10 | unspecified (B §10 groups it under "P2 confidence gap") | Browser pan/zoom, selection and graph interaction quality not independently verified | NOT_INDEPENDENTLY_VERIFIED | Author-run headless Edge scripts (`PROCESS_HISTORY.md`, 7D.3, 9C, 9D: 46/46, delta 25/25) [author]; component and math tests [C: executed]; no independent browser run | — |
| H46 | A §§2,5,6,8; B §§2,7 | P2 confidence gap | Mobile layout, clipping, density and touch journey | NOT_INDEPENDENTLY_VERIFIED | Author Edge runs at 320/375/768 px with emulated touch [author]; jsdom tests [C: executed]; no device | Universal 44 px targets are not a requirement |
| H47 | A §2; B §§2,10 | P2 confidence gap | Contrast, keyboard/focus and assistive-technology acceptance | NOT_INDEPENDENTLY_VERIFIED | Accessibility-tree checks for the advisory in Edge [author]; DOM accessibility tests [C: executed]; no screen reader, axe or contrast audit | Tested mechanisms are not full accessibility acceptance |
| H48 | A §2; B §7 | unspecified | Visual consistency and loading/empty/error polish lack independent browser acceptance | NOT_INDEPENDENTLY_VERIFIED | Component state tests [C: executed]; screenshots are the author's | — |
| H49 | A §§1,7,12; B §§2,9 | unspecified in C (B §10 lists install acceptance under "P2 confidence gap") | Clean-clone installation and first-run startup not independently verified | NOT_INDEPENDENTLY_VERIFIED | Author fresh-clone check recorded in `PROCESS_HISTORY.md`, Phase 8 ("Clean-room verification") [author]; no audit ran an install | An independent clean-clone run would close it |
| H50 | A §§2,6; B §§5,7 | unspecified in C (B §10 lists restart acceptance under "P2 confidence gap") | Real restart and disk durability not independently re-run | NOT_INDEPENDENTLY_VERIFIED | The author ran the file-writing suites (storage, seed, startup, analysis storage, analysis service, API recovery, replay) on 2026-10-12 within the full server run [author]; C excluded exactly those 7 suites; no independent real restart | — |
| H51 | A §§2,7,10; B §§2,9,10 | P2 handoff risk | Interviewer access to the private repository and setup guide is unknown | REQUIRES_USER_DECISION | `web/src/lib/docs.ts` links the private GitHub README | Grant access or supply a permitted zip at handoff |
| H52 | A §§2,8; B §§2,7,10 | unspecified | The optional screen recording is absent | REQUIRES_USER_DECISION (disposition unchanged; 2026-10-13: the recording now exists and is in the private GitHub Release; confirming the interviewer's access and delivery is the remaining operator decision) | Operator, 2026-10-12: a video is planned and **not finished**. *Resolution note, 2026-10-13:* the video "Mail Risk Intelligence" has been **completed**: approximately 5 minutes 57 seconds, narrated by the project author, reviewed and approved by the operator. When this note was first written the file was stored locally only. *Later on 2026-10-13:* it was published as an asset of the **private** GitHub Release `demo-v1.0` (tag on commit `ec4adf6`), and the README links to it. The asset is not a tracked file and can be opened only with access to the private repository. **Final delivery to the interviewer is pending** [author; not seen by any audit] | Until 2026-10-13: do not claim a recording until it exists. Since then: do not claim delivery until the interviewer's access is confirmed (see H51) |
| H53 | A §6; B §8 | unspecified | Fake-LLM tests prove application behaviour, not model quality | ACCEPTED_DOCUMENTED_LIMITATION | README names the scripted clients [C: inspected] | — |
| H54 | A §6; B §8 | unspecified | Constructed analyses and placeholder quotes bypass grounding; the test title "legitimate relationships" overclaims | DEFERRED_NONBLOCKING_IMPROVEMENT | `relationship-grounding.test.ts:52` "legitimate relationships and their quotes are preserved exactly" keeps `sent_email_to` on a transfer quote: it proves preservation, not legitimacy. `risk-entities.test.ts`, `risk-account-identity.test.ts`, `graph-aggregation.test.ts` insert constructed analyses (placeholder quote `"x"`) on purpose [C: inspected] | Rename the test at the next code change (test edits are outside this documentation-only pass); read those suites as mechanics tests |
| H55 | A §6; B §§2,8 | unspecified | jsdom viewport tests do not establish browser layout or touch behaviour | ACCEPTED_DOCUMENTED_LIMITATION | README separates jsdom from manual browser checks [C: inspected] | — |
| H56 | A §6; B §8 | unspecified (A: "an improvement to confidence, not an additional mandatory feature") | No automated real-browser/API/isolated-SQLite/restart/mobile journey | DEFERRED_NONBLOCKING_IMPROVEMENT | Author-run manual Edge scripts live outside the repository; no automated suite in the repository or CI | — |
| H57 | A §6; B §§2,8 | unspecified | Historical mutation claims not independently reproduced; a whole-file "fails on HEAD" can be an import failure | NOT_INDEPENDENTLY_VERIFIED | C reproduced selected mutations only (cancellation 3, inspector 9, filter 3) [C: executed]. Dated correction added 2026-10-12: D98's "16 grounding tests … failing on HEAD" were import failures (`relationshipRules.ts` did not exist at HEAD) [author] | Limit certification to comparisons actually established |
| H58 | A §6; B §8 | unspecified | Historical full-suite counts and totals not independently established; counts do not prove coverage | NOT_INDEPENDENTLY_VERIFIED | Author ran 38 files / 701 server and 24 / 281 web tests on 2026-10-12 [author]. C **executed** web 24 / 281 and server 31 files / 563 tests; it **collected** 701 but excluded 7 file-writing suites [C: executed] | Never describe 701 as independently passing |
| H59 | A §§3,7,8; B §3 | P3 | "Every AI finding is verified" exceeded mechanical grounding | FIXED_AND_VERIFIED | README verification table [C: inspected; docs tests executed] | — |
| H60 | B §3 | P3 | "Uncertain identities always stay apart" overstated | FIXED_AND_VERIFIED | README admits heuristic wrong merges [C: inspected] | — |
| H61 | A §3; B §§2,9 | P3 | Capture-key versus keyless-replay wording contradicted the provenance | FIXED_AND_VERIFIED | Capture used the operator's Groq key; replay uses none (completed in the 9D delta, D-P3d) [C: inspected] | — |
| H62 | A §8; B §§2,3,7 | P3 | "Done" counts conflated implementation with independent acceptance; overlapping rows | FIXED_AND_VERIFIED | Traceability separates the two [C: inspected]; 2026-10-12: an independent-evidence column was added [author] | Read "Done" as implementation status only |
| H63 | A §8; B §3 | P3 | Evaluation criteria and repository delivery/access were omitted from the traceability's assessment | NOT_INDEPENDENTLY_VERIFIED (documentation added 2026-10-12) | Traceability section "Evaluation criteria and delivery" maps E01–E14 and D01 to evidence and to this matrix [author] | Re-verify |
| H64 | A §8; B §3 | unspecified | The authentication exemption was counted as completed functionality | FIXED_AND_VERIFIED | Traceability row 19 is "Exempt" [C: inspected] | — |
| H65 | A §§4,8,10; B §§7,10 | unspecified | Do not invent auth, OCR, Ollama or mandatory-video obligations; code-derived headers are permitted | ACCEPTED_DOCUMENTED_LIMITATION | Brief scope; README future work [C: inspected] | — |
| H66 | A §7 | unspecified | The build produces the frontend only, not a standalone compiled backend bundle | ACCEPTED_DOCUMENTED_LIMITATION | README Quick start: "`npm run build` … builds the frontend … The API is run with `tsx`" [C: inspected] | The brief requires no backend bundle |
| H67 | A §§7,10,11; B §9 | unspecified | Intended uncommitted/untracked remediation must be included in the final reviewed submission | REQUIRES_USER_DECISION | All 9A–9D work is uncommitted and partly untracked. *Status note, 2026-10-13:* the sentence before this note describes the state when the row was written. The approved audit remediation was committed as `ea6c588` on 2026-10-12 and pushed to `origin/main`. The documentation commits `48cf19f` (2026-10-12) and `ec4adf6` (2026-10-13) followed and were also pushed. `main` is based on `ec4adf6` before the documentation commit that carries this note. The disposition is left as recorded [author; not re-verified by an audit] | The operator includes the reviewed files when committing |
| H68 | A §§1,12; B §2 | unspecified | Concurrent working-tree drift prevented frozen-source certification | FIXED_AND_VERIFIED (for C's audit interval only) | 230 files with identical before/after SHA-256 [C: executed] | — |
| H69 | A §5; B §§2,4 | unspecified | Keep E001/E004/E007 request compatibility and recorded results | FIXED_AND_VERIFIED | Actual-pipeline replay; fixtures and seed unchanged [C: executed] | — |
| H70 | B §5 | unspecified | Agent B failure orchestration lacked independent runtime proof | FIXED_AND_VERIFIED | In-memory probe: B failure gives `partial`, keeps the extraction, the next message completes [C: executed] | — |
| H71 | A §12; B §12 | unspecified | Dependency advisories and a comprehensive secret-history scan were outside independent evidence | NOT_INDEPENDENTLY_VERIFIED | Author secret-pattern scans of the working tree only [author] | No comprehensive security certification |

### Totals

| Disposition | Count | IDs |
|---|---:|---|
| FIXED_AND_VERIFIED | 26 | H01–H05, H07–H09, H11, H12, H14, H17, H18, H20–H24, H59–H62, H64, H68–H70 |
| ACCEPTED_DOCUMENTED_LIMITATION | 25 | H06, H10, H13, H15, H16, H19, H25–H30, H32–H39, H42, H53, H55, H65, H66 |
| NOT_INDEPENDENTLY_VERIFIED | 14 | H31, H40, H41, H43, H45–H50, H57, H58, H63, H71 |
| DEFERRED_NONBLOCKING_IMPROVEMENT | 3 | H44, H54, H56 |
| OPEN_REQUIREMENT | 0 | — (the duration disclosure is satisfied by an estimate; see H40 and [Development time](#development-time)) |
| REQUIRES_USER_DECISION | 3 | H51, H52, H67 |
| **Total** | **71** | |

Compared with C: C's 26 verified, 14 accepted, 9 not independently verified and 3 user decisions are
unchanged. C's 17 missing entries are now individual rows (11 accepted, 3 deferred, 3 not
independently verified). C's 2 `OPEN_DEFECT` rows changed after the operator supplied an estimate:
H40's disclosure is now satisfied by the approximate estimate (not measured, not independently
verified), and H41 was corrected. Neither counts as open. Both await re-verification.

*Update, 2026-10-13:* the optional screen recording that H52 found absent has been completed (see
the H52 row). No disposition and no count above changed: the 71 findings and their totals stand as
reconciled on 2026-10-12, and H52 stays a user decision because the video has not been delivered.
Later the same day the video was published in the private repository's GitHub Release `demo-v1.0`.
That is availability to people with repository access, not delivery to the interviewer, so H52 stays
REQUIRES_USER_DECISION until delivery or access is confirmed.

### The 17 entries C found missing

| ID | Disposition |
|---|---|
| H10 | ACCEPTED_DOCUMENTED_LIMITATION |
| H16 | ACCEPTED_DOCUMENTED_LIMITATION |
| H26 | ACCEPTED_DOCUMENTED_LIMITATION |
| H33 | ACCEPTED_DOCUMENTED_LIMITATION |
| H34 | ACCEPTED_DOCUMENTED_LIMITATION (confidence gap) |
| H35 | ACCEPTED_DOCUMENTED_LIMITATION |
| H36 | ACCEPTED_DOCUMENTED_LIMITATION |
| H37 | ACCEPTED_DOCUMENTED_LIMITATION |
| H38 | ACCEPTED_DOCUMENTED_LIMITATION |
| H39 | ACCEPTED_DOCUMENTED_LIMITATION (evaluation judgment) |
| H44 | DEFERRED_NONBLOCKING_IMPROVEMENT |
| H49 | NOT_INDEPENDENTLY_VERIFIED |
| H50 | NOT_INDEPENDENTLY_VERIFIED |
| H54 | DEFERRED_NONBLOCKING_IMPROVEMENT |
| H56 | DEFERRED_NONBLOCKING_IMPROVEMENT |
| H63 | NOT_INDEPENDENTLY_VERIFIED |
| H66 | ACCEPTED_DOCUMENTED_LIMITATION |

## Development time

- **Requested by the brief:** "Please tell us honestly how long you spent."
- **Statement in the README** (section "Development Time"; wording set by the operator on
  2026-10-13): "**Estimated project duration: Approximately 8 hours.** This estimate includes
  planning, development, testing, code review, documentation, and demo video production. *This is an
  approximate estimate, not precisely tracked time.*" It is the operator's approximate overall
  project-effort estimate, not a precisely measured duration.
- **Earlier wording** (README section "Time spent", 2026-10-12 to 2026-10-13): "**Estimated Project
  Duration:** Approximately 8 hours, including planning, development, testing, code review,
  documentation, and demo video production." The figure and what it covers are the same; only the
  presentation changed.

| Aspect | Classification |
|---|---|
| Development-time disclosure | **SATISFIED** through the operator's approximate overall estimate |
| Precise focused-time measurement | **NOT AVAILABLE** (never measured) |
| Independent verification of duration | **NOT PERFORMED** |
| Demo video | **COMPLETED** on 2026-10-13 ("Mail Risk Intelligence", approximately 5 minutes 57 seconds); **AVAILABLE** as an asset of the private GitHub Release `demo-v1.0` since the same day; **DELIVERY TO THE INTERVIEWER PENDING** (H52). The estimate includes its production |

- **Estimate versus confirmed work:** the 8 hours is the operator's approximate overall estimate and
  includes the video's production. The operator confirmed it unchanged on 2026-10-13, after the video
  was finished; it was not replaced by another figure. No human working time is confirmed by any
  record. The agent-session activity recorded below is measured from the local Claude Code
  transcripts, but it is not human working time and neither supports nor contradicts the estimate.
- *History, 2026-10-13 (third change that day):* the README section was renamed from "Time spent" to
  "Development Time" and shortened to the operator's wording. Its longer explanation, the
  agent-session figures and the sentence about the 5–6 hour guidance were moved here unchanged (next
  subsection), so the evidence cited by H39–H42 is kept.
- *History, 2026-10-13 (second change):* the table above said the video was "NOT DELIVERED (stored
  locally; not uploaded, published or shared)" until it was published in the private Release.
- *History, 2026-10-13:* until this date the table above classified the demo video as "PLANNED, NOT
  YET COMPLETED" and this section described its production as "not yet done".
- *History:* an earlier same-day version of this section (2026-10-12) said "about 8 hours of total
  personal involvement" and classified the measured duration as "UNMET". The operator then set the
  2026-10-12 wording quoted above as "earlier wording", and the duration is no longer counted as
  unmet; see `PROCESS_HISTORY.md`.

### README "Time spent" section as it stood until 2026-10-13 (moved here)

Kept verbatim from commit `ec4adf6`, the last one in which the README carried it; only its one
in-page link now points at the README. It is a historical record. The current statement is the one
quoted at the top of this section. The agent-session figures below end on 2026-10-12 at 16:32 local,
before the video was finished. Its closing sentence about `PROCESS.md` refers to the chronological
log, now `PROCESS_HISTORY.md`.

**Estimated Project Duration:** Approximately 8 hours, including planning, development, testing, code review, documentation, and demo video production.

This is the operator's approximate overall project-effort estimate, not a precisely measured duration.

- **Not independently verified.** No time-tracking record exists, and nobody has checked the figure.
- **The demo video has been completed** (see [Demo video](../README.md#demo-video)). Its production is included
  in the overall estimate, which the operator confirmed unchanged on 2026-10-13. Until that date
  this section said the video was planned and not yet recorded.
- **Precise focused time: not available.** It was never measured.
- **Confirmed elapsed work** is therefore not a human-hours figure. The only recorded data is the
  agent-session activity below, which measures something different.

Agent-session activity, measured separately, is a **different quantity**. It comes from the local
Claude Code transcripts (user and assistant events, timestamps in UTC; local time is UTC+3):

| Period | Events | First to last event | Sum of gaps of at most 5 min | Sum of gaps of at most 10 min |
|---|---:|---|---:|---:|
| 2026-10-11 | 4,221 | 13:21–22:28 local (9.1 h span) | 6.9 h | 7.4 h |
| 2026-10-12, until 16:32 local | 513 | 15:19–16:32 local (1.2 h span) | 0.6 h | 0.6 h |
| Both days | 4,734 | two sittings, 17 h apart | 7.5 h | 8.0 h |

These figures include unattended agent runs (test suites, browser checks) and waiting. They exclude
the operator's own review and reading, the independent Codex audits, and any work in other tools.
They are therefore neither evidence for nor against the overall estimate. Either way the scope grew beyond
the 5–6 hour guidance because of the added phases (graph redesign, security hardening, audits).

*Correction, 2026-10-12:* an earlier version of this section covered only 2026-10-11 and said 4,199
events. A recount of the same window (to 19:25 UTC) gives 4,201; the hour figures were unchanged at
the stated precision. The earlier sentence "cannot be reconstructed reliably" stays true for
**measured** focused time; the estimate above was added because the brief asks for one. Its wording
was set by the operator on 2026-10-12 (an earlier same-day draft said "about 8 hours of total
personal involvement").

`PROCESS.md` records what was done, in what order, and what went wrong.

## Former ledger rows (before 2026-10-12) and their master IDs

| Former row | Master ID(s) |
|---|---|
| L1 deadline / stalled body | H01, H04 |
| L2 awaited cancellation | H02 |
| L3 response size | H03 |
| L4 relationship accepted on any quote | H05, H06, H08 |
| L5 negated / reversed / unrelated quote | H06 |
| L6 uncommon threats rejected | H07 |
| L7 legacy stored analyses | H23 |
| L8 person merged through address | H11, H12 |
| L9 Acme Inc./LLC | H14 |
| L10 masked accounts in one message | H17 |
| L11 masked accounts across messages | H18 |
| L12 invalid JSON syntax | H20, H22 |
| L13 structurally invalid JSON | H21, H22 |
| Graph aggregation and provenance | H24 |
| README overstated verification | H59 |
| Uncertain identities stay apart | H60 |
| Recording provenance | H61 |
| "No authentication" presented as done | H64 |
| Implementation vs independent verification | H62 |
| Development time | H40–H42 |
| Security and error handling | H28, H71 |
| Browser, mobile and accessibility confidence | H45–H48 |
| Real provider outage / 429 | H30, H31 |
| Detection accuracy | H27 |
| English-only cue lists | H06, H07 |
| Local models and OCR | H65 |
| Reviewer access and handoff | H51, H67 |
| Optional screen recording | H52 |
| "Items not relayed" (OPEN, unknown) | Resolved: the 17 rows above |

## Later reviews (not among the 71)

These findings came from independent reviews of Phase 9D and of its delta. They post-date reports A
and B and are not part of C's 71. Their statuses use this section's own older vocabulary:
FIXED_AND_TESTED is the author's claim. C later executed the inspector (9 failures), filter (3) and
cancellation (3) mutations, so D-P2a, D-P2b and P3-b have independent mutation evidence; the rest
are author evidence only.

### Review of Phase 9D: P2 and P3 findings

That audit found no P0/P1 defects and recommended FIX_BEFORE_SHIPPING. Its findings were relayed as
summarised below; the report itself was not available to the implementing agent.

| # | Finding | Status | Code evidence | Regression tests | Remaining limitation |
|---|---|---|---|---|---|
| P2 | *(closure was incomplete; see the delta table below)* Relationship review status not shown consistently (email-detail rows, Graph List, canvas accessible labels, graph-to-evidence callout); callout said the passage "supports a relationship" | FIXED_AND_TESTED | `web/src/components/ReviewNote.tsx`, `web/src/lib/review.ts` (reads `review`/`support.review` only), `InvestigationPane.tsx` (rows, linked callout), `graph/GraphList.tsx`, `graph/GraphCanvas.tsx` (`relationshipSpoken`, `pillReview`), `lib/claims.ts` (`citations`), `lib/copy.ts`; `lib/graph/filters.ts` now keeps the edge-level `review` (a defect found by the new tests) | `web/src/components/RelationshipReview.test.tsx` (negated, reversed, unrelated, valid uncommon and ordinary cases on 4 surfaces each, plus 2 legacy-shape tests); existing `GraphWorkspace.test.tsx` advisory test; server `relationship-support.test.ts` (legacy stored analysis flagged in graph and message) | The flag is a heuristic; meaning stays model-asserted. Canvas cue is a dashed outline (meaning is in the accessible name and inspector). Graph List on a phone already broke words mid-letter (unchanged by the chip, measured) |
| P3-a | Malformed mailbox address and header elements dropped without a visible warning; D105 overstated | FIXED_AND_TESTED; D105 and D100 corrected | `server/src/storage/sqliteRepository.ts` (`read_issues` for `to`, `cc`, `missing_headers` against the header enum, `warnings`), `shared/src/email.ts` (`StoredReadIssue`), `api/views.ts`, `InvestigationPane.tsx` (callout, "incomplete", "Could not be read") | `storage-corrupt.test.ts` "unreadable email list columns are reported, never filled in" (6); `RelationshipReview.test.tsx` "stored address lists…" (3) | Not shown in the inbox list or graph; re-analysis of a damaged message uses the partial list; `from`/`date`/`subject` are plain columns and are not covered |
| P3-b | Two `llm-deadline.test.ts` tests did not exercise what their names claimed | FIXED_AND_TESTED, plus a real defect fixed | `server/src/llm/client.ts` (`releaseBody(body, reader)`; `readBounded` records the reader) | `llm-deadline.test.ts`: stalled body with a cancel spy; 503 with a stalled, abort-ignoring, uncancellable body (timeout, abort observed, cancel reached); ordinary HTTP status classification (renamed); a rejecting source cancel is reached, with no unhandled rejection; a non-standard body whose cancel throws synchronously. 3 fail on the 9C release logic | An HTTP error whose body stalls is classified as a timeout, not by its status, because the body is read first (documented in the test) |

### Review of the Phase 9D delta: remaining P2 and P3 findings

The independent review of 9D found that the P2 closure above was incomplete and that some
documentation was inaccurate. Each inspector finding was reproduced by a test that fails on the 9D
code before it was fixed.

| # | Finding | Status | Code evidence | Regression tests | Remaining limitation |
|---|---|---|---|---|---|
| D-P2a | `FeaturedRelationship` (desktop start panel) showed a flagged relationship without the advisory | FIXED_AND_TESTED | `web/src/components/graph/NodeInspector.tsx` (`FeaturedRelationship` features the flagged citation and renders `ReviewNote`) | `InspectorReview.test.tsx` "featured relationship (start panel)" × 6 combinations; 4 fail on the 9D code | None known |
| D-P2b | Edge and entity inspectors ignored edge-only (legacy) review metadata | FIXED_AND_TESTED | `web/src/lib/review.ts` `unattributedReview()`; `NodeInspector.tsx` (both inspectors); `lib/claims.ts` uses the same rule | `InspectorReview.test.tsx` "edge inspector" and "node connection inspector" × 6 combinations (evidence-level, edge-only, edge-only with two quotes shown once, mixed, clean with and without metadata) plus 1 accessibility test; 5 fail on the 9D code. `filters.test.ts` "filters keep each relationship's review metadata" (3; fail on the pre-9D filter) | When only the edge is flagged, the UI cannot tell which quote is weak, so the note is relationship-level and uses generic wording |
| D-P3a | README: "every surface" overstated | FIXED | README now lists the places explicitly and does not claim the list is exhaustive; D107 carries a correction note | (documentation) | — |
| D-P3b | README test counts out of date | FIXED | README and traceability: server 38 / 701, web 24 / 281, as last executed 2026-10-12 | (executed suites) | Counts go stale on the next change |
| D-P3c | README: "Tests use … in-memory repositories" inaccurate | FIXED | README states that 7 server test files use the real SQLite repository (6 with temporary database files) | (documentation, checked with grep over the test files) | — |
| D-P3d | README implied the recordings were produced without a provider key | FIXED | README states the operator's Groq key was used at capture time; replay needs none | (documentation) | — |

## What a reader should still not assume

- A relationship displayed without a "Check this quote" note has **not** been proven true; it
  merely did not trip a heuristic.
- A merged entity is the product of conservative rules, not a guarantee.
- A passing test suite shows that the tests pass, not that an audit is satisfied. The author's test
  totals (server 701, web 281) are not independent results; audit C executed web 281 and server 563.
- About 8 hours is the operator's approximate overall estimate. It includes the production of the
  demo video (completed 2026-10-13), and it is neither a measurement nor independently verified.
- A completed demo video is **not** a delivered one. Since 2026-10-13 the video is an asset of the
  private repository's GitHub Release `demo-v1.0`, which only people with repository access can open.
  Final delivery to the interviewer is pending (H52, H51), and no audit has seen the video.

## Appendix: the ledger before reconciliation (superseded 2026-10-12, kept verbatim)

Kept unchanged so earlier references (for example C's "L1"–"L13") still resolve. It was written
without access to the reports, and it is superseded by the master matrix above. Known inaccuracies in
it, all corrected above or in the later-review tables: row 5's "now shown on every relationship
surface" (see D-P3a); "Development time: DOCUMENTED_LIMITATION" (see H40/H41); and "Items in the audit
reports not relayed … OPEN (unknown)" (the 17 rows above). Its "FIXED_AND_TESTED" for
`relationship-grounding.test.ts` relied on a whole-file failure at HEAD, which was an import failure
(H57). Its "Optional screen recording … Not produced" was true when written; the video was completed
on 2026-10-13 and has not been delivered (H52).

Two independent audits (by a separate AI reviewer, "Codex") were run on the submitted build, after
the author's own acceptance checks. This file records every finding I had and what became of it.

**Provenance and limit of this ledger.** It is built from the findings as they were relayed to the
implementing agent in two remediation requests. The audit reports themselves were not available to
that agent in full, so a finding that was only mentioned by category is listed by category and marked
as such. Nothing here claims the auditors have accepted a closure; that decision is theirs.

Status words: **FIXED_AND_TESTED** (a regression test that fails on the earlier code passes now),
**DOCUMENTED_LIMITATION** (accepted, stated in the README), **OPEN**, **REQUIRES_USER_DECISION**.

### Reproduced defects (former L1–L13)

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | LLM call deadline covered only the response headers; a stalled body held the single worker | FIXED_AND_TESTED | `llm-deadline.test.ts`: stalled body, stalled headers, retries, queue progress |
| 2 | Awaited body cancellation could hang the original error and the worker (`cancel()` never settles) | FIXED_AND_TESTED (corrected in 9D) | Same file: uncancellable declared-oversize, streamed-oversize, stalled body; 2 of its tests hang on the earlier code. 9D: a body-read timeout now cancels through the reader that holds the lock, so the stream's own cancel is reached (see P3-b below) |
| 3 | Oversized or endless response bodies | FIXED_AND_TESTED | 1 MiB cap; declared length and streamed cases |
| 4 | Relationship accepted with any predicate because its quote exists (audited `threatens` + invoice subject) | FIXED_AND_TESTED (structure) / DOCUMENTED_LIMITATION (meaning) | `relationship-grounding.test.ts`; meaning stays model-asserted and is flagged advisorily, `relationship-support.test.ts` |
| 5 | Negated threat, reversed threat, unrelated quote accepted | FIXED_AND_TESTED as *advisory flags* | Read-time heuristic marks "Check this quote"; nothing is claimed verified. 9D: the flag is now shown on every relationship surface (see P2 below) |
| 6 | Valid uncommon threats rejected by the English word list | FIXED_AND_TESTED | The list no longer removes anything; such a relationship is kept and flagged |
| 7 | Legacy stored analyses bypassed current relationship validation | FIXED_AND_TESTED | Structural rules apply on read; impossible ones are excluded and counted; stored data is never rewritten |
| 8 | Person merged because a model-supplied address appeared anywhere in the message | FIXED_AND_TESTED | `risk-identity-9b.test.ts` |
| 9 | Acme Inc. and Acme LLC merged | FIXED_AND_TESTED | Same file |
| 10 | Masked accounts merged on owner + last digits (within one message) | FIXED_AND_TESTED | Same file |
| 11 | Masked accounts merged across messages (checking vs savings ending 1234) | FIXED_AND_TESTED | `risk-account-identity.test.ts` (9 tests incl. order independence, E004/E009 account still aggregates) |
| 12 | One syntactically invalid stored JSON column took down list and graph | FIXED_AND_TESTED | `storage-corrupt.test.ts` |
| 13 | Valid JSON with the wrong structure (`attempts_json=[null]`, `[{}]`, `to_json=[null]`) crashed reads | FIXED_AND_TESTED (reporting completed in 9D) | Element-level schemas for runs, stages, addresses, warnings; 11 of the new tests crash without them. Until 9D, dropped email-column elements were not reported (see P3-a below) |

### Other findings and categories

| Area | Status | Disposition |
|---|---|---|
| Graph aggregation and source provenance | FIXED_AND_TESTED | `graph-aggregation.test.ts` (7); shared entities list every source; rules vs AI origin preserved |
| README overstated verification ("every finding has a verified quote") | FIXED_AND_TESTED (docs test) | README now separates proven, checked, advisory and model-asserted; wording "Quote found in message" |
| README promised uncertain identities always stay apart | FIXED | Now states they are heuristics and a wrong merge is possible |
| Recording provenance ("replay needs no key") | FIXED (completed in the 9D delta) | States that capturing needed the operator's Groq key; replaying needs none. The 9C fix missed a second README sentence ("none was used to produce what you see in replay mode"), which contradicted this; it was corrected in the 9D delta |
| "No authentication" presented as done | FIXED | Marked Exempt (scope exemption), not a completed feature |
| Implementation status vs independent verification | FIXED | Traceability states the distinction |
| Development time | DOCUMENTED_LIMITATION | Focused time not measured. Disclosed span and activity derived from timestamps, with the reason it is not focused time |
| Security and error handling (origin guard, error contract, secrets) | FIXED_AND_TESTED (earlier phases) / DOCUMENTED_LIMITATION | Origin guard tests; no authentication, a non-browser client is not restricted |
| Browser, mobile and accessibility confidence | DOCUMENTED_LIMITATION | Chromium/Edge only, emulated touch, own audit script, no axe, no screen reader |
| Real provider outage / 429 behaviour | DOCUMENTED_LIMITATION | Verified only against scripted responses |
| Detection accuracy | DOCUMENTED_LIMITATION | Never measured; no accuracy claim |
| English-only, small cue lists | DOCUMENTED_LIMITATION | Advisory only, never remove a relationship |
| Local models (Ollama) and OCR | DOCUMENTED_LIMITATION | Not implemented; not required by the brief |
| Reviewer access and handoff | REQUIRES_USER_DECISION | The repository is private; granting access and sending the submission is the operator's action |
| Optional screen recording | REQUIRES_USER_DECISION | Not produced |
| Items in the audit reports not relayed to the implementing agent | OPEN (unknown) | Cannot be classified without the reports |
