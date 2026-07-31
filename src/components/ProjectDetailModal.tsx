import { useEffect, useState } from "react";
import { backendClient } from "../services/backendClient";
import { extractProjectDetail, type ProjectDetail } from "../services/aworkDetail";
import { projectWebUrl } from "../services/aworkWebLinks";
import { formatDetailDate, formatDetailHours } from "../services/detailFormat";
import {
  mapTimeEntriesResponse,
  sumTimeEntrySeconds,
} from "../services/timeEntryMapper";
import {
  DetailModalFrame,
  DetailRow,
  DetailTags,
} from "./DetailModalParts";
import { RichText } from "./RichText";

interface ProjectDetailModalProps {
  projectId: string;
  onOpenProjectDetail: (projectId: string) => void;
  onClose: () => void;
}

export function ProjectDetailModal({ projectId, onClose }: ProjectDetailModalProps) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [trackedSeconds, setTrackedSeconds] = useState<number | undefined>();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);
    setDetail(null);

    (async () => {
      try {
        const raw = await backendClient.getProject(projectId);
        const project = extractProjectDetail(unwrap(raw));

        // "Kunde" — if awork didn't embed the company, resolve it by id.
        if (!project.companyName && project.companyId) {
          try {
            const company = await backendClient.getCompany(project.companyId);
            const name = readName(unwrap(company));
            if (name) {
              project.companyName = name;
            }
          } catch {
            // Company lookup is best-effort; ignore failures.
          }
        }

        if (!cancelled) {
          setDetail(project);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Projektdetails konnten nicht geladen werden.",
          );
          setIsLoading(false);
        }
      }
    })();

    // Best-effort tracked-time sum for the burn-down row.
    void backendClient
      .getProjectTimeEntries(projectId)
      .then((raw) => {
        if (!cancelled) {
          setTrackedSeconds(sumTimeEntrySeconds(mapTimeEntriesResponse(raw)));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <DetailModalFrame
      titleId="project-detail-title"
      eyebrow="Projekt"
      title={detail?.name ?? "Projekt"}
      statusName={detail?.statusName}
      statusType={detail?.statusType}
      onClose={onClose}
      isLoading={isLoading}
      error={error}
      openHref={projectWebUrl(detail?.key)}
      openLabel="In awork öffnen"
    >
      {detail ? (
        <>
          <DetailRow label="Key">{detail.key}</DetailRow>
          <DetailRow label="Kunde">{detail.companyName}</DetailRow>
          <DetailRow label="Projekttyp">{detail.projectTypeName}</DetailRow>
          <DetailRow label="Teams">
            {detail.teamNames.length > 0 ? detail.teamNames.join(", ") : undefined}
          </DetailRow>
          <DetailRow label="Tags">
            <DetailTags tags={detail.tagNames} />
          </DetailRow>
          <DetailRow label="Start">{formatDetailDate(detail.startOn)}</DetailRow>
          <DetailRow label="Fällig">{formatDetailDate(detail.dueOn)}</DetailRow>
          <DetailRow label="Zeitbudget">
            {detail.timeBudgetSeconds !== undefined ||
            trackedSeconds !== undefined ? (
              <span className="detail-burndown">
                <span>
                  {formatDetailHours(detail.timeBudgetSeconds) ?? "—"} Budget
                  {" · "}
                  {formatDetailHours(trackedSeconds) ?? "—"} erfasst
                </span>
                {detail.timeBudgetSeconds !== undefined &&
                detail.timeBudgetSeconds > 0 &&
                trackedSeconds !== undefined ? (
                  <span className="detail-burndown-track" aria-hidden="true">
                    <span
                      className={`detail-burndown-fill${trackedSeconds > detail.timeBudgetSeconds ? " is-over" : ""}`}
                      style={{
                        width: `${Math.min(100, (trackedSeconds / detail.timeBudgetSeconds) * 100)}%`,
                      }}
                    />
                  </span>
                ) : null}
              </span>
            ) : undefined}
          </DetailRow>
          <DetailRow label="Abrechenbar">
            {detail.isBillable === undefined
              ? undefined
              : detail.isBillable
                ? "Ja"
                : "Nein"}
          </DetailRow>
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

function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value) {
    const data = (value as { data: unknown }).data;
    if (data && typeof data === "object") {
      return data;
    }
  }
  return value;
}

function readName(value: unknown): string | undefined {
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name: unknown }).name;
    if (typeof name === "string" && name.trim()) {
      return name;
    }
  }
  return undefined;
}
