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
  const displayName = currentUser
    ? [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
      currentUser.email ||
      currentUser.id
    : "";

  return (
    <section className="panel connection-panel">
      <div>
        <p className="eyebrow">Connection</p>
        <h2>Connect your awork account</h2>
        <p className="section-copy">
          Sign in through awork OAuth. Tokens stay in the local backend, and the browser only receives a local session
          cookie.
        </p>
      </div>

      {!currentUser ? (
        <button type="button" className="primary-button connection-login-button" disabled={isConnecting} onClick={onLogin}>
          {isConnecting ? "Checking connection..." : "Sign in with awork"}
        </button>
      ) : null}

      {currentUser ? (
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

      <div className="alert alert-info">Only your own planned task schedules are shown and editable.</div>
      <div className="alert alert-warning">
        Do not use API keys from "API-Keys verwalten" for this workflow. This app uses OAuth so /users/me returns your
        own awork user.
      </div>
    </section>
  );
}
