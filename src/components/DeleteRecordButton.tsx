import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export function DeleteRecordButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const locked = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const confirmationId = useId();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!confirming) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = previousOverflow; };
  }, [confirming]);

  useEffect(() => {
    if (busy) confirmationRef.current?.focus({ preventScroll: true });
  }, [busy]);

  const cancel = () => {
    if (locked.current) return;
    setConfirming(false);
    setError(null);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const handleDelete = async () => {
    if (locked.current || !confirming) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      setConfirming(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除失败，请重试");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={`delete-button${confirming ? " is-confirming" : ""}`}
      onClick={() => {
        if (confirming) cancel();
        else setConfirming(true);
      }}
      disabled={busy}
      aria-label={busy ? "删除中" : "删除"}
      aria-busy={busy}
      aria-expanded={confirming}
      aria-haspopup="dialog"
      aria-controls={confirming ? confirmationId : undefined}
    />
    {confirming && createPortal(
      <div
        className="record-delete-backdrop"
        onClick={(event) => {
          if (event.target === event.currentTarget) cancel();
        }}
      >
      <div
        ref={confirmationRef}
        id={confirmationId}
        className="record-delete-confirmation"
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={`${confirmationId}-title`}
        aria-describedby={`${confirmationId}-description`}
        aria-busy={busy}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            cancel();
          }
          if (event.key === "Tab") {
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (!first) {
              event.preventDefault();
              event.currentTarget.focus();
            } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="record-delete-heading">
          <span className="record-delete-icon" aria-hidden="true"><Icon name="trash" size={20} /></span>
          <div>
            <strong id={`${confirmationId}-title`}>删除这条记录？</strong>
            <p id={`${confirmationId}-description`}>移入回收站，可在设置中恢复。</p>
          </div>
        </div>
        {error && <span className="record-delete-error" role="alert">{error}</span>}
        <div className="record-delete-actions">
          <button ref={cancelRef} type="button" disabled={busy} onClick={cancel}>取消</button>
          <button type="button" className="record-delete-confirm" disabled={busy} onClick={() => void handleDelete()} aria-live="polite">
            {busy ? "正在移入…" : "移入回收站"}
          </button>
        </div>
      </div>
      </div>,
      document.body,
    )}
  </>;
}
