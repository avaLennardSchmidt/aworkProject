import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { BackendClient } from "../services/backendClient";

interface BackendStatusIndicatorProps {
  readonly backendClient: BackendClient;
}

export function BackendStatusIndicator({
  backendClient,
}: BackendStatusIndicatorProps) {
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
          className="status-toast status-toast--info"
          initial={{ opacity: 0, x: 48, scale: 0.94 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 36, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.75 }}
          layout
        >
          <span className="status-toast__icon" aria-hidden="true">
            <span className="spinner status-toast__spinner" />
          </span>
          <p className="status-toast__message">Backend startet, bitte warten...</p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
