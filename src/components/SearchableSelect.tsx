import { useRef, useState } from "react";
import { fuzzyMatches } from "../services/fuzzySearch";

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  options: SelectOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function SearchableSelect({
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  disabled,
  onChange,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = options.filter((option) => fuzzyMatches(option.label, query));

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
        type="button"
        className="searchable-select-button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>{selectedOption?.label ?? placeholder}</span>
        <span aria-hidden="true">v</span>
      </button>

      {isOpen ? (
        <div className="searchable-select-menu">
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
            {filteredOptions.length === 0 ? <div className="searchable-select-empty">{emptyLabel}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function formatSearchPlaceholder(label: string, count: number): string {
  return `${label} (${count} found)`;
}
