import { useEffect, useId, useRef, useState } from "react";
import { REPLAY_EXPLANATION } from "../lib/copy";
import { LLM_SETUP_GUIDE_URL } from "../lib/docs";
import s from "./ConnectionStatus.module.css";

interface Props {
  /** The classes of the header pill (shared with the other modes so the header looks identical). */
  pillClass: string;
  dotClass: string;
  fullClass: string;
  shortClass: string;
  text: string;
  short: string;
  title?: string;
  /** Replay mode only: the status opens a short explanation instead of being a bare label. */
  replay: boolean;
  guideUrl?: string | null;
}

/**
 * The header's AI status. In every mode it is the same pill. In recorded-replay mode it is a
 * disclosure: its explanation is always available to assistive technology, and can be opened to see
 * how to connect a live model. The setup guide is a link only when a real target exists.
 */
export function ConnectionStatus({ pillClass, dotClass, fullClass, shortClass, text, short, title, replay, guideUrl = LLM_SETUP_GUIDE_URL }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const descId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const pillInner = (
    <>
      <span className={dotClass} aria-hidden="true" />
      <span className={fullClass}>{text}</span>
      <span className={shortClass}>{short}</span>
    </>
  );

  if (!replay) {
    return (
      <span className={pillClass} title={title}>
        {pillInner}
      </span>
    );
  }

  return (
    <div className={s.root} ref={root}>
      <button
        type="button"
        className={`${pillClass} ${s.pillButton}`}
        aria-label={text}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={descId}
        title={title}
        onClick={() => setOpen(!open)}
      >
        {pillInner}
        <span className={s.caret} aria-hidden="true" />
      </button>
      <span id={descId} className="sr-only">
        {REPLAY_EXPLANATION}
      </span>
      {open && (
        <div id={panelId} className={s.panel} role="region" aria-label="About Recorded AI Replay">
          <p className={s.lead}>{REPLAY_EXPLANATION}</p>
          <div className={s.divider} />
          <p className={s.heading}>Want to connect a live LLM?</p>
          <p className={s.body}>Follow the project setup guide to configure live AI analysis.</p>
          {guideUrl ? (
            <a className={s.guideLink} href={guideUrl} target="_blank" rel="noreferrer">
              View LLM Setup Guide
            </a>
          ) : (
            <>
              <span className={s.guideOff} aria-disabled="true" data-testid="llm-guide-unavailable">
                View LLM Setup Guide
              </span>
              <p className={s.note}>Not linked yet: the setup guide will be part of the project README.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
