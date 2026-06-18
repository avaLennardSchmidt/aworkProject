import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent,
} from "react";
import { fuzzyMatches } from "../services/fuzzySearch";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional leading element (e.g. a status icon) shown before the label in the option list. */
  icon?: ReactNode;
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
  selectedLabel?: (count: number) => string;
  disabled?: boolean;
  onChange: (values: string[]) => void;
}

type DropdownDirection = "down" | "up";

interface DropdownLayout {
  direction: DropdownDirection;
  optionsMaxHeight?: number;
}

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
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = options.filter((option) =>
    fuzzyMatches(option.label, query),
  );
  const activeIndex = Math.min(highlightedIndex, filteredOptions.length - 1);
  const layout = useDropdownLayout(isOpen, containerRef, menuRef, optionsRef);
  useScrollHighlightedIntoView(isOpen, activeIndex, optionsRef);

  function close() {
    setIsOpen(false);
    setQuery("");
    setHighlightedIndex(0);
  }

  function closeAndRefocus() {
    close();
    buttonRef.current?.focus();
  }

  function selectOption(optionValue: string) {
    onChange(optionValue);
    closeAndRefocus();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    handleListNavigationKey(event, {
      optionCount: filteredOptions.length,
      activeIndex,
      setHighlightedIndex,
      onSelect: () => {
        const option = filteredOptions[activeIndex];
        if (option) {
          selectOption(option.value);
        }
      },
      onEscape: closeAndRefocus,
    });
  }

  function handleMenuWheel(event: WheelEvent<HTMLDivElement>) {
    containWheelScroll(event, optionsRef.current);
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
        ref={buttonRef}
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
          data-direction={layout.direction}
          onWheelCapture={handleMenuWheel}
          style={
            layout.optionsMaxHeight
              ? ({
                  "--searchable-select-options-max-height": `${layout.optionsMaxHeight}px`,
                } as CSSProperties)
              : undefined
          }
        >
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            autoFocus
            role="combobox"
            aria-controls={listboxId}
            aria-expanded={isOpen}
            aria-activedescendant={
              filteredOptions[activeIndex]
                ? `${listboxId}-option-${activeIndex}`
                : undefined
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
          />
          <div
            ref={optionsRef}
            id={listboxId}
            className="searchable-select-options"
            role="listbox"
          >
            {filteredOptions.map((option, index) => (
              <button
                key={option.value}
                id={`${listboxId}-option-${index}`}
                type="button"
                className={[
                  option.value === value ? "active" : "",
                  index === activeIndex ? "highlighted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="option"
                aria-selected={option.value === value}
                data-highlighted={index === activeIndex || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option.value)}
              >
                {option.icon ? (
                  <span className="select-option-icon">{option.icon}</span>
                ) : null}
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
  selectedLabel,
  disabled,
  onChange,
}: MultiSearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedValues = new Set(values);
  const filteredOptions = options.filter((option) =>
    fuzzyMatches(option.label, query),
  );
  const selectedCount = values.length;
  const activeIndex = Math.min(highlightedIndex, filteredOptions.length - 1);
  const layout = useDropdownLayout(isOpen, containerRef, menuRef, optionsRef);
  useScrollHighlightedIntoView(isOpen, activeIndex, optionsRef);

  function close() {
    setIsOpen(false);
    setQuery("");
    setHighlightedIndex(0);
  }

  function closeAndRefocus() {
    close();
    buttonRef.current?.focus();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    handleListNavigationKey(event, {
      optionCount: filteredOptions.length,
      activeIndex,
      setHighlightedIndex,
      onSelect: () => {
        const option = filteredOptions[activeIndex];
        if (option) {
          toggleOption(option.value);
        }
      },
      onEscape: closeAndRefocus,
    });
  }

  function handleMenuWheel(event: WheelEvent<HTMLDivElement>) {
    containWheelScroll(event, optionsRef.current);
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
        ref={buttonRef}
        type="button"
        className="searchable-select-button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>
          {selectedCount > 0
            ? selectedLabel
              ? selectedLabel(selectedCount)
              : `${selectedCount} Team${selectedCount === 1 ? "" : "s"} ausgewählt`
            : placeholder}
        </span>
      </button>

      {isOpen ? (
        <div
          ref={menuRef}
          className={`searchable-select-menu${menuWidth === "compact" ? " searchable-select-menu-compact" : ""}`}
          data-direction={layout.direction}
          onWheelCapture={handleMenuWheel}
          style={
            layout.optionsMaxHeight
              ? ({
                  "--searchable-select-options-max-height": `${layout.optionsMaxHeight}px`,
                } as CSSProperties)
              : undefined
          }
        >
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            autoFocus
            role="combobox"
            aria-controls={listboxId}
            aria-expanded={isOpen}
            aria-activedescendant={
              filteredOptions[activeIndex]
                ? `${listboxId}-option-${activeIndex}`
                : undefined
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
          />
          <div
            ref={optionsRef}
            id={listboxId}
            className="searchable-select-options"
            role="listbox"
            aria-multiselectable="true"
          >
            {filteredOptions.map((option, index) => (
              <button
                key={option.value}
                id={`${listboxId}-option-${index}`}
                type="button"
                className={[
                  selectedValues.has(option.value) ? "active" : "",
                  index === activeIndex ? "highlighted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="option"
                aria-selected={selectedValues.has(option.value)}
                data-highlighted={index === activeIndex || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setHighlightedIndex(index)}
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
  return `${label} (${count} gefunden)`;
}

function handleListNavigationKey(
  event: KeyboardEvent<HTMLInputElement>,
  handlers: {
    optionCount: number;
    activeIndex: number;
    setHighlightedIndex: (index: number) => void;
    onSelect: () => void;
    onEscape: () => void;
  },
) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    handlers.setHighlightedIndex(
      Math.min(handlers.activeIndex + 1, handlers.optionCount - 1),
    );
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    handlers.setHighlightedIndex(Math.max(handlers.activeIndex - 1, 0));
  } else if (event.key === "Enter") {
    event.preventDefault();
    handlers.onSelect();
  } else if (event.key === "Escape") {
    // Nur das Dropdown schließen, nicht den umgebenden Modal-Dialog.
    event.stopPropagation();
    handlers.onEscape();
  }
}

function useScrollHighlightedIntoView(
  isOpen: boolean,
  activeIndex: number,
  optionsRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const highlighted = optionsRef.current?.querySelector<HTMLElement>(
      "[data-highlighted]",
    );
    highlighted?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeIndex, optionsRef]);
}

function useDropdownLayout(
  isOpen: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  menuRef: RefObject<HTMLDivElement | null>,
  optionsRef: RefObject<HTMLDivElement | null>,
): DropdownLayout {
  const [layout, setLayout] = useState<DropdownLayout>({ direction: "down" });

  useLayoutEffect(() => {
    if (!isOpen) {
      setLayout({ direction: "down" });
      return;
    }

    const boundaryParent = containerRef.current
      ? findDropdownBoundaryParent(containerRef.current)
      : null;
    const scrollParent = containerRef.current
      ? findScrollParent(containerRef.current)
      : null;

    function updateLayout() {
      const container = containerRef.current;
      const menu = menuRef.current;
      const options = optionsRef.current;
      if (!container || !menu || !options) {
        return;
      }

      const boundaryRect = getDropdownBoundaryRect(container, boundaryParent);
      const containerRect = container.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const optionsRect = options.getBoundingClientRect();
      const spaceBelow = boundaryRect.bottom - containerRect.bottom - 12;
      const spaceAbove = containerRect.top - boundaryRect.top - 12;
      const shouldOpenUp =
        spaceBelow < menuRect.height && spaceAbove > spaceBelow;
      const menuChromeHeight = Math.max(
        0,
        menuRect.height - optionsRect.height,
      );
      const availableOptionsHeight = Math.max(
        120,
        (shouldOpenUp ? spaceAbove : spaceBelow) - menuChromeHeight,
      );

      setLayout({
        direction: shouldOpenUp ? "up" : "down",
        optionsMaxHeight: Math.min(280, availableOptionsHeight),
      });
    }

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    scrollParent?.addEventListener("scroll", updateLayout);

    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
      scrollParent?.removeEventListener("scroll", updateLayout);
    };
  }, [isOpen, containerRef, menuRef, optionsRef]);

  return layout;
}

function getDropdownBoundaryRect(
  container: HTMLDivElement,
  boundaryParent?: HTMLElement | null,
): {
  top: number;
  bottom: number;
} {
  const boundaryElement =
    boundaryParent ?? findDropdownBoundaryParent(container);
  if (!boundaryElement) {
    return { top: 0, bottom: window.innerHeight };
  }

  const rect = boundaryElement.getBoundingClientRect();
  return {
    top: Math.max(0, rect.top),
    bottom: Math.min(window.innerHeight, rect.bottom),
  };
}

function findDropdownBoundaryParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;

  while (current) {
    const styles = window.getComputedStyle(current);
    const overflowY = styles.overflowY;
    const overflow = styles.overflow;
    const createsBoundary =
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "hidden" ||
      overflowY === "overlay" ||
      overflow === "hidden";

    if (createsBoundary) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;

  while (current) {
    const styles = window.getComputedStyle(current);
    const overflowY = styles.overflowY;
    const isScrollable =
      (overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay") &&
      current.scrollHeight > current.clientHeight;

    if (isScrollable) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function containWheelScroll(
  event: WheelEvent<HTMLDivElement>,
  scrollElement: HTMLDivElement | null,
): void {
  if (!scrollElement) {
    event.stopPropagation();
    return;
  }

  const { deltaY } = event;
  if (deltaY === 0) {
    event.stopPropagation();
    return;
  }

  const { scrollTop, scrollHeight, clientHeight } = scrollElement;
  const atTop = scrollTop <= 0;
  const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

  scrollElement.scrollTop += deltaY;
  event.preventDefault();
  event.stopPropagation();

  if ((deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) {
    scrollElement.scrollTop = deltaY < 0 ? 0 : scrollHeight;
  }
}
