'use client';

/**
 * FxAeon logo mark — an inline SVG so it stays crisp at any size, paints with
 * no extra network request, and tints from the brand violet tokens. A clean
 * geometric "F" built from two overlapping rounded strokes (a lighter offset
 * ghost behind the gradient face) to give the layered depth in the brand mark.
 */

export function FxLogo({ size = 56, className = '' }: { size?: number; className?: string }) {
  const id = 'fxlogo-grad';
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
          <stop offset="0" stopColor="#A88BFF" />
          <stop offset="1" stopColor="#7C5CFF" />
        </linearGradient>
      </defs>
      {/* ghost layer — a lighter, offset duplicate for the layered look */}
      <g
        stroke="#A88BFF"
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
