import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { BackendClient } from "../services/backendClient";

interface BackendStartupBannerProps {
  readonly backendClient: BackendClient;
}

/**
 * Centered loading overlay shown over the content area whenever the backend is
 * spinning up (cold start). A large spinner with the status text below it —
 * unmistakable on every tab, while the sidebar stays visible.
 */
export function BackendStartupBanner({
  backendClient,
}: BackendStartupBannerProps) {
  const [status, setStatus] = useState<"ok" | "starting">("ok");

  useEffect(() => {
    const unsubscribe = backendClient.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });
    return unsubscribe;
  }, [backendClient]);

  return (
    <AnimatePresence>
      {status === "starting" ? (
        <motion.div
          className="backend-startup-overlay"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="backend-startup-overlay__card"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{
              type: "spring",
              stiffness: 420,
              damping: 34,
              mass: 0.75,
            }}
          >
            <span
              className="spinner backend-startup-overlay__spinner"
              aria-hidden="true"
            />
            <p className="backend-startup-overlay__message">
              Backend startet, bitte warten...
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
