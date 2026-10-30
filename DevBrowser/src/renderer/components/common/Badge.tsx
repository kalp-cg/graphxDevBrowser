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
        return { bg: 'var(--accent-soft)', text: 'var(--accent)', border: 'transparent' };
      case 'success':
        return { bg: 'var(--accent-soft)', text: 'var(--accent)', border: 'transparent' };
      case 'warning':
        return { bg: 'var(--warn-soft)', text: 'var(--warn)', border: 'transparent' };
      case 'danger':
        return { bg: 'var(--danger-soft)', text: 'var(--danger)', border: 'transparent' };
      case 'demo':
        return { bg: 'var(--bg-tertiary)', text: 'var(--text-secondary)', border: 'var(--border-medium)' };
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
