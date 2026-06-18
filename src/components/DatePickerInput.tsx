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
  setMonth,
  setYear,
} from "date-fns";
import { de } from "date-fns/locale";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

interface AbsenceRange {
  startOn: string;
  endOn: string;
}

interface DatePickerInputProps {
  id?: string;
  value: string; // YYYY-MM-DD or ""
  placeholder?: string;
  disabled?: boolean;
  absenceRanges?: AbsenceRange[];
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
  // Keep popup height stable by always rendering 6 full calendar rows.
  while (cells.length < 42) cells.push(null);
  return cells;
}

export function DatePickerInput({
  id,
  value,
  placeholder = "Datum wählen",
  disabled,
  absenceRanges,
  onChange,
}: DatePickerInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<"calendar" | "monthYear">("calendar");
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const parsed = parseValue(value);
    return startOfMonth(parsed ?? new Date());
  });
  const [direction, setDirection] = useState<"down" | "up">("down");
  const [yearScroll, setYearScroll] = useState(0); // Offset in years
  const [monthScroll, setMonthScroll] = useState(0); // Offset in months
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  const selectedDate = parseValue(value);
  const days = buildCalendarDays(viewMonth);
  const isAbsentDate = useMemo(() => {
    if (!absenceRanges?.length) return (_: string) => false;
    return (iso: string) =>
      absenceRanges.some((r) => iso >= r.startOn && iso <= r.endOn);
  }, [absenceRanges]);

  function open() {
    const parsed = parseValue(value);
    setViewMonth(startOfMonth(parsed ?? new Date()));
    setView("calendar");
    setYearScroll(0);
    setMonthScroll(0);

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const MENU_WIDTH = 284;
      const MENU_HEIGHT = 358;
      const GAP = 6;
      const MARGIN = 8;

      // Pick the direction that has more room
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
      const spaceAbove = rect.top - MARGIN;
      const openDown = spaceBelow >= MENU_HEIGHT || spaceBelow >= spaceAbove;

      let top = openDown
        ? rect.bottom + GAP
        : rect.top - MENU_HEIGHT - GAP;

      // Clamp vertical so popup never leaves the viewport
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - MENU_HEIGHT - MARGIN));

      // Clamp horizontal so popup never overflows left or right
      let left = rect.left;
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - MENU_WIDTH - MARGIN));

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

  function selectDay(date: Date) {
    onChange(toIso(date));
    setViewMonth(startOfMonth(date));
  }

  function selectMonthYear(month: number, year: number) {
    const newDate = setMonth(setYear(viewMonth, year), month);
    setViewMonth(newDate);
    setView("calendar");
    setYearScroll(0);
    setMonthScroll(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      closeAndRefocus();
    }
  }

  const currentMonth = getMonth(viewMonth);
  const currentYear = getYear(viewMonth);

  // Show 3 visible months at a time, centered
  const baseMonth = (currentMonth + monthScroll - 1) % 12;
  const visibleMonths = [
    (baseMonth + 12) % 12,
    (baseMonth + 1) % 12,
    (baseMonth + 2) % 12,
  ];

  // Show 3 visible years at a time, centered
  const baseYear = currentYear + yearScroll - 1; // -1 to show year before, current, year after
  const visibleYears = [baseYear, baseYear + 1, baseYear + 2];

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
            <rect
              x="1"
              y="2.5"
              width="12"
              height="10"
              rx="1.8"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
            />
            <path d="M1 6h12" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M4.5 1v3M9.5 1v3"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span>
          {selectedDate ? format(selectedDate, "dd.MM.yyyy") : placeholder}
        </span>
      </button>

      {isOpen && menuPos && (
        <div
          id={dialogId}
          className="date-picker-menu"
          data-direction={direction}
          style={{
            top: `${menuPos.top}px`,
            left: `${menuPos.left}px`,
          }}
          role="dialog"
          aria-modal="false"
          aria-label="Datum auswählen"
        >
          {view === "calendar" ? (
            <>
              <div className="date-picker-header">
                <button
                  type="button"
                  className="date-picker-nav"
                  aria-label="Vorheriger Monat"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setViewMonth((m) => subMonths(m, 1))}
                >
                  <svg width="6" height="11" viewBox="0 0 6 11" fill="none">
                    <path
                      d="M5 1L1 5.5 5 10"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="date-picker-month-label-button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setView("monthYear")}
                  title="Klick für Monat/Jahr Selector"
                >
                  {format(viewMonth, "MMMM yyyy", { locale: de })}
                </button>
                <button
                  type="button"
                  className="date-picker-nav"
                  aria-label="Nächster Monat"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                >
                  <svg width="6" height="11" viewBox="0 0 6 11" fill="none">
                    <path
                      d="M1 1l4 4.5L1 10"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <div className="date-picker-grid" role="grid">
                <div className="date-picker-weekdays" role="row">
                  {DAY_NAMES.map((name) => (
                    <div
                      key={name}
                      className="date-picker-weekday"
                      role="columnheader"
                    >
                      {name}
                    </div>
                  ))}
                </div>
                {Array.from({ length: days.length / 7 }, (_, rowIdx) => (
                  <div key={rowIdx} className="date-picker-week" role="row">
                    {days
                      .slice(rowIdx * 7, rowIdx * 7 + 7)
                      .map((date, colIdx) => {
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
                        const isAbsent = isAbsentDate(isoStr);
                        return (
                          <button
                            key={isoStr}
                            type="button"
                            role="gridcell"
                            className={[
                              "date-picker-cell",
                              isSelected ? "date-picker-cell--selected" : "",
                              isCurrentDay ? "date-picker-cell--today" : "",
                              isAbsent ? "date-picker-cell--absent" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            aria-selected={isSelected}
                            aria-label={format(date, "EEEE, dd. MMMM yyyy", {
                              locale: de,
                            })}
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
              </div>
            </>
          ) : (
            <>
              <div className="date-picker-header">
                <span className="date-picker-month-label">Monat & Jahr</span>
              </div>
              <div className="date-picker-month-year-grid">
                <div className="date-picker-section">
                  <div className="date-picker-section-label">Monat</div>
                  <div className="date-picker-month-spinner">
                    <button
                      type="button"
                      className="date-picker-month-spinner-btn date-picker-month-spinner-up"
                      onClick={() => setMonthScroll((m) => m - 1)}
                      onMouseDown={(e) => e.preventDefault()}
                      aria-label="Monat zurück"
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
                      {visibleMonths.map((month, idx) => {
                        const monthName = format(new Date(2024, month), "MMM", {
                          locale: de,
                        });
                        const isCurrentMonth =
                          month === currentMonth && monthScroll === 0;
                        return (
                          <button
                            key={`${month}-${idx}`}
                            type="button"
                            className={`date-picker-month-item ${idx === 1 ? "is-center" : ""} ${isCurrentMonth ? "is-selected" : ""}`}
                            onClick={() => {
                              if (idx === 1) {
                                selectMonthYear(
                                  month,
                                  currentYear + yearScroll,
                                );
                              } else {
                                setMonthScroll((m) => m + (idx - 1));
                              }
                            }}
                            onMouseDown={(e) => e.preventDefault()}
                          >
                            {monthName}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="date-picker-month-spinner-btn date-picker-month-spinner-down"
                      onClick={() => setMonthScroll((m) => m + 1)}
                      onMouseDown={(e) => e.preventDefault()}
                      aria-label="Monat vorwärts"
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
                <div className="date-picker-section">
                  <div className="date-picker-section-label">Jahr</div>
                  <div className="date-picker-year-spinner">
                    <button
                      type="button"
                      className="date-picker-year-spinner-btn date-picker-year-spinner-up"
                      onClick={() => setYearScroll((y) => y - 1)}
                      onMouseDown={(e) => e.preventDefault()}
                      aria-label="Jahr zurück"
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
                    <div className="date-picker-year-display">
                      {visibleYears.map((year, idx) => (
                        <button
                          key={year}
                          type="button"
                          className={`date-picker-year-item ${idx === 1 ? "is-center" : ""} ${year === currentYear && yearScroll === 0 ? "is-selected" : ""}`}
                          onClick={() => {
                            if (idx === 1) {
                              selectMonthYear(currentMonth + monthScroll, year);
                            } else {
                              setYearScroll((y) => y + (idx - 1));
                            }
                          }}
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          {year}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="date-picker-year-spinner-btn date-picker-year-spinner-down"
                      onClick={() => setYearScroll((y) => y + 1)}
                      onMouseDown={(e) => e.preventDefault()}
                      aria-label="Jahr vorwärts"
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
                  className="date-picker-back-btn"
                  onClick={() => setView("calendar")}
                >
                  Zurück
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
