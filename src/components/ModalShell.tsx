import { useEffect, useRef, type ReactNode } from "react";
import { motion } from "motion/react";

// Body-scroll lock shared by all open modals: the page behind a modal must
// not scroll; only the modal's own content does. A counter handles stacked
// modals (e.g. a confirmation on top of another dialog).
let openModalCount = 0;
let savedBodyOverflow = "";
let savedBodyPaddingRight = "";

function lockBodyScroll() {
  openModalCount += 1;
  if (openModalCount > 1) {
    return;
  }
  savedBodyOverflow = document.body.style.overflow;
  savedBodyPaddingRight = document.body.style.paddingRight;
  // Compensate the vanishing scrollbar so the layout doesn't jump.
  const scrollbarWidth =
    window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) {
    document.body.style.paddingRight = `${scrollbarWidth}px`;
  }
  document.body.style.overflow = "hidden";
}

function unlockBodyScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
    document.body.style.paddingRight = savedBodyPaddingRight;
  }
}

interface ModalShellProps {
  labelledBy: string;
  dialogClassName?: string;
  /** Escape schließt den Dialog. Weglassen, solange eine Aktion läuft. */
  onClose?: () => void;
  children: ReactNode;
}

export function ModalShell({ labelledBy, dialogClassName = "modal", onClose, children }: ModalShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    dialogRef.current?.focus();
    lockBodyScroll();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current?.();
      } else if (event.key === "Tab") {
        trapFocus(event, dialogRef.current);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      unlockBodyScroll();
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, []);

  return (
    <motion.div
      className="modal-backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        ref={dialogRef}
        className={dialogClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function trapFocus(event: KeyboardEvent, dialog: HTMLDivElement | null) {
  if (!dialog) {
    return;
  }

  const focusable = dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
