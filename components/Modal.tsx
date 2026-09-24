"use client";
// Reusable modal — overlay + panel, closes on Escape or backdrop click.
// The data-entry layer's forms all render inside this.
import { useEffect, useState } from "react";

export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  // `.modal-overlay` is opacity:0 / pointer-events:none until `.show` is added;
  // flip it on the frame after mount so the fade-in transition plays and the
  // overlay becomes visible + clickable (the classic app does this in JS too).
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(id); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <div className={`modal-overlay${show ? " show" : ""}`} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? " modal--wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal__title">
          <span>{title}</span>
          <button type="button" className="btn btn--ghost btn--icon" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Small confirm dialog, so we never call window.confirm (which blocks).
export function ConfirmModal({ title, message, confirmLabel = "Delete", danger = true, onConfirm, onClose }: {
  title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="hint" style={{ margin: "4px 0 16px" }}>{message}</p>
      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button type="button" className={`btn ${danger ? "btn--danger" : "btn--primary"}`}
          onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
