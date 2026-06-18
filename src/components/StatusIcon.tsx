import type { ReactElement } from "react";

/**
 * Renders an awork task-status icon: a circle coloured by the status `type`
 * with a white glyph inside, mirroring awork's own `task-status--full` markup.
 *
 * awork delivers the glyph name in `taskStatus.icon` (a Material-style ligature
 * name) but no colour — the colour is derived from `taskStatus.type`, exactly
 * as awork's UI does. We reproduce the glyphs as inline SVG so there is no icon
 * font / CDN dependency, matching the rest of this codebase.
 */

const STATUS_TYPE_COLOR: Record<string, string> = {
  todo: "#2f7ff0", // blue
  progress: "#f5b400", // yellow
  review: "#16b8c4", // turquoise
  stuck: "#ef5da8", // pink
  done: "#27c281", // green
};

const FALLBACK_COLOR = "#9aa5b1";

// 24x24 viewBox glyphs, rendered white via `fill="currentColor"`.
const ICON_GLYPHS: Record<string, ReactElement> = {
  search: (
    <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14z" />
  ),
  arrow_forward: (
    <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
  ),
  pause: <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />,
  done: <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />,
  circle_with_color: <circle cx="12" cy="12" r="5" />,
  circle_without_color: (
    <circle
      cx="12"
      cy="12"
      r="6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    />
  ),
};

interface StatusIconProps {
  icon?: string;
  type?: string;
  /** Accessible label, e.g. the status name. When omitted the icon is decorative. */
  title?: string;
}

export function StatusIcon({ icon, type, title }: StatusIconProps) {
  const color =
    (type && STATUS_TYPE_COLOR[type.trim().toLowerCase()]) || FALLBACK_COLOR;
  const glyph =
    (icon && ICON_GLYPHS[icon.trim()]) || ICON_GLYPHS.circle_with_color;

  return (
    <span
      className="status-icon"
      style={{ backgroundColor: color }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
        {glyph}
      </svg>
    </span>
  );
}
