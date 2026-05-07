interface LoadingStateProps {
  label: string;
}

export function LoadingState({ label }: LoadingStateProps) {
  return (
    <div className="loading-state" aria-live="polite">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}
