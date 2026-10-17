/** The family leaf: the app's icon as it's drawn for small sizes
 *  (`desktop/icon-small.svg`), without its tile, beside the name in the top bar. Its veins are
 *  cut in the bar's own white. */
export function LeafMark({ className }: { className?: string }) {
  return (
    <svg viewBox="290 168 466 688" className={className} aria-hidden="true" focusable="false">
      <g transform="translate(512 512) rotate(-18) scale(0.94) translate(-512 -506)">
        <path
          d="M512 128 C712 236 806 470 714 690 C662 806 586 860 512 884 C448 846 370 786 322 676 C240 486 318 250 512 128 Z"
          fill="#059669"
        />
        <path
          d="M512 860 C506 700 506 450 526 280 M510 690 C474 652 438 626 398 606 M512 470 C550 438 588 414 628 396"
          stroke="#ffffff"
          strokeWidth={64}
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  );
}
