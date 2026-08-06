import { ModalShell } from "./ModalShell";

interface LoginModalProps {
  readonly isConnecting: boolean;
  readonly onLogin: () => void;
  /** Optional error surfaced from a failed session check / login attempt. */
  readonly error?: string;
}

/**
 * Blocking sign-in gate. Rendered whenever there is no authenticated user, so
 * the (otherwise dead) planner UI behind it cannot be interacted with. It has
 * no close affordance and no `onClose` — Escape and backdrop clicks do NOT
 * dismiss it. The only way forward is the awork OAuth login, which has the same
 * effect as the small sidebar login button.
 */
export function LoginModal({ isConnecting, onLogin, error }: LoginModalProps) {
  return (
    <ModalShell
      labelledBy="login-gate-title"
      dialogClassName="modal login-gate-modal"
    >
      <div className="login-gate">
        <p className="eyebrow">awork planner utility</p>
        <h2 id="login-gate-title">Bulk Planner</h2>
        <p className="login-gate-copy">Zum Starten mit awork anmelden.</p>

        <button
          type="button"
          className="primary-button login-gate-button"
          disabled={isConnecting}
          onClick={onLogin}
        >
          {isConnecting ? "Verbindung wird geprüft…" : "Mit awork anmelden"}
        </button>

        {error ? (
          <p className="login-gate-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </ModalShell>
  );
}
