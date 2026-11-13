/** Logo: a face frame (four corners) with a clock face inside - "who, and when". */
export function BrandMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill="var(--brand)" />
      <path d="M8 12V9.5A1.5 1.5 0 0 1 9.5 8H12M20 8h2.5A1.5 1.5 0 0 1 24 9.5V12M24 20v2.5a1.5 1.5 0 0 1-1.5 1.5H20M12 24H9.5A1.5 1.5 0 0 1 8 22.5V20" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="16" r="4.6" stroke="#fff" strokeWidth="1.6" />
      <path d="M16 13.6V16l1.7 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
