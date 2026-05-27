import { useNotificationStore } from "../store/useNotificationStore";

export function ToastContainer() {
  const { items, dismiss } = useNotificationStore();

  if (items.length === 0) return null;

  return (
    <div className="toast-container">
      {items.map((n) => (
        <div key={n.id} className={`toast toast--${n.type}`}>
          <span className="toast__msg">{n.message}</span>
          <button className="toast__close" onClick={() => dismiss(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
