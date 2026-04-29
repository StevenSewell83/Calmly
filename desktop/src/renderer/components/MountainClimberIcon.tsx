// SVG paths kept faithful to GUI_draft.ts so the brand identity stays
// consistent across the app.

interface Props {
  className?: string;
}

export function MountainClimberIcon({ className }: Props) {
  return (
    <svg
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M26 130L80 34.5L134 130H26Z"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M60.5 69.5L80 34.5L99.5 69.5C93.5 72.5 87 66 80 72C73 66 66.5 72.5 60.5 69.5Z"
        fill="currentColor"
      />
      <g transform="translate(10, 5)">
        <circle cx="48" cy="80" r="5" fill="currentColor" />
        <path
          d="M48 85V105"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M62 65V105"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path d="M62 65L82 74L62 83V65Z" fill="currentColor" />
        <path
          d="M48 90L62 85"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M48 90L38 95"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M48 105L58 112"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M48 105L40 118"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
