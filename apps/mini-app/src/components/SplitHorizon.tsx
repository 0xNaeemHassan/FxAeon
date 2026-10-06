import styles from './SplitHorizon.module.css';

// One period of a calm, wandering collateral line, drawn twice so a
// one-period drift loops without a seam (a sum of whole-period sines).
const LINE = 'M0 25C2 25 8 24.9 12 25.2C16 25.5 20 26.4 24 27C28 27.6 32 28.2 36 28.8C40 29.5 44 30 48 30.8C52 31.6 56 32.6 60 33.7C64 34.9 68 36.4 72 37.5C76 38.6 80 39.9 84 40.2C88 40.6 92 40.6 96 39.8C100 39.1 104 37.4 108 35.8C112 34.3 116 31.9 120 30.5C124 29.1 128 27.6 132 27.3C136 26.9 140 27.4 144 28.2C148 29.1 152 31 156 32.6C160 34.2 164 36.3 168 37.8C172 39.3 176 40.6 180 41.8C184 42.9 188 43.6 192 44.6C196 45.5 200 46.4 204 47.5C208 48.7 212 50.1 216 51.4C220 52.6 224 54.2 228 55.1C232 56 236 56.7 240 56.8C244 56.9 248 56.4 252 55.9C256 55.4 260 54.3 264 53.7C268 53 272 52.4 276 52.2C280 52 284 52.2 288 52.2C292 52.3 296 52.7 300 52.2C304 51.8 308 51.1 312 49.6C316 48.1 320 45.8 324 43.4C328 40.9 332 37.7 336 35.2C340 32.6 344 30 348 28.3C352 26.6 356 25.5 360 25C364 24.5 368 24.9 372 25.2C376 25.5 380 26.4 384 27C388 27.6 392 28.2 396 28.8C400 29.5 404 30 408 30.8C412 31.6 416 32.6 420 33.7C424 34.9 428 36.4 432 37.5C436 38.6 440 39.9 444 40.2C448 40.6 452 40.6 456 39.8C460 39.1 464 37.4 468 35.8C472 34.3 476 31.9 480 30.5C484 29.1 488 27.6 492 27.3C496 26.9 500 27.4 504 28.2C508 29.1 512 31 516 32.6C520 34.2 524 36.3 528 37.8C532 39.3 536 40.6 540 41.8C544 42.9 548 43.6 552 44.6C556 45.5 560 46.4 564 47.5C568 48.7 572 50.1 576 51.4C580 52.6 584 54.2 588 55.1C592 56 596 56.7 600 56.8C604 56.9 608 56.4 612 55.9C616 55.4 620 54.3 624 53.7C628 53 632 52.4 636 52.2C640 52 644 52.2 648 52.2C652 52.3 656 52.7 660 52.2C664 51.8 668 51.1 672 49.6C676 48.1 680 45.8 684 43.4C688 40.9 692 37.7 696 35.2C700 32.6 704 30 708 28.3C712 26.6 718 25.5 720 25';

/**
 * f(x) Protocol's split as a quiet, living horizon: a collateral line that
 * wanders with the market above a flat fxUSD floor, the band between them
 * being the leveraged share. Decorative. The drift is a compositor-only
 * transform on a double-width layer; reduced motion holds it still.
 */
export function SplitHorizon({ className = '' }: { className?: string }) {
  return <div className={`${styles.horizon} ${className}`} aria-hidden="true">
    <div className={styles.drift}>
      <svg viewBox="0 0 720 96" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id="split-horizon-share" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className={styles.shareTop} />
            <stop offset="1" className={styles.shareBottom} />
          </linearGradient>
        </defs>
        <path className={styles.share} d={`${LINE}V78H0Z`} />
        <path className={styles.line} d={LINE} />
      </svg>
    </div>
    <svg className={styles.floor} viewBox="0 0 360 96" preserveAspectRatio="none" focusable="false"><path d="M0 78H360" /></svg>
  </div>;
}
