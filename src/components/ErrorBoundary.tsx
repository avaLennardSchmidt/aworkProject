import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Overrides the generic headline, e.g. for a page-scoped boundary. */
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors below it so a single crashing component doesn't
 * white-screen the whole app. Mounted globally in main.tsx and additionally
 * around high-risk subtrees (Kapazität).
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[error-boundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="error-boundary" role="alert">
        <h2>{this.props.fallbackTitle ?? "Etwas ist schiefgelaufen."}</h2>
        <p>Die Anwendung ist auf einen unerwarteten Fehler gestoßen.</p>
        <button
          type="button"
          className="primary-button"
          onClick={() => window.location.reload()}
        >
          Seite neu laden
        </button>
        <details className="error-boundary-details">
          <summary>Technische Details</summary>
          <pre>{this.state.error.message}</pre>
        </details>
      </div>
    );
  }
}
