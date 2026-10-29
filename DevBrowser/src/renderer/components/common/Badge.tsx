import React from 'react';

export interface BadgeProps {
  label: string;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'demo' | 'outline';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'neutral',
  size = 'sm',
  icon
}) => {
  const getColors = () => {
    switch (variant) {
      case 'primary':
        return { bg: 'rgba(6, 182, 212, 0.15)', text: 'var(--accent-cyan)', border: 'rgba(6, 182, 212, 0.3)' };
      case 'success':
        return { bg: 'rgba(16, 185, 129, 0.15)', text: 'var(--accent-emerald)', border: 'rgba(16, 185, 129, 0.3)' };
      case 'warning':
        return { bg: 'rgba(245, 158, 11, 0.15)', text: 'var(--accent-amber)', border: 'rgba(245, 158, 11, 0.3)' };
      case 'danger':
        return { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' };
      case 'demo':
        return { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.35)' };
      case 'outline':
        return { bg: 'transparent', text: 'var(--text-secondary)', border: 'var(--border-medium)' };
      default:
        return { bg: 'var(--bg-tertiary)', text: 'var(--text-secondary)', border: 'var(--border-subtle)' };
    }
  };

  const colors = getColors();

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        borderRadius: '9999px',
        padding: size === 'sm' ? '1px 7px' : '3px 10px',
        fontSize: size === 'sm' ? '11px' : '12px',
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.02em',
        lineHeight: 1.3
      }}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
};
