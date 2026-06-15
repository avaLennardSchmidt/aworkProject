import { useState } from "react";
import type { AworkUser } from "../types/awork";

interface ConnectionPanelProps {
  readonly currentUser?: AworkUser;
  readonly isConnecting: boolean;
  readonly onLogin: () => void;
  readonly onDisconnect: () => void;
}

function getInitials(user: AworkUser): string {
  const parts = [user.firstName, user.lastName].filter(Boolean);
  if (parts.length > 0) return parts.map((p) => p![0]).join("").toUpperCase();
  return (user.email?.[0] ?? user.id[0] ?? "?").toUpperCase();
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
          <p className="eyebrow">Verbindung</p>
          <h2>{currentUser ? `Verbunden als ${displayName}` : "Mit awork verbinden"}</h2>
          {!isCollapsed ? (
            <p className="section-copy">
              Anmeldung über awork OAuth. Tokens bleiben im lokalen Backend, der
              Browser erhält nur ein lokales Session-Cookie.
            </p>
          ) : null}
        </div>
        {currentUser ? (
          <button
            type="button"
            className="ghost-button connection-toggle-button"
            onClick={() => setIsExpanded((e) => !e)}
          >
            {isExpanded ? "Einklappen" : "Verbindung anzeigen"}
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
          {isConnecting ? "Verbindung wird geprüft..." : "Mit awork anmelden"}
        </button>
      ) : null}

      {currentUser && !isCollapsed ? (
        <>
          <div className="connection-user">
            <span className="connection-avatar" aria-hidden="true">
              {getInitials(currentUser)}
            </span>
            <div className="connection-user-info">
              <strong>{displayName}</strong>
              {currentUser.email ? <span>{currentUser.email}</span> : null}
              <span className="connection-user-id">{currentUser.id}</span>
            </div>
            <button
              type="button"
              className="ghost-button connection-disconnect-btn"
              onClick={onDisconnect}
            >
              Trennen
            </button>
          </div>
          <p className="connection-note">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M7 6.5v3M7 4.5h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            Planner-Aktionen nutzen den ausgewählten Planner-Nutzer. Die
            OAuth-Session bleibt mit dem verbundenen awork-Account verknüpft.
          </p>
        </>
      ) : null}
    </section>
  );
}
