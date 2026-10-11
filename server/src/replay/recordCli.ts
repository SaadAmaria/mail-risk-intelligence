import { fileURLToPath } from "node:url";
import { ExtractionSchemaVersion, RiskAnalysisSchemaVersion } from "@mri/shared";
import { PROMPT_VERSION } from "../analysis/service";
import { loadSeedFile, seedRecords } from "../ingestion/seed";
import { OpenAICompatClient } from "../llm/client";
import { loadLlmSettings } from "../llm/config";
import { MemoryRepository } from "../storage/memoryRepository";
import { describeExisting, recordFixtures } from "./recorder";

/**
 * Operator-run recorder.
 *   npm run record -w server -- [--ids E004,E009] [--out DIR] [--overwrite E004] [--attempt N]
 *
 * Dry run by default: it prints what WOULD be sent and what already exists, and exits without
 * any network operation. Transmission to the configured provider requires BOTH flags:
 *   --send --authorize-seed-transmission=<N>      (N must equal the number of emails listed)
 * It accepts seed emails only. The API key is never printed or written.
 *
 * An email that already has a recording is refused before any provider call. Repeating it
 * needs --overwrite <id>; the repeat is then recorded with its true attempt number. If the old
 * recording is unreadable, --attempt N must declare the number explicitly.
 */
const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};
const has = (name: string) => args.includes(`--${name}`);
const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

const seedPath = flag("seed") || process.env.SEED_PATH?.trim() || fileURLToPath(new URL("../../../mock_mailbox_data.json", import.meta.url));
const outDir = flag("out") || fileURLToPath(new URL("../../../fixtures/recorded", import.meta.url));
const idsArg = flag("ids");
const overwrite = list(flag("overwrite"));
const attemptRaw = flag("attempt");
const declaredAttempt = attemptRaw === null ? undefined : Number(attemptRaw);

const loaded = loadSeedFile(seedPath);
if (loaded.errors.length > 0) {
  console.error(`seed file has ${loaded.errors.length} invalid record(s); fix it before recording`);
  process.exit(1);
}
const wanted = idsArg ? list(idsArg) : loaded.records.map((r) => r.id);
const unknown = wanted.filter((id) => !loaded.records.some((r) => r.id === id));
if (unknown.length > 0) {
  console.error(`not seed email ids: ${unknown.join(", ")} (only seed emails can be recorded)`);
  process.exit(1);
}
if (declaredAttempt !== undefined && (!Number.isInteger(declaredAttempt) || declaredAttempt < 2 || overwrite.length === 0)) {
  console.error("--attempt must be an integer of 2 or more and is only meaningful together with --overwrite");
  process.exit(1);
}
const records = loaded.records.filter((r) => wanted.includes(r.id));
const bytes = records.reduce((n, r) => n + JSON.stringify(r).length, 0);

// What the output directory already holds, judged against the current messages and pipeline.
const reference = new MemoryRepository();
await seedRecords({ repo: reference }, { total: loaded.records.length, records: loaded.records, errors: [] });
const existing = describeExisting(outDir, {
  lookup: (id) => reference.getEmail(id),
  promptVersion: PROMPT_VERSION,
  extractionSchemaVersion: ExtractionSchemaVersion,
  riskSchemaVersion: RiskAnalysisSchemaVersion,
});

const settings = loadLlmSettings(process.env);
console.log("Recorded-fixture plan");
console.log(`  seed emails : ${records.length} (${records.map((r) => r.id).join(", ")})`);
console.log(`  content size: ~${Math.round(bytes / 1024)} KiB of email text would be sent`);
console.log(`  destination : ${settings.configured ? settings.host : "(no LLM configured)"}`);
console.log(`  model       : ${settings.configured ? settings.model : "(none)"}`);
console.log(`  output dir  : ${outDir}`);
if (existing.manifest === "unusable") {
  console.log(`  existing    : manifest is UNUSABLE (${existing.manifestReason}); a real run would refuse to proceed`);
} else if (existing.entries.length === 0) {
  console.log("  existing    : no recordings");
} else {
  for (const e of existing.entries) {
    console.log(
      e.ok
        ? `  existing    : ${e.email_id} valid (attempt ${e.fixture.capture.attempts_made})`
        : `  existing    : ${e.email_id} UNUSABLE (${e.reason})`,
    );
  }
}
const refused = records.filter((r) => existing.entries.some((e) => e.email_id === r.id) && !overwrite.includes(r.id));
for (const r of refused) console.log(`  would refuse: ${r.id} is already recorded (pass --overwrite ${r.id} to repeat it)`);

if (!has("send")) {
  console.log("DRY RUN: nothing was sent. Re-run with --send --authorize-seed-transmission=" + records.length + " to transmit.");
  process.exit(0);
}
if (flag("authorize-seed-transmission") !== String(records.length)) {
  console.error(`refused: --authorize-seed-transmission must equal ${records.length} (the number of emails listed above)`);
  process.exit(2);
}
if (!settings.configured || !settings.baseUrl || !settings.model) {
  console.error("refused: no usable LLM configuration (set LLM_BASE_URL, LLM_MODEL and LLM_API_KEY)");
  process.exit(2);
}

const client = OpenAICompatClient.fromSettings(settings);
const report = await recordFixtures({
  seed: loaded.records,
  ids: wanted,
  client,
  outDir,
  tool: "record-fixtures/2",
  providerHost: settings.host,
  requestedModel: settings.model,
  secrets: settings.apiKey ? [settings.apiKey] : [],
  overwrite,
  declaredAttempt,
});
for (const o of report.outcomes) {
  console.log(
    o.ok
      ? `  ok      ${o.id}  status=${o.status} calls=${o.calls} attempt=${o.attempt}${o.replaced ? " (replaced)" : ""}`
      : `  FAILED  ${o.id}  ${o.reason}`,
  );
}
for (const p of report.existingProblems) console.log(`  blocked ${p}`);
console.log(`kept: ${report.preserved.length} existing recording(s); written: ${report.written.length} file(s) to ${outDir}`);
process.exit(report.outcomes.every((o) => o.ok) ? 0 : 3);
