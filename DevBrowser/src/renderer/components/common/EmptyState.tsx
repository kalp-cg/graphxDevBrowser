import React from 'react';

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction
}) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 24px',
      textAlign: 'center',
      color: 'var(--text-secondary)',
      height: '100%',
      width: '100%'
    }}>
      <div style={{
        color: 'var(--text-muted)',
        background: 'var(--bg-tertiary)',
        padding: '16px',
        borderRadius: '50%',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {icon}
      </div>

      <h3 style={{
        fontSize: '15px',
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: '6px'
      }}>
        {title}
      </h3>

      <p style={{
        fontSize: '13px',
        color: 'var(--text-muted)',
        maxWidth: '420px',
        lineHeight: 1.5,
        marginBottom: actionLabel ? '16px' : '0'
      }}>
        {description}
      </p>

      {actionLabel && onAction && (
        <button
          onClick={onAction}
          style={{
            background: 'var(--accent-indigo)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            padding: '6px 16px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
          className="transition-smooth hover:opacity-90"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
