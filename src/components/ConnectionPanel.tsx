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
            onClick={() => setIsExpanded((expanded) => !expanded)}
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
        <div className="connection-success">
          <div>
            <strong>Verbunden als {displayName}</strong>
            {currentUser.email ? <span>{currentUser.email}</span> : null}
            <span>Nutzer-ID: {currentUser.id}</span>
          </div>
          <button type="button" className="ghost-button" onClick={onDisconnect}>
            Trennen
          </button>
        </div>
      ) : null}

      {!isCollapsed ? <div className="alert alert-info">
        Planner-Aktionen nutzen den ausgewählten Planner-Nutzer. Die OAuth-Session bleibt mit dem verbundenen awork-Account verknüpft.
      </div> : null}
    </section>
  );
}
