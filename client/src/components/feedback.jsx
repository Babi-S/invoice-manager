import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal } from './ui.jsx';
import { Icon } from './Icons.jsx';

const ToastContext = createContext(() => {});
const ConfirmContext = createContext(async () => false);

export const useToast = () => useContext(ToastContext);
export const useConfirm = () => useContext(ConfirmContext);

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const resolver = useRef(null);
  const nextId = useRef(0);

  const toast = useCallback((message, type = 'success') => {
    const id = ++nextId.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setDialog(typeof options === 'string' ? { message: options } : options);
      }),
    [],
  );

  const close = (result) => {
    resolver.current?.(result);
    resolver.current = null;
    setDialog(null);
  };

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        {dialog && (
          <Modal
            title={dialog.title || 'Are you sure?'}
            onClose={() => close(false)}
            width={440}
            footer={
              <>
                <button className="btn" onClick={() => close(false)}>
                  Cancel
                </button>
                <button className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>
                  {dialog.confirmLabel || 'Confirm'}
                </button>
              </>
            }
          >
            <p className="dialog-text">{dialog.message}</p>
          </Modal>
        )}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <Icon name={t.type === 'error' ? 'alert' : 'check'} />
              {t.message}
            </div>
          ))}
        </div>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}
