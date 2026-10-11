/**
 * Extract one JSON value from model output. Tolerates a code fence or stray prose around a
 * single object, but never "repairs" content: if no valid JSON object can be parsed, it throws
 * and the caller treats the output as malformed.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("empty output");

  const attempts: string[] = [trimmed];
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced) attempts.push(fenced[1]!);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) attempts.push(trimmed.slice(first, last + 1));

  let lastError: unknown = null;
  for (const candidate of attempts) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
      lastError = new Error("output is not a JSON object");
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`output is not valid JSON (${lastError instanceof Error ? lastError.message.slice(0, 80) : "parse error"})`);
}
