/** Compact stroke icons for the editor toolbar (24px grid, currentColor). */

export type IconName =
  | 'select'
  | 'border'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'highlight'
  | 'blur'
  | 'mosaic'
  | 'text'
  | 'callout'
  | 'badge'
  | 'crop'
  | 'undo'
  | 'redo'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'copy'
  | 'save'
  | 'trash'
  | 'fill'

const PATHS: Record<IconName, JSX.Element> = {
  select: <path d="M5 3l14 8-6 2-3 6z" />,
  border: <rect x="4" y="5" width="16" height="14" rx="3" strokeDasharray="4 2" />,
  rect: <rect x="4" y="5" width="16" height="14" rx="1" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  arrow: (
    <>
      <path d="M5 19L19 5" />
      <path d="M11 5h8v8" />
    </>
  ),
  line: <path d="M5 19L19 5" />,
  pen: <path d="M4 20c4-8 6-9 9-6s5 1 7-6" />,
  highlight: (
    <>
      <path d="M4 20h7" />
      <path d="M9 15l9-9 3 3-9 9H9z" />
    </>
  ),
  blur: <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />,
  mosaic: (
    <>
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <rect x="14" y="14" width="6" height="6" />
    </>
  ),
  text: (
    <>
      <path d="M5 6h14" />
      <path d="M12 6v13" />
    </>
  ),
  callout: <path d="M4 5h16v10H10l-5 4v-4H4z" />,
  badge: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M11 9l2-1v8" />
    </>
  ),
  crop: (
    <>
      <path d="M7 3v14h14" />
      <path d="M3 7h14v14" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  redo: (
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-5-5" />
      <path d="M11 8v6M8 11h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-5-5" />
      <path d="M8 11h6" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5h10" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h7V4" />
      <rect x="8" y="13" width="8" height="7" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </>
  ),
  fill: (
    <>
      <path d="M6 12l7-7 6 6-7 7z" />
      <path d="M5 12h9" />
      <path d="M19 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z" />
    </>
  )
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
