import React from 'react';

/** The DevBrowser mark: three services around a watched node, one of them failing. Same drawing as build/icon.svg. */
export const Logo: React.FC<{ size?: number; title?: string }> = ({ size = 40, title = 'DevBrowser' }) => (
  <svg width={size} height={size} viewBox="196 196 632 640" role="img" aria-label={title} style={{ flexShrink: 0 }}>
    <rect x="196" y="196" width="632" height="640" rx="150" fill="var(--bg-tertiary)" />
    <circle cx="512" cy="540" r="250" fill="none" stroke="var(--accent)" strokeOpacity="0.25" strokeWidth="8" />
    <g strokeWidth="22" strokeLinecap="round" fill="none">
      <path d="M512 540 L338 392" stroke="var(--accent)" strokeOpacity="0.9" />
      <path d="M512 540 L694 392" stroke="var(--accent)" strokeOpacity="0.9" />
      <path d="M512 540 L512 740" stroke="var(--danger)" />
    </g>
    <circle cx="338" cy="392" r="52" fill="var(--accent)" />
    <circle cx="694" cy="392" r="52" fill="var(--text-primary)" />
    <circle cx="512" cy="740" r="52" fill="var(--danger)" />
    <circle cx="512" cy="540" r="78" fill="var(--text-primary)" />
    <circle cx="512" cy="540" r="30" fill="var(--bg-secondary)" />
  </svg>
);
