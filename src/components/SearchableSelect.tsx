import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { fuzzyMatches } from "../services/fuzzySearch";

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  buttonId?: string;
  value: string;
  options: SelectOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  selectedLabelOverride?: Record<string, string>;
  menuWidth?: "default" | "compact";
  disabled?: boolean;
  onChange: (value: string) => void;
}

interface MultiSearchableSelectProps {
  buttonId?: string;
  values: string[];
  options: SelectOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  menuWidth?: "default" | "compact";
  disabled?: boolean;
  onChange: (values: string[]) => void;
}

type DropdownDirection = "down" | "up";

export function SearchableSelect({
  buttonId,
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  selectedLabelOverride,
  menuWidth = "default",
  disabled,
  onChange,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = options.filter((option) =>
    fuzzyMatches(option.label, query),
  );
  const menuDirection = useDropdownDirection(isOpen, containerRef, menuRef);

  function close() {
    setIsOpen(false);
    setQuery("");
  }

  return (
    <div
      ref={containerRef}
      className="searchable-select"
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget)) {
          close();
        }
      }}
    >
      <button
        id={buttonId}
        type="button"
        className="searchable-select-button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>
          {selectedOption
            ? (selectedLabelOverride?.[selectedOption.value] ??
              selectedOption.label)
            : placeholder}
        </span>
      </button>

      {isOpen ? (
        <div
          ref={menuRef}
          className={`searchable-select-menu${menuWidth === "compact" ? " searchable-select-menu-compact" : ""}`}
          data-direction={menuDirection}
        >
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="searchable-select-options" role="listbox">
            {filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={option.value === value ? "active" : ""}
                role="option"
                aria-selected={option.value === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
              >
                {option.label}
              </button>
            ))}
            {filteredOptions.length === 0 ? (
              <div className="searchable-select-empty">{emptyLabel}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MultiSearchableSelect({
  buttonId,
  values,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  menuWidth = "default",
  disabled,
  onChange,
}: MultiSearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedValues = new Set(values);
  const filteredOptions = options.filter((option) =>
    fuzzyMatches(option.label, query),
  );
  const selectedCount = values.length;
  const menuDirection = useDropdownDirection(isOpen, containerRef, menuRef);

  function close() {
    setIsOpen(false);
    setQuery("");
  }

  function toggleOption(value: string) {
    const next = new Set(selectedValues);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(Array.from(next));
  }

  const allFilteredSelected =
    filteredOptions.length > 0 &&
    filteredOptions.every((option) => selectedValues.has(option.value));

  function toggleFilteredSelection() {
    const next = new Set(selectedValues);
    if (allFilteredSelected) {
      filteredOptions.forEach((option) => {
        next.delete(option.value);
      });
    } else {
      filteredOptions.forEach((option) => {
        next.add(option.value);
      });
    }
    onChange(Array.from(next));
  }

  return (
    <div
      ref={containerRef}
      className="searchable-select"
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget)) {
          close();
        }
      }}
    >
      <button
        id={buttonId}
        type="button"
        className="searchable-select-button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>
          {selectedCount > 0
            ? `${selectedCount} team${selectedCount === 1 ? "" : "s"} selected`
            : placeholder}
        </span>
      </button>

      {isOpen ? (
        <div
          ref={menuRef}
          className={`searchable-select-menu${menuWidth === "compact" ? " searchable-select-menu-compact" : ""}`}
          data-direction={menuDirection}
        >
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="searchable-select-multi-actions">
            <button
              type="button"
              className="ghost-button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleFilteredSelection}
            >
              {allFilteredSelected ? "Clear filtered" : "Select filtered"}
            </button>
          </div>
          <div
            className="searchable-select-options"
            role="listbox"
            aria-multiselectable="true"
          >
            {filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={selectedValues.has(option.value) ? "active" : ""}
                role="option"
                aria-selected={selectedValues.has(option.value)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleOption(option.value)}
              >
                {option.label}
              </button>
            ))}
            {filteredOptions.length === 0 ? (
              <div className="searchable-select-empty">{emptyLabel}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function formatSearchPlaceholder(label: string, count: number): string {
  return `${label} (${count} found)`;
}

function useDropdownDirection(
  isOpen: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  menuRef: RefObject<HTMLDivElement | null>,
): DropdownDirection {
  const [direction, setDirection] = useState<DropdownDirection>("down");

  useLayoutEffect(() => {
    if (!isOpen) {
      setDirection("down");
      return;
    }

    function updateDirection() {
      const container = containerRef.current;
      const menu = menuRef.current;
      if (!container || !menu) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const spaceBelow = window.innerHeight - containerRect.bottom - 12;
      const spaceAbove = containerRect.top - 12;
      const shouldOpenUp =
        spaceBelow < menuRect.height && spaceAbove > spaceBelow;

      setDirection(shouldOpenUp ? "up" : "down");
    }

    updateDirection();
    window.addEventListener("resize", updateDirection);
    document.addEventListener("scroll", updateDirection, true);

    return () => {
      window.removeEventListener("resize", updateDirection);
      document.removeEventListener("scroll", updateDirection, true);
    };
  }, [isOpen, containerRef, menuRef]);

  return direction;
}
