import { motion } from "motion/react";
import { ModalShell } from "./ModalShell";

/**
 * "What's New" announcement for the project/task detail modals. Auto-shown once
 * per user (gated by App via the feature-seen mechanism); the "Alles klar!"
 * button acknowledges it so it never appears again. Closing via X/Escape only
 * hides it for this session.
 */
interface DetailModalsAnnouncementProps {
  open: boolean;
  onDismiss: () => void;
  onClose: () => void;
}

const copyContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.12 } },
} as const;

const copyItem = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 420, damping: 34, mass: 0.75 },
  },
} as const;

export function DetailModalsAnnouncement({
  open,
  onDismiss,
  onClose,
}: DetailModalsAnnouncementProps) {
  if (!open) {
    return null;
  }

  return (
    <ModalShell
      labelledBy="detail-announcement-title"
      dialogClassName="modal feature-announcement-modal"
      onClose={onClose}
    >
      <div className="modal-header feature-announcement-header">
        <div className="feature-announcement-heading">
          <span className="feature-announcement-icon" aria-hidden="true">
            <SparklesIcon />
          </span>
          <div>
            <p className="eyebrow">Neu</p>
            <h2 id="detail-announcement-title">
              Mehr Details zu Projekten &amp; Aufgaben
            </h2>
          </div>
        </div>
        <button
          type="button"
          className="ghost-button feature-announcement-close"
          onClick={onClose}
          aria-label="Popup schließen"
        >
          ×
        </button>
      </div>

      <motion.div
        className="feature-announcement-copy"
        variants={copyContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.p className="release-notes-intro" variants={copyItem}>
          Ab sofort siehst du alle Infos aus awork direkt hier im Tool – und
          öffnest ein Projekt oder eine Aufgabe mit nur einem Klick in awork.
        </motion.p>

        <motion.p
          className="feature-path feature-path--standalone"
          variants={copyItem}
        >
          <strong>Das funktioniert an diesen Stellen:</strong>
        </motion.p>

        <ul className="feature-steps">
          <motion.li variants={copyItem}>
            <strong>Projekt- &amp; Aufgaben-Auswahl:</strong> in den Dropdowns
            auf das ⓘ-Symbol neben einem Eintrag klicken.
          </motion.li>
          <motion.li variants={copyItem}>
            <strong>Kapazitätsanalyse:</strong> im Balken einer Person direkt
            auf den Projekt-Balken klicken.
          </motion.li>
          <motion.li variants={copyItem}>
            <strong>Projekt einplanen:</strong> direkt auf den Namen einer
            Aufgabe klicken, um sie zu öffnen.
          </motion.li>
        </ul>

        <motion.p className="feature-callout" variants={copyItem}>
          <strong>Probier es gleich aus!</strong> Ein Klick genügt.
        </motion.p>
      </motion.div>

      <div className="modal-actions">
        <button type="button" className="primary-button" onClick={onDismiss}>
          Alles klar!
        </button>
      </div>
    </ModalShell>
  );
}

function SparklesIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
      <path d="M19 14l.8 1.9 1.9.8-1.9.8L19 19.4l-.8-1.9-1.9-.8 1.9-.8L19 14z" />
      <path d="M5 14l.7 1.6 1.6.7-1.6.7L5 18.6l-.7-1.6L2.7 16.3l1.6-.7L5 14z" />
    </svg>
  );
}
