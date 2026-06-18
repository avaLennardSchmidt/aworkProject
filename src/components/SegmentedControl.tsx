import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion } from "motion/react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  className?: string;
  badgeText?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  ariaLabel,
  disabled,
  onChange,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<T, HTMLButtonElement | null>());
  const [indicator, setIndicator] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    function updateIndicator() {
      const activeButton = buttonRefs.current.get(value);
      if (!activeButton) {
        setIndicator(null);
        return;
      }

      setIndicator({
        left: activeButton.offsetLeft,
        top: activeButton.offsetTop,
        width: activeButton.offsetWidth,
        height: activeButton.offsetHeight,
      });
    }

    updateIndicator();

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => updateIndicator());
    resizeObserver.observe(container);
    buttonRefs.current.forEach((button) => {
      if (button) {
        resizeObserver.observe(button);
      }
    });

    return () => resizeObserver.disconnect();
  }, [options, value]);

  return (
    <div
      ref={containerRef}
      className="segmented-control"
      role="tablist"
      aria-label={ariaLabel}
    >
      {indicator ? (
        <motion.span
          className="segmented-indicator"
          initial={false}
          animate={indicator}
          transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.8 }}
          aria-hidden="true"
        />
      ) : null}
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonRefs.current.set(option.value, node);
            }}
            type="button"
            role="tab"
            className={[isActive ? "active" : "", option.className ?? ""]
              .filter(Boolean)
              .join(" ")}
            disabled={disabled}
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
          >
            <span className="segmented-label">
              {option.icon}
              {option.label}
              {option.badgeText ? (
                <span className="segmented-badge" aria-hidden="true">
                  {option.badgeText}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
