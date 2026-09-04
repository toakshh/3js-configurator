"use client";

import { useEffect, useRef, createContext, useContext, useState, useCallback, ReactNode } from "react";
import { createPortal } from "react-dom";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DialogOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  details?: string;
}

interface DialogState extends DialogOptions {
  resolve: (confirmed: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (opts: DialogOptions) => Promise<boolean>;
  alert: (opts: Omit<DialogOptions, "cancelLabel">) => Promise<void>;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const confirm = useCallback((opts: DialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialog({ ...opts, resolve });
    });
  }, []);

  const alertFn = useCallback(
    (opts: Omit<DialogOptions, "cancelLabel">): Promise<void> => {
      return new Promise((resolve) => {
        setDialog({
          ...opts,
          confirmLabel: opts.confirmLabel ?? "OK",
          cancelLabel: undefined,
          resolve: () => resolve(),
        });
      });
    },
    []
  );

  const close = useCallback(
    (confirmed: boolean) => {
      dialog?.resolve(confirmed);
      setDialog(null);
    },
    [dialog]
  );

  return (
    <ConfirmContext.Provider value={{ confirm, alert: alertFn }}>
      {children}
      {dialog && <ConfirmDialog dialog={dialog} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

// ─── Dialog UI ───────────────────────────────────────────────────────────────

const ICON: Record<string, ReactNode> = {
  danger: (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  warning: (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-yellow-400">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  info: (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

const CONFIRM_COLOR: Record<string, string> = {
  danger: "bg-red-500/90 hover:bg-red-400 text-white shadow-red-500/20",
  warning: "bg-yellow-500/90 hover:bg-yellow-400 text-black shadow-yellow-500/20",
  info: "bg-[#5b6ef5] hover:bg-[#6b7eff] text-white shadow-[#5b6ef5]/20",
};

function ConfirmDialog({
  dialog,
  onClose,
}: {
  dialog: DialogState;
  onClose: (confirmed: boolean) => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const variant = dialog.variant ?? "info";
  const hasCancel = !!dialog.cancelLabel || dialog.cancelLabel !== undefined
    ? !!dialog.cancelLabel
    : true;  // default: show cancel unless cancelLabel was explicitly set to undefined (alert mode)

  // Actually for alert mode we pass cancelLabel = undefined from the provider
  const showCancel = dialog.cancelLabel !== undefined;

  // Auto-focus confirm button
  useEffect(() => {
    const t = setTimeout(() => {
      (variant === "danger" ? cancelRef : confirmRef).current?.focus();
    }, 40);
    return () => clearTimeout(t);
  }, [variant]);

  // Keyboard handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
      if (e.key === "Enter") {
        e.preventDefault();
        onClose(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const content = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center"
      style={{ backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", background: "rgba(8,10,24,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(false); }}
    >
      <div
        className="relative w-[400px] max-w-[calc(100vw-32px)] rounded-2xl border border-[#2a2f52] bg-[#0f1220] shadow-2xl shadow-black/60 animate-in"
        style={{ animation: "dlg-in 0.18s cubic-bezier(.22,.68,0,1.2) both" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <div className="mt-0.5 shrink-0">
            {ICON[variant]}
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="dlg-title" className="text-[15px] font-semibold text-[#d4d8f0] leading-snug">
              {dialog.title}
            </h2>
            {dialog.message && (
              <p className="mt-1.5 text-[12.5px] text-[#6a718a] leading-relaxed">
                {dialog.message}
              </p>
            )}
            {dialog.details && (
              <div className="mt-2.5 px-3 py-2 rounded-lg bg-[#080a18] border border-[#1a1f38] text-[11px] text-[#4a5070] font-mono break-all">
                {dialog.details}
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-[#1a1f38] mx-0" />

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-6 py-4">
          {showCancel && (
            <button
              ref={cancelRef}
              onClick={() => onClose(false)}
              className="px-4 py-2 rounded-lg text-[12px] font-medium text-[#5a6080] hover:text-[#9098b8] bg-transparent hover:bg-[#1a1f38] border border-[#1e2440] hover:border-[#2e3462] transition-all outline-none focus:border-[#5b6ef5]"
            >
              {dialog.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            ref={confirmRef}
            onClick={() => onClose(true)}
            className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-all shadow-lg outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-[#0f1220] ${CONFIRM_COLOR[variant]}`}
          >
            {dialog.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
