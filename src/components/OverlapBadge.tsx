import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import type { AworkTaskSchedule } from "../types/awork";

const MAX_LISTED_OVERLAPS = 6;
const GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * "Überschneidung mit N Blockern" badge with a hover/focus tooltip that lists
 * WHICH blockers overlap (time, task, project). Used in every preview that
 * warns about overlaps.
 *
 * The tooltip is rendered in a document-level portal with fixed positioning so
 * it is never clipped by a scrollable/overflow-hidden ancestor (preview modal,
 * schedule row) — it always shows in full regardless of the parent's size.
 */
export function OverlapBadge({ overlaps }: { overlaps: AworkTaskSchedule[] }) {
  const badgeRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Position the fixed tooltip relative to the badge, flipping above and
  // clamping to the viewport so it never renders off-screen. Recomputed while
  // open so scrolling keeps it anchored.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function place() {
      const badge = badgeRef.current;
      const tooltip = tooltipRef.current;
      if (!badge || !tooltip) {
        return;
      }
      const b = badge.getBoundingClientRect();
      const t = tooltip.getBoundingClientRect();

      let left = b.left;
      left = Math.min(left, window.innerWidth - t.width - VIEWPORT_MARGIN);
      left = Math.max(VIEWPORT_MARGIN, left);

      let top = b.bottom + GAP;
      if (top + t.height > window.innerHeight - VIEWPORT_MARGIN) {
        const above = b.top - GAP - t.height;
        if (above >= VIEWPORT_MARGIN) {
          top = above;
        }
      }

      setPos({ left, top });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  if (overlaps.length === 0) {
    return null;
  }

  const listed = overlaps.slice(0, MAX_LISTED_OVERLAPS);

  return (
    <em
      ref={badgeRef}
      className="warning-badge overlap-badge"
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      Überschneidung mit {overlaps.length} Blocker
      {overlaps.length === 1 ? "" : "n"}
      {open
        ? createPortal(
            <span
              ref={tooltipRef}
              className="overlap-badge-tooltip"
              role="tooltip"
              style={{
                left: pos ? `${pos.left}px` : 0,
                top: pos ? `${pos.top}px` : 0,
                visibility: pos ? "visible" : "hidden",
              }}
            >
              <strong>Überschneidet sich mit:</strong>
              {listed.map((schedule) => (
                <span key={schedule.id} className="overlap-badge-tooltip-row">
                  {formatOverlapTime(schedule)} · {schedule.taskName ?? "Blocker"}
                  {schedule.projectName ? ` (${schedule.projectName})` : ""}
                </span>
              ))}
              {overlaps.length > listed.length ? (
                <span className="overlap-badge-tooltip-row">
                  + {overlaps.length - listed.length} weitere
                </span>
              ) : null}
            </span>,
            document.body,
          )
        : null}
    </em>
  );
}

function formatOverlapTime(schedule: AworkTaskSchedule): string {
  try {
    const start = parseISO(schedule.start);
    const end = parseISO(schedule.end);
    return `${format(start, "dd.MM.")} ${format(start, "HH:mm")}–${format(end, "HH:mm")}`;
  } catch {
    return "";
  }
}
