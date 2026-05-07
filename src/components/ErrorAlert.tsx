interface ErrorAlertProps {
  message?: string;
}

export function ErrorAlert({ message }: ErrorAlertProps) {
  if (!message) {
    return null;
  }

  return <div className="alert alert-error">{message}</div>;
}
