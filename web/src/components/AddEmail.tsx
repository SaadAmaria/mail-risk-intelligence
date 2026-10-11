import { useRef, useState, type FormEvent } from "react";
import type { IngestResponse } from "@mri/shared";
import { ApiRequestError, api } from "../lib/api";
import { errorMessage } from "../lib/copy";
import { Icon } from "./Icon";
import { Button, Callout } from "./ui";
import s from "./AddEmail.module.css";

type Mode = "paste" | "file";

/**
 * Adds one message. Storing is separate from analyzing: the "Analyze with AI" box is OFF by
 * default, so adding a message never sends anything to the AI unless the user ticks it.
 */
export function AddEmail({
  aiConfigured,
  replayAvailable = false,
  onDone,
  onCancel,
}: {
  aiConfigured: boolean;
  /** Recorded demo analyses exist (no live provider). */
  replayAvailable?: boolean;
  onDone: (result: IngestResponse) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [analyze, setAnalyze] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const ready = mode === "paste" ? text.trim().length > 0 : file !== null;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const wantAi = analyze && aiConfigured;
      const result = mode === "paste" ? await api.addPaste(text, wantAi) : await api.addFile(file!, wantAi);
      onDone(result);
    } catch (err) {
      const e = err instanceof ApiRequestError ? err : null;
      setError(errorMessage(e?.code ?? "network_error", e?.message ?? "Could not add this message."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={s.form} onSubmit={submit} noValidate>
      <div className={s.modes} role="group" aria-label="How to add">
        <button type="button" className={s.mode} aria-pressed={mode === "paste"} onClick={() => setMode("paste")}>
          <Icon name="quote" size={16} /> Paste text
        </button>
        <button type="button" className={s.mode} aria-pressed={mode === "file"} onClick={() => setMode("file")}>
          <Icon name="upload" size={16} /> Upload file
        </button>
      </div>

      {mode === "paste" ? (
        <div className={s.field}>
          <label className={s.label} htmlFor="paste-text">
            Email text
          </label>
          <textarea
            id="paste-text"
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={"From: sender@example.com\nTo: you@example.com\nSubject: …\nDate: …\n\nMessage text"}
            spellCheck={false}
            aria-describedby="paste-hint"
          />
          <span id="paste-hint" className={s.hint}>
            Headers are optional. Anything missing is shown as missing, never filled in.
          </span>
        </div>
      ) : (
        <div className={s.field}>
          <span className={s.label} id="file-label">
            File
          </span>
          <div className={s.fileRow}>
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.eml,.pdf"
              aria-labelledby="file-label"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <span className={s.hint}>.txt, .eml or .pdf. PDFs need a text layer; scanned images are not supported.</span>
        </div>
      )}

      <div className={s.check}>
        <input
          id="analyze-box"
          type="checkbox"
          checked={analyze && aiConfigured}
          disabled={!aiConfigured}
          onChange={(e) => setAnalyze(e.target.checked)}
          aria-describedby="analyze-hint"
        />
        <span>
          <label htmlFor="analyze-box">
            <strong>Analyze with AI after adding</strong>
          </label>
          <span id="analyze-hint" className={s.hint}>
            {aiConfigured
              ? "Sends this message's text to the configured AI service. Leave unticked to only store it."
              : replayAvailable
                ? "No AI provider is configured. Only seeded messages have recordings; an added message gets automatic checks only."
                : "AI is not configured on this server, so only automatic checks will be shown."}
          </span>
        </span>
      </div>

      {error && (
        <Callout tone="bad" icon="alert-circle" role="alert" title="This could not be added">
          <p>{error}</p>
        </Callout>
      )}

      <div className={s.actions}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" busy={busy} disabled={!ready}>
          Add email
        </Button>
      </div>
    </form>
  );
}
