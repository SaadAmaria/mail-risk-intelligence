import { useEffect, useState } from "react";
import type { CrossEmailFinding } from "@mri/shared";
import { api, isAbort } from "../api";

export interface EmailFinding {
  /** The message the finding is about (the later-dated one). */
  emailId: string;
  finding: CrossEmailFinding;
}

/**
 * Cross-email findings of the given messages, read from each message's own detail record (the
 * same data the email page shows). Read-only; a message that cannot be read simply contributes no
 * finding, and nothing is substituted for it.
 */
export function useEmailFindings(emailIds: string[]): EmailFinding[] {
  const key = emailIds.join(",");
  const [state, setState] = useState<{ key: string; findings: EmailFinding[] }>({ key: "", findings: [] });

  useEffect(() => {
    if (emailIds.length === 0) {
      setState({ key, findings: [] });
      return;
    }
    const ctrl = new AbortController();
    void Promise.allSettled(emailIds.map((id) => api.getEmail(id, ctrl.signal))).then((results) => {
      if (ctrl.signal.aborted) return;
      const findings: EmailFinding[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") for (const finding of r.value.risk.findings) findings.push({ emailId: emailIds[i]!, finding });
        else if (!isAbort(r.reason)) return;
      });
      setState({ key, findings });
    });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state.key === key ? state.findings : [];
}
