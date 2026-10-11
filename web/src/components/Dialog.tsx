import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import s from "./Dialog.module.css";

/**
 * Modal built on the native <dialog>: focus is trapped, Esc closes it, the page behind is
 * inert, and focus returns to the opener. On narrow screens it is presented full-height.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement;
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
      // Prefer the first input over the close button, so typing can start at once.
      el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && el.open) {
      el.close();
      (opener.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      {open && (
        <div className={s.panel}>
          <header className={s.header}>
            <h2 id="dialog-title" className={s.title}>
              {title}
            </h2>
            <button type="button" className={s.close} onClick={onClose} aria-label="Close dialog">
              <Icon name="x" size={18} />
            </button>
          </header>
          <div className={s.body}>{children}</div>
        </div>
      )}
    </dialog>
  );
}
