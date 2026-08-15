"use client";

import { useEffect, useRef } from "react";

/**
 * Centred dialog with a scrollable body and a pinned footer, matching the
 * reservation and policy sheets.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  footer,
  children,
  width = "max-w-[640px]",
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    // Stop the page behind the dialog from scrolling with it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/25 p-4 py-10">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative flex max-h-[85vh] w-full ${width} flex-col rounded-xl border border-line bg-card shadow-xl outline-none`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description ? <p className="mt-1 text-[12px] text-ink-muted">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost rounded-md p-1 text-[16px] leading-none" aria-label="닫기">
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

/** Checkbox with a bold label and an explanatory paragraph underneath. */
export function CheckboxField({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        className="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {description ? <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/** Inline error strip used at the bottom of dialogs. */
export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-bad">{message}</p>
  );
}
