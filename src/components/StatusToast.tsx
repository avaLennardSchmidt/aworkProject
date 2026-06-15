import { useEffect } from "react";
import { motion } from "motion/react";

type ToastVariant = "success" | "error" | "info";

interface StatusToastProps {
  readonly message: string;
  readonly variant?: ToastVariant;
  readonly onDismiss: () => void;
  readonly autoDismissMs?: number;
}

const ICONS = {
  success: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 7.5l3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 6.5v4M7 4.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
};

export function StatusToast({
  message,
  variant = "success",
  onDismiss,
  autoDismissMs,
}: StatusToastProps) {
  useEffect(() => {
    if (!autoDismissMs) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [message, autoDismissMs, onDismiss]);

  return (
    <motion.div
      className={`status-toast status-toast--${variant}`}
      initial={{ opacity: 0, x: 48, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 36, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.75 }}
      layout
      role="alert"
      aria-live="assertive"
    >
      <span className="status-toast__icon" aria-hidden="true">
        {ICONS[variant]}
      </span>

      <p className="status-toast__message">{message}</p>

      <button
        type="button"
        className="status-toast__close"
        onClick={onDismiss}
        aria-label="Meldung schließen"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </button>

      {autoDismissMs ? (
        <div
          className="status-toast__progress"
          style={{ animationDuration: `${autoDismissMs}ms` }}
        />
      ) : null}
    </motion.div>
  );
}
