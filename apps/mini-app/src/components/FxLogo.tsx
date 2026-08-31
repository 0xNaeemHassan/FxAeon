'use client';

import { useId } from 'react';

/**
 * FxAeon logo mark — an inline SVG so it stays crisp at any size, paints with
 * no extra network request. The blue-to-coral face nods to f(x)'s official
 * spectrum without copying its mark, while the offset stroke gives FxAeon a
 * distinct, layered silhouette at small sizes.
 */

export function FxLogo({ size = 56, className = '' }: { size?: number; className?: string }) {
  // Multiple marks can coexist during transitions; unique SVG IDs prevent
  // one instance's gradient from being resolved against another instance.
  const id = `fxlogo-grad-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="FxAeon"
    >
      <defs>
        <linearGradient id={id} x1="14" y1="10" x2="50" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#62d8ff" />
          <stop offset="52%" stopColor="#6f86ff" />
          <stop offset="1" stopColor="#ff5a70" />
        </linearGradient>
      </defs>
      {/* ghost layer — a lighter, offset duplicate for the layered look */}
      <g
        stroke="#8ca5ff"
        strokeOpacity="0.34"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M27 17 L27 51" />
        <path d="M27 17 C27 14 29 13 33 13 L47 13" />
        <path d="M27 33 L43 33" />
      </g>
      {/* face layer — the gradient F */}
      <g
        stroke={`url(#${id})`}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M23 17 L23 51" />
        <path d="M23 17 C23 14 25 13 29 13 L43 13" />
        <path d="M23 33 L39 33" />
      </g>
    </svg>
  );
}

export default FxLogo;
