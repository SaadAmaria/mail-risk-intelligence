import { useEffect, useState } from "react";
import { HealthResponse, RISK_LEVELS } from "@mri/shared";

// Phase 0 placeholder: proves the web -> proxy -> server -> shared-contract wiring.
export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((json) => setHealth(HealthResponse.parse(json)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main>
      <h1>Mail Risk Intelligence</h1>
      <p>Phase 0 scaffold. Risk levels: {RISK_LEVELS.join(", ")}.</p>
      {error && <p role="alert">API unreachable: {error}</p>}
      {health && <p>API status: {health.status}</p>}
    </main>
  );
}
