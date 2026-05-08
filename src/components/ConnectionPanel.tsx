import { useState } from "react";
import type { AworkUser } from "../types/awork";

interface ConnectionPanelProps {
  currentUser?: AworkUser;
  isConnecting: boolean;
  onLogin: () => void;
  onDisconnect: () => void;
}

export function ConnectionPanel({
  currentUser,
  isConnecting,
  onLogin,
  onDisconnect,
}: ConnectionPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const displayName = currentUser
    ? [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
      currentUser.email ||
      currentUser.id
    : "";
  const isCollapsed = Boolean(currentUser) && !isExpanded;

  return (
    <section className={`panel connection-panel ${isCollapsed ? "is-collapsed" : ""}`}>
      <div className="connection-heading">
        <div>
          <p className="eyebrow">Connection</p>
          <h2>{currentUser ? `Connected as ${displayName}` : "Connect your awork account"}</h2>
          {!isCollapsed ? (
            <p className="section-copy">
              Sign in through awork OAuth. Tokens stay in the local backend, and the
              browser only receives a local session cookie.
            </p>
          ) : null}
        </div>
        {currentUser ? (
          <button
            type="button"
            className="ghost-button connection-toggle-button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
          >
            {isExpanded ? "Collapse" : "Show connection"}
          </button>
        ) : null}
      </div>

      {!currentUser ? (
        <button
          type="button"
          className="primary-button connection-login-button"
          disabled={isConnecting}
          onClick={onLogin}
        >
          {isConnecting ? "Checking connection..." : "Sign in with awork"}
        </button>
      ) : null}

      {currentUser && !isCollapsed ? (
        <div className="connection-success">
          <div>
            <strong>Connected as {displayName}</strong>
            {currentUser.email ? <span>{currentUser.email}</span> : null}
            <span>User ID: {currentUser.id}</span>
          </div>
          <button type="button" className="ghost-button" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      ) : null}

      {!isCollapsed ? <div className="alert alert-info">
        Planner actions use the selected planner user. The OAuth session stays tied to the connected awork account.
      </div> : null}
    </section>
  );
}
