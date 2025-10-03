export default function ErrorModal({ open, message, onClose }) {
  if (!open) return null;
  return (
    <div className="modal">
      <div className="modal-panel">
        <h3>Error</h3>
        <div style={{ margin: "8px 0 16px" }}>{message}</div>
        <div className="modal-actions">
          <button
            className="btn btn--primary"
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
