import React from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { useAppStore, type ToastMessage } from '../../store/useAppStore';

export const ToastContainer: React.FC = () => {
  const toasts = useAppStore(s => s.toasts);
  const removeToast = useAppStore(s => s.removeToast);

  if (toasts.length === 0) return null;

  const getIcon = (type: ToastMessage['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 size={16} color="var(--accent-emerald)" />;
      case 'warning':
        return <AlertTriangle size={16} color="var(--accent-amber)" />;
      case 'error':
        return <AlertCircle size={16} color="var(--accent-rose)" />;
      default:
        return <Info size={16} color="var(--accent-cyan)" />;
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '36px',
      right: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      zIndex: 9999,
      maxWidth: '380px',
      pointerEvents: 'none'
    }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="fade-in"
          style={{
            pointerEvents: 'auto',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            borderRadius: '8px',
            padding: '10px 14px',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px'
          }}
        >
          <div style={{ flexShrink: 0, marginTop: '2px' }}>
            {getIcon(toast.type)}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {toast.title}
            </div>
            {toast.message && (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {toast.message}
              </div>
            )}
          </div>

          <button
            onClick={() => removeToast(toast.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '2px',
              borderRadius: '4px'
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};
