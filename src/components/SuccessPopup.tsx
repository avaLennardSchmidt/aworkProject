import { motion } from "motion/react";
import { ModalShell } from "./ModalShell";

interface SuccessPopupProps {
  title: string;
  message: string;
  detail?: string;
  onClose: () => void;
}

export function SuccessPopup({ title, message, detail, onClose }: SuccessPopupProps) {
  return (
    <ModalShell labelledBy="success-popup-title" dialogClassName="success-popup" onClose={onClose}>
      <motion.div
        className="success-badge"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 18 }}
      >
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <motion.path
            d="M4.5 12.5l5 5L19.5 7"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.35, delay: 0.15, ease: "easeOut" }}
          />
        </svg>
      </motion.div>
      <h2 id="success-popup-title">{title}</h2>
      <p>{message}</p>
      {detail ? <span>{detail}</span> : null}
      <button type="button" className="primary-button" onClick={onClose}>
        Schließen
      </button>
    </ModalShell>
  );
}
