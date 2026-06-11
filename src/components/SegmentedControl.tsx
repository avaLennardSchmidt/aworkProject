import { useId, type ReactNode } from "react";
import { motion } from "motion/react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
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
  const id = useId();

  return (
    <div className="segmented-control" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            className={isActive ? "active" : ""}
            disabled={disabled}
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
          >
            {isActive ? (
              <motion.span
                className="segmented-indicator"
                layoutId={`${id}-indicator`}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                aria-hidden="true"
              />
            ) : null}
            <span className="segmented-label">
              {option.icon}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
