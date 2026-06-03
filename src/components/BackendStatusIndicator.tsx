import { useEffect, useState } from "react";
import type { BackendClient } from "../services/backendClient";

interface BackendStatusIndicatorProps {
  backendClient: BackendClient;
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

  if (status === "ok") {
    return null;
  }

  return (
    <div className="backend-startup-indicator">
      <div className="spinner"></div>
      <p>Backend startet, bitte warten...</p>
    </div>
  );
}
