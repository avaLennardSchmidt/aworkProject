import type { ReactNode } from "react";
import { ModalShell } from "./ModalShell";
import { UserAvatar } from "./UserAvatar";
import type { DetailAssignee } from "../services/aworkDetail";

/**
 * Shared presentational building blocks for the project & task detail modals so
 * both render one consistent, easily-maintained structure.
 */

interface DetailModalFrameProps {
  titleId: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  statusName?: string;
  statusType?: string;
  onClose: () => void;
  isLoading: boolean;
  error?: string;
  openHref?: string | null;
  openLabel: string;
  children: ReactNode;
}

export function DetailModalFrame({
  titleId,
  eyebrow,
  title,
  subtitle,
  statusName,
  statusType,
  onClose,
  isLoading,
  error,
  openHref,
  openLabel,
  children,
}: DetailModalFrameProps) {
  return (
    <ModalShell
      labelledBy={titleId}
      dialogClassName="modal detail-modal"
      onClose={onClose}
    >
      <div className="modal-header">
        <div className="detail-modal-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={titleId}>{title}</h2>
          <div className="detail-modal-heading-meta">
            {statusName ? <DetailStatus name={statusName} type={statusType} /> : null}
            {subtitle ? <span className="detail-modal-subtitle">{subtitle}</span> : null}
          </div>
        </div>
        <button
          type="button"
          className="icon-button detail-modal-close"
          aria-label="Schließen"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {isLoading ? (
        <p className="loading-text-hint">Details werden geladen…</p>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : (
        <div className="detail-rows">{children}</div>
      )}

      <div className="detail-modal-footer">
        {openHref ? (
          <a
            className="awork-open-link"
            href={openHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            {openLabel}
            <span aria-hidden="true"> ↗</span>
          </a>
        ) : (
          <span className="detail-modal-footer-hint">
            Kein awork-Link verfügbar
          </span>
        )}
      </div>
    </ModalShell>
  );
}

export type TimeCardTone = "due" | "start" | "planned" | "tracked" | "calendar";

export interface TimeCard {
  label: string;
  value: string;
  tone: TimeCardTone;
}

/** awork-style row of coloured time cards (Fällig bis / Geplant / …). */
export function DetailTimeCards({ cards }: { cards: TimeCard[] }) {
  if (cards.length === 0) {
    return null;
  }
  return (
    <div className="detail-time-cards">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`detail-time-card detail-time-card--${card.tone}`}
        >
          <span className="detail-time-card-label">{card.label}</span>
          <span className="detail-time-card-value">{card.value}</span>
        </div>
      ))}
    </div>
  );
}

export function DetailStatus({ name, type }: { name: string; type?: string }) {
  const normalized = type?.trim().toLowerCase();
  const isDone =
    normalized &&
    ["closed", "completed", "done", "cancelled", "canceled", "archived"].includes(
      normalized,
    );
  return (
    <span className={`detail-status${isDone ? " is-done" : ""}`}>{name}</span>
  );
}

interface DetailRowProps {
  label: string;
  children?: ReactNode;
  /** When true, render the row even if children look empty. */
  always?: boolean;
  /** Stack label above a full-width value (for rich/long content). */
  fullWidth?: boolean;
}

export function DetailRow({ label, children, always, fullWidth }: DetailRowProps) {
  const empty = children === null || children === undefined || children === false || children === "";
  if (empty && !always) {
    return null;
  }
  return (
    <div className={`detail-row${fullWidth ? " detail-row--full" : ""}`}>
      <span className="detail-row-label">{label}</span>
      <span className="detail-row-value">
        {empty ? <span className="detail-empty">—</span> : children}
      </span>
    </div>
  );
}

export function DetailTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return null;
  }
  return (
    <span className="detail-tags">
      {tags.map((tag) => (
        <span key={tag} className="detail-tag">
          {tag}
        </span>
      ))}
    </span>
  );
}

export function DetailAssignees({ assignees }: { assignees: DetailAssignee[] }) {
  if (assignees.length === 0) {
    return null;
  }
  return (
    <span className="detail-assignees">
      {assignees.map((assignee) => (
        <span key={assignee.id} className="detail-assignee">
          <UserAvatar
            user={{ id: assignee.id, name: assignee.name }}
            size={22}
          />
          <span>{assignee.name ?? "Unbekannt"}</span>
        </span>
      ))}
    </span>
  );
}

/** A value that looks like a link and opens another detail modal on click. */
export function DetailLinkValue({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="detail-link-value" onClick={onClick}>
      {label}
    </button>
  );
}
