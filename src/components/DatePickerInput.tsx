import {
  addMonths,
  format,
  getDate,
  getDaysInMonth,
  getMonth,
  getYear,
  isToday,
  isValid,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import { de } from "date-fns/locale";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

interface DatePickerInputProps {
  id?: string;
  value: string; // YYYY-MM-DD or ""
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function toIso(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function parseValue(value: string): Date | null {
  if (!value) return null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

function buildCalendarDays(viewMonth: Date): (Date | null)[] {
  const year = getYear(viewMonth);
  const month = getMonth(viewMonth);
  const daysInMonth = getDaysInMonth(viewMonth);
  const firstDay = new Date(year, month, 1);
  // JS: 0=Sun … 6=Sat. We want Monday=0.
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function DatePickerInput({
  id,
  value,
  placeholder = "Datum wählen",
  disabled,
  onChange,
}: DatePickerInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const parsed = parseValue(value);
    return startOfMonth(parsed ?? new Date());
  });
  const [direction, setDirection] = useState<"down" | "up">("down");

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  const selectedDate = parseValue(value);
  const days = buildCalendarDays(viewMonth);

  function open() {
    const parsed = parseValue(value);
    setViewMonth(startOfMonth(parsed ?? new Date()));
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDirection(window.innerHeight - rect.bottom < 320 ? "up" : "down");
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

  function selectDay(date: Date) {
    onChange(toIso(date));
    setViewMonth(startOfMonth(date));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      closeAndRefocus();
    }
  }

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
        className="searchable-select-button date-picker-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? dialogId : undefined}
        onClick={() => (isOpen ? close() : open())}
      >
        <span className="date-picker-trigger-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="2.5" width="12" height="10" rx="1.8" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <path d="M1 6h12" stroke="currentColor" strokeWidth="1.4" />
            <path d="M4.5 1v3M9.5 1v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <span>
          {selectedDate
            ? format(selectedDate, "dd.MM.yyyy")
            : placeholder}
        </span>
      </button>

      {isOpen && (
        <div
          id={dialogId}
          className="date-picker-menu"
          data-direction={direction}
          role="dialog"
          aria-modal="false"
          aria-label="Datum auswählen"
        >
          <div className="date-picker-header">
            <button
              type="button"
              className="date-picker-nav"
              aria-label="Vorheriger Monat"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
            >
              <svg width="6" height="11" viewBox="0 0 6 11" fill="none">
                <path d="M5 1L1 5.5 5 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="date-picker-month-label">
              {format(viewMonth, "MMMM yyyy", { locale: de })}
            </span>
            <button
              type="button"
              className="date-picker-nav"
              aria-label="Nächster Monat"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
            >
              <svg width="6" height="11" viewBox="0 0 6 11" fill="none">
                <path d="M1 1l4 4.5L1 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="date-picker-grid" role="grid">
            <div className="date-picker-weekdays" role="row">
              {DAY_NAMES.map((name) => (
                <div key={name} className="date-picker-weekday" role="columnheader">
                  {name}
                </div>
              ))}
            </div>
            {Array.from({ length: days.length / 7 }, (_, rowIdx) => (
              <div key={rowIdx} className="date-picker-week" role="row">
                {days.slice(rowIdx * 7, rowIdx * 7 + 7).map((date, colIdx) => {
                  if (!date) {
                    return (
                      <div
                        key={colIdx}
                        className="date-picker-cell date-picker-cell--empty"
                        role="gridcell"
                        aria-hidden="true"
                      />
                    );
                  }
                  const isoStr = toIso(date);
                  const isSelected = value === isoStr;
                  const isCurrentDay = isToday(date);
                  return (
                    <button
                      key={isoStr}
                      type="button"
                      role="gridcell"
                      className={[
                        "date-picker-cell",
                        isSelected ? "date-picker-cell--selected" : "",
                        isCurrentDay ? "date-picker-cell--today" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-selected={isSelected}
                      aria-label={format(date, "EEEE, dd. MMMM yyyy", { locale: de })}
                      aria-pressed={isSelected}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectDay(date)}
                    >
                      {getDate(date)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="date-picker-footer">
            <button
              type="button"
              className="date-picker-today-btn"
              onClick={() => selectDay(new Date())}
            >
              Heute
            </button>
          </div>        </div>
      )}
    </div>
  );
}
