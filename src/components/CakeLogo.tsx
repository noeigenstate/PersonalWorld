// The brand mark: a small birthday cake with a face — two tiers, a striped candle, sprinkles
export function CakeLogo({ size = 22 }: { size?: number }) {
  return (
    <svg className="cake-logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {/* plate */}
      <ellipse cx="12" cy="21" rx="9.5" ry="1.6" fill="#cfe3f5" />
      {/* bottom tier, pink */}
      <rect x="4" y="12.2" width="16" height="8" rx="2.6" fill="#ffc7d6" />
      {/* icing drips over the bottom tier */}
      <path d="M4 13.6c1.3 0 1.3 1.6 2.6 1.6s1.3-1.6 2.7-1.6 1.3 1.6 2.7 1.6 1.3-1.6 2.7-1.6 1.3 1.6 2.6 1.6 1.4-1.6 2.7-1.6V12.2H4z" fill="#ff8fab" />
      {/* top tier, cream */}
      <rect x="6.3" y="8" width="11.4" height="5" rx="2.1" fill="#fff0c9" />
      <path d="M6.3 9.4c1 0 1 1.1 2 1.1s1-1.1 2-1.1 1 1.1 2 1.1 1-1.1 2-1.1 1 1.1 2 1.1 .9-1.1 1.4-1.1V8H6.3z" fill="#ffd166" />
      {/* sprinkles */}
      <circle cx="8.6" cy="11.6" r=".55" fill="#7ec8ff" />
      <circle cx="12" cy="12.1" r=".55" fill="#9be28a" />
      <circle cx="15.3" cy="11.5" r=".55" fill="#ff8fab" />
      {/* candle with a flame */}
      <rect x="11.15" y="3.6" width="1.7" height="4.8" rx=".7" fill="#7ec8ff" />
      <rect x="11.15" y="5" width="1.7" height=".9" fill="#ffffff" opacity=".8" />
      <rect x="11.15" y="6.8" width="1.7" height=".9" fill="#ffffff" opacity=".8" />
      <path d="M12 1.2c1 1.1 1.5 1.9 1.5 2.7a1.5 1.5 0 0 1-3 0c0-.8.5-1.6 1.5-2.7z" fill="#ffb74d" />
      <path d="M12 2.6c.45.55.7.95.7 1.35a.7.7 0 0 1-1.4 0c0-.4.25-.8.7-1.35z" fill="#fff3b0" />
      {/* the face */}
      <circle cx="9.6" cy="16.6" r=".6" fill="#5b4a3f" />
      <circle cx="14.4" cy="16.6" r=".6" fill="#5b4a3f" />
      <path d="M10.7 18.1q1.3 1 2.6 0" stroke="#5b4a3f" strokeWidth=".8" strokeLinecap="round" fill="none" />
      <circle cx="7.6" cy="17.6" r=".8" fill="#ff8fab" opacity=".7" />
      <circle cx="16.4" cy="17.6" r=".8" fill="#ff8fab" opacity=".7" />
    </svg>
  )
}
