import { useEffect, useState } from "react";
import { backendClient } from "../services/backendClient";
import { extractTaskDetail, type TaskDetail } from "../services/aworkDetail";
import { taskWebUrl } from "../services/aworkWebLinks";
import { formatDetailDate, formatDetailHours } from "../services/detailFormat";
import {
  mapTimeEntriesResponse,
  sumTimeEntrySeconds,
} from "../services/timeEntryMapper";
import {
  DetailAssignees,
  DetailLinkValue,
  DetailModalFrame,
  DetailRow,
  DetailTags,
  DetailTimeCards,
  type TimeCard,
} from "./DetailModalParts";
import { RichText } from "./RichText";

interface TaskDetailModalProps {
  taskId: string;
  onOpenProjectDetail: (projectId: string) => void;
  onClose: () => void;
}

export function TaskDetailModal({
  taskId,
  onOpenProjectDetail,
  onClose,
}: TaskDetailModalProps) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [trackedSeconds, setTrackedSeconds] = useState<number | undefined>();
  const [calendarSeconds, setCalendarSeconds] = useState<number | undefined>();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);
    setDetail(null);
    setTrackedSeconds(undefined);
    setCalendarSeconds(undefined);

    (async () => {
      try {
        const raw = await backendClient.getTask(taskId);
        if (!cancelled) {
          setDetail(extractTaskDetail(unwrap(raw)));
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Aufgabendetails konnten nicht geladen werden.",
          );
          setIsLoading(false);
        }
      }
    })();

    // Best-effort side loads for the awork-style time cards; failures just
    // leave the card at "—".
    void backendClient
      .getTaskTimeEntries(taskId)
      .then((raw) => {
        if (!cancelled) {
          setTrackedSeconds(sumTimeEntrySeconds(mapTimeEntriesResponse(raw)));
        }
      })
      .catch(() => {});
    void backendClient
      .getSchedulesForTask(taskId)
      .then((raw) => {
        if (!cancelled) {
          setCalendarSeconds(sumScheduleSeconds(raw));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  return (
    <DetailModalFrame
      titleId="task-detail-title"
      eyebrow="Aufgabe"
      title={detail?.name ?? "Aufgabe"}
      statusName={detail?.statusName}
      statusType={detail?.statusType}
      onClose={onClose}
      isLoading={isLoading}
      error={error}
      openHref={taskWebUrl(detail?.key)}
      openLabel="In awork öffnen"
    >
      {detail ? (
        <>
          <DetailTimeCards
            cards={buildTaskTimeCards(detail, trackedSeconds, calendarSeconds)}
          />
          <DetailRow label="Key">{detail.key}</DetailRow>
          <DetailRow label="Projekt">
            {detail.projectName ? (
              detail.projectId ? (
                <DetailLinkValue
                  label={detail.projectName}
                  onClick={() => onOpenProjectDetail(detail.projectId!)}
                />
              ) : (
                detail.projectName
              )
            ) : undefined}
          </DetailRow>
          <DetailRow label="Kunde">{detail.companyName}</DetailRow>
          <DetailRow label="Tätigkeit">{detail.typeOfWorkName}</DetailRow>
          <DetailRow label="Aufgabenlisten">
            {detail.listNames.length > 0 ? detail.listNames.join(", ") : undefined}
          </DetailRow>
          <DetailRow label="Beobachter">
            <DetailAssignees assignees={detail.assignees} />
          </DetailRow>
          <DetailRow label="Priorität">
            {detail.priority ? "Ja" : undefined}
          </DetailRow>
          {detail.isSubtask ? (
            <DetailRow label="Teil von">{detail.parentTaskName}</DetailRow>
          ) : (
            <DetailRow label="Unteraufgaben">
              {detail.numberOfSubtasks && detail.numberOfSubtasks > 0
                ? String(detail.numberOfSubtasks)
                : undefined}
            </DetailRow>
          )}
          <DetailRow label="Checkliste">
            {detail.checklistTotal && detail.checklistTotal > 0
              ? `${detail.checklistDone ?? 0}/${detail.checklistTotal}`
              : undefined}
          </DetailRow>
          <DetailRow label="Kommentare">
            {detail.commentCount && detail.commentCount > 0
              ? String(detail.commentCount)
              : undefined}
          </DetailRow>
          <DetailRow label="Tags">
            <DetailTags tags={detail.tagNames} />
          </DetailRow>
          <DetailRow label="Erstellt">{formatDetailDate(detail.createdOn)}</DetailRow>
          <DetailRow label="Aktualisiert">{formatDetailDate(detail.updatedOn)}</DetailRow>
          {detail.description ? (
            <DetailRow label="Beschreibung" fullWidth>
              <RichText html={detail.description} />
            </DetailRow>
          ) : null}
        </>
      ) : null}
    </DetailModalFrame>
  );
}

/** awork-style time cards: Fällig bis · Geplant · Erfasst · Im Kalender. */
function buildTaskTimeCards(
  detail: TaskDetail,
  trackedSeconds: number | undefined,
  calendarSeconds: number | undefined,
): TimeCard[] {
  return [
    { label: "Fällig bis", value: formatDetailDate(detail.dueOn) ?? "—", tone: "due" },
    { label: "Start", value: formatDetailDate(detail.startOn) ?? "—", tone: "start" },
    {
      label: "Geplant",
      value: formatDetailHours(detail.plannedSeconds) ?? "0h",
      tone: "planned",
    },
    {
      label: "Erfasst",
      value: formatDetailHours(trackedSeconds) ?? "—",
      tone: "tracked",
    },
    {
      label: "Im Kalender",
      value: formatDetailHours(calendarSeconds) ?? "—",
      tone: "calendar",
    },
  ];
}

/**
 * Sums awork's own plannedDuration value for every calendar schedule.
 * Date differences are only a compatibility fallback for older response shapes.
 */
function sumScheduleSeconds(raw: unknown): number {
  const items = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown[] }).items)
      ? ((raw as { items: unknown[] }).items)
      : [];
  let seconds = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const plannedDuration = record.plannedDuration;
    if (
      typeof plannedDuration === "number" &&
      Number.isFinite(plannedDuration) &&
      plannedDuration > 0
    ) {
      seconds += plannedDuration;
      continue;
    }

    const start = firstScheduleDate(record, ["startDate", "start"]);
    const end = firstScheduleDate(record, ["endDate", "end"]);
    if (start && end) {
      const diff = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
      if (Number.isFinite(diff) && diff > 0) {
        seconds += diff;
      }
    }
  }
  return seconds;
}

function firstScheduleDate(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string") {
      return record[key];
    }
  }
  return undefined;
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value) {
    const data = (value as { data: unknown }).data;
    if (data && typeof data === "object") {
      return data;
    }
  }
  return value;
}
