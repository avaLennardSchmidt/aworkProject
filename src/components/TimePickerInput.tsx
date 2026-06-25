import { useId, useRef, useState, type KeyboardEvent } from "react";

interface TimePickerInputProps {
  id?: string;
  value: string; // "HH:mm"
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

function parseTime(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":").map(Number);
  return {
    hour: Number.isFinite(h) ? h : 9,
    minute: Number.isFinite(m) ? m : 0,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5);

export function TimePickerInput({
  id,
  value,
  placeholder = "Uhrzeit wählen",
  disabled,
  onChange,
}: TimePickerInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [direction, setDirection] = useState<"down" | "up">("down");
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [hourScroll, setHourScroll] = useState(0);
  const [minuteScroll, setMinuteScroll] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  const { hour, minute } = parseTime(value);

  function open() {
    setHourScroll(0);
    setMinuteScroll(0);

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const MENU_WIDTH = 220;
      const MENU_HEIGHT = 220;
      const GAP = 6;
      const MARGIN = 8;

      const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
      const spaceAbove = rect.top - MARGIN;
      const openDown = spaceBelow >= MENU_HEIGHT || spaceBelow >= spaceAbove;

      let top = openDown ? rect.bottom + GAP : rect.top - MENU_HEIGHT - GAP;
      top = Math.max(
        MARGIN,
        Math.min(top, window.innerHeight - MENU_HEIGHT - MARGIN),
      );

      let left = rect.left;
      left = Math.max(
        MARGIN,
        Math.min(left, window.innerWidth - MENU_WIDTH - MARGIN),
      );

      setDirection(openDown ? "down" : "up");
      setMenuPos({ top, left });
    }
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
  }

  function closeAndRefocus() {
    close();
    buttonRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      closeAndRefocus();
    }
  }

  function selectHour(h: number) {
    onChange(formatTime(h, minute));
  }

  function selectMinute(m: number) {
    onChange(formatTime(hour, m));
  }

  // Visible hours: 3 items centered on current + scroll offset
  const viewHour = ((hour + hourScroll) % 24 + 24) % 24;
  const visibleHours = [
    ((viewHour - 1) % 24 + 24) % 24,
    viewHour,
    ((viewHour + 1) % 24 + 24) % 24,
  ];

  // Visible minutes: 3 items centered on nearest 5-min + scroll offset
  const nearestMinuteIdx = MINUTE_OPTIONS.indexOf(
    MINUTE_OPTIONS.reduce((prev, curr) =>
      Math.abs(curr - minute) < Math.abs(prev - minute) ? curr : prev,
    ),
  );
  const viewMinuteIdx =
    ((nearestMinuteIdx + minuteScroll) % 12 + 12) % 12;
  const visibleMinutes = [
    MINUTE_OPTIONS[((viewMinuteIdx - 1) % 12 + 12) % 12],
    MINUTE_OPTIONS[viewMinuteIdx],
    MINUTE_OPTIONS[((viewMinuteIdx + 1) % 12 + 12) % 12],
  ];

  return (
    <div
      ref={containerRef}
      className="date-picker"
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget)) {
          close();
        }
      }}
      onKeyDown={handleKeyDown}
    >
      <button
        id={id}
        ref={buttonRef}
        type="button"
        className="searchable-select-button date-picker-trigger time-picker-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? dialogId : undefined}
        onClick={() => (isOpen ? close() : open())}
      >
        <span className="date-picker-trigger-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle
              cx="7"
              cy="7"
              r="5.5"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
            />
            <path
              d="M7 4v3.5l2.5 1.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span>{value || placeholder}</span>
      </button>

      {isOpen && menuPos && (
        <div
          id={dialogId}
          className="date-picker-menu time-picker-menu"
          data-direction={direction}
          style={{
            top: `${menuPos.top}px`,
            left: `${menuPos.left}px`,
          }}
          role="dialog"
          aria-modal="false"
          aria-label="Uhrzeit auswählen"
        >
          <div className="time-picker-label">Uhrzeit</div>
          <div className="time-picker-spinners">
            <div className="date-picker-section">
              <div className="date-picker-section-label">Stunde</div>
              <div className="date-picker-month-spinner">
                <button
                  type="button"
                  className="date-picker-month-spinner-btn"
                  onClick={() => setHourScroll((h) => h - 1)}
                  onMouseDown={(e) => e.preventDefault()}
                  aria-label="Stunde zurück"
                >
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                    <path
                      d="M1 7L6 1L11 7"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div className="date-picker-month-display">
                  {visibleHours.map((h, idx) => {
                    const isSelected = h === hour && hourScroll === 0;
                    return (
                      <button
                        key={`${h}-${idx}`}
                        type="button"
                        className={`date-picker-month-item ${idx === 1 ? "is-center" : ""} ${isSelected ? "is-selected" : ""}`}
                        onClick={() => {
                          if (idx === 1) {
                            selectHour(h);
                          } else {
                            setHourScroll((s) => s + (idx - 1));
                          }
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        {pad2(h)}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="date-picker-month-spinner-btn"
                  onClick={() => setHourScroll((h) => h + 1)}
                  onMouseDown={(e) => e.preventDefault()}
                  aria-label="Stunde vorwärts"
                >
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                    <path
                      d="M1 1L6 7L11 1"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div className="time-picker-colon">:</div>

            <div className="date-picker-section">
              <div className="date-picker-section-label">Minute</div>
              <div className="date-picker-month-spinner">
                <button
                  type="button"
                  className="date-picker-month-spinner-btn"
                  onClick={() => setMinuteScroll((m) => m - 1)}
                  onMouseDown={(e) => e.preventDefault()}
                  aria-label="Minute zurück"
                >
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                    <path
                      d="M1 7L6 1L11 7"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div className="date-picker-month-display">
                  {visibleMinutes.map((m, idx) => {
                    const isSelected =
                      m === minute && minuteScroll === 0;
                    return (
                      <button
                        key={`${m}-${idx}`}
                        type="button"
                        className={`date-picker-month-item ${idx === 1 ? "is-center" : ""} ${isSelected ? "is-selected" : ""}`}
                        onClick={() => {
                          if (idx === 1) {
                            selectMinute(m);
                          } else {
                            setMinuteScroll((s) => s + (idx - 1));
                          }
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        {pad2(m)}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="date-picker-month-spinner-btn"
                  onClick={() => setMinuteScroll((m) => m + 1)}
                  onMouseDown={(e) => e.preventDefault()}
                  aria-label="Minute vorwärts"
                >
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                    <path
                      d="M1 1L6 7L11 1"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div className="date-picker-footer">
            <button
              type="button"
              className="date-picker-today-btn"
              onClick={() => {
                const now = new Date();
                const roundedMin =
                  Math.round(now.getMinutes() / 5) * 5;
                onChange(
                  formatTime(now.getHours(), roundedMin >= 60 ? 0 : roundedMin),
                );
              }}
            >
              Jetzt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
