import type { JSX } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

// Section: Today — filled yellow star
export function StarIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.4l-5.81 3.06 1.11-6.47-4.7-4.58 6.5-.95L12 2.5z"
        fill="currentColor"
      />
    </svg>
  );
}

// Section: Upcoming — red calendar
export function CalendarIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16.5" rx="3" fill="currentColor" />
      <rect x="3" y="4.5" width="18" height="5" rx="3" fill="currentColor" opacity="0.55" />
      <rect x="7" y="2" width="2.4" height="5" rx="1.2" fill="currentColor" />
      <rect x="14.6" y="2" width="2.4" height="5" rx="1.2" fill="currentColor" />
      <rect x="6.5" y="12" width="3" height="3" rx="0.8" fill="#fff" />
      <rect x="14.5" y="12" width="3" height="3" rx="0.8" fill="#fff" />
    </svg>
  );
}

// Section: All tasks (Anytime) — teal layered stack
export function LayersIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l9 5-9 5-9-5 9-5z" fill="currentColor" />
      <path d="M3 12l9 5 9-5" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" opacity="0.55" />
      <path d="M3 16l9 5 9-5" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" opacity="0.35" />
    </svg>
  );
}

// Section: Logbook — green checkmark in circle
export function CheckCircleIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="currentColor" />
      <path
        d="M7.5 12.4l3 3 6-6.4"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Small white check used inside the round task checkbox
export function CheckMark({ size = 16 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.4l2.8 2.8L12.5 4.8"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlusIcon({ size = 28 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function TrashIcon({ size = 20 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0111 4h2a1.5 1.5 0 011.5 1.5V7m2 0l-.7 12a2 2 0 01-2 1.9H8.2a2 2 0 01-2-1.9L5.5 7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
