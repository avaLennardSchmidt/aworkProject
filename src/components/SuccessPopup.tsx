interface SuccessPopupProps {
  title: string;
  message: string;
  detail?: string;
  onClose: () => void;
}

export function SuccessPopup({ title, message, detail, onClose }: SuccessPopupProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="success-popup" role="dialog" aria-modal="true" aria-labelledby="success-popup-title">
        <div className="success-badge">BÄM</div>
        <h2 id="success-popup-title">{title}</h2>
        <p>{message}</p>
        {detail ? <span>{detail}</span> : null}
        <button type="button" className="primary-button" onClick={onClose}>
          Nice
        </button>
      </section>
    </div>
  );
}
