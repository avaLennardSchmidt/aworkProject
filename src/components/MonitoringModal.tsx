import { useEffect, useState, useCallback } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import type { BackendClient } from "../services/backendClient";
import type {
  MonitoringLogEntry,
  MonitoringDailyStats,
} from "../services/backendClient";
import { DatePickerInput } from "./DatePickerInput";
import { ModalShell } from "./ModalShell";

interface MonitoringModalProps {
  backendClient: BackendClient;
  onClose: () => void;
}

export function MonitoringModal({
  backendClient,
  onClose,
}: MonitoringModalProps) {
  const [from, setFrom] = useState(() =>
    format(startOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [to, setTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [stats, setStats] = useState<MonitoringDailyStats[]>([]);
  const [logs, setLogs] = useState<MonitoringLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<MonitoringLogEntry[]>([]);
  const [isDayLoading, setIsDayLoading] = useState(false);

  const loadData = useCallback(
    (fromDate: string, toDate: string) => {
      setIsLoading(true);
      setError("");
      setSelectedDay(null);
      Promise.all([
        backendClient.getMonitoringStats(fromDate, toDate),
        backendClient.getMonitoringLogs({
          from: fromDate,
          to: toDate,
          limit: 500,
        }),
      ])
        .then(([statsData, logsData]) => {
          setStats(statsData);
          setLogs(logsData);
        })
        .catch((err) => {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load monitoring data.",
          );
        })
        .finally(() => setIsLoading(false));
    },
    [backendClient],
  );

  useEffect(() => {
    loadData(from, to);
  }, [from, to, loadData]);

  function handleDayClick(date: string) {
    if (selectedDay === date) {
      setSelectedDay(null);
      return;
    }
    setSelectedDay(date);
    setIsDayLoading(true);
    backendClient
      .getMonitoringLogs({ from: date, to: date, limit: 100 })
      .then(setDayLogs)
      .catch(() => setDayLogs([]))
      .finally(() => setIsDayLoading(false));
  }

  function applyPreset(preset: "week" | "month") {
    const today = new Date();
    if (preset === "week") {
      setFrom(format(startOfWeek(today, { locale: de }), "yyyy-MM-dd"));
      setTo(format(endOfWeek(today, { locale: de }), "yyyy-MM-dd"));
    } else {
      setFrom(format(startOfMonth(today), "yyyy-MM-dd"));
      setTo(format(endOfMonth(today), "yyyy-MM-dd"));
    }
  }

  const today = format(new Date(), "yyyy-MM-dd");
  const chartStats = stats.filter((s) => s.date <= today);

  const totalLogins = chartStats.reduce((s, d) => s + d.logins, 0);
  const totalVisits = chartStats.reduce((s, d) => s + d.session_starts, 0);
  const uniqueUserIds = new Set(logs.map((l) => l.user_id));

  const userSummary = buildUserSummary(logs);

  return (
    <ModalShell
      labelledBy="monitoring-modal-title"
      dialogClassName="modal modal-wide"
      onClose={onClose}
    >
      <div className="modal-header">
        <h2 id="monitoring-modal-title">Monitoring Tool</h2>
        <button className="ghost-button" onClick={onClose}>
          Schließen
        </button>
      </div>

      <div className="monitoring-date-range">
        <label className="monitoring-date-label">
          Von
          <DatePickerInput value={from} onChange={setFrom} />
        </label>
        <label className="monitoring-date-label">
          Bis
          <DatePickerInput value={to} onChange={setTo} />
        </label>
        <div className="monitoring-presets">
          <button className="ghost-button" onClick={() => applyPreset("week")}>
            Diese Woche
          </button>
          <button className="ghost-button" onClick={() => applyPreset("month")}>
            Dieser Monat
          </button>
        </div>
      </div>

      {isLoading ? (
        <p style={{ padding: "24px", textAlign: "center", color: "#5c6874" }}>
          Lade Monitoring-Daten...
        </p>
      ) : error ? (
        <div className="alert alert-error" style={{ margin: "0 24px" }}>
          {error}
        </div>
      ) : (
        <>
          <div className="monitoring-stats-row">
            <div className="monitoring-stat-card">
              <strong>{uniqueUserIds.size}</strong>
              <span>Nutzer</span>
            </div>
            <div className="monitoring-stat-card">
              <strong>{totalLogins}</strong>
              <span>Logins</span>
            </div>
            <div className="monitoring-stat-card">
              <strong>{totalVisits}</strong>
              <span>Besuche</span>
            </div>
          </div>

          <h3 className="monitoring-section-title">Unique Logins pro Tag</h3>
          <UsageChart
            stats={chartStats}
            selectedDay={selectedDay}
            onDayClick={handleDayClick}
          />

          {selectedDay ? (
            <DayDetail
              date={selectedDay}
              logs={dayLogs}
              isLoading={isDayLoading}
              onClose={() => setSelectedDay(null)}
            />
          ) : null}

          <h3 className="monitoring-section-title">Nutzer-Übersicht</h3>
          <UserTable users={userSummary} />
        </>
      )}
    </ModalShell>
  );
}

interface UserSummaryRow {
  userId: string;
  userName: string;
  logins: number;
  visits: number;
}

function buildUserSummary(logs: MonitoringLogEntry[]): UserSummaryRow[] {
  const map = new Map<
    string,
    { userName: string; logins: number; visits: number }
  >();
  for (const log of logs) {
    const existing = map.get(log.user_id);
    if (existing) {
      if (log.action === "login") existing.logins++;
      if (log.action === "session_start") existing.visits++;
    } else {
      map.set(log.user_id, {
        userName: log.user_name,
        logins: log.action === "login" ? 1 : 0,
        visits: log.action === "session_start" ? 1 : 0,
      });
    }
  }
  return Array.from(map.entries())
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => b.logins - a.logins || b.visits - a.visits);
}

function UserTable({ users }: { users: UserSummaryRow[] }) {
  if (users.length === 0) {
    return (
      <p
        style={{
          padding: "0 24px 24px",
          color: "#5c6874",
          fontSize: "0.85rem",
        }}
      >
        Keine Nutzer im gewählten Zeitraum.
      </p>
    );
  }

  return (
    <div className="monitoring-user-table">
      <div className="monitoring-user-row monitoring-user-header">
        <span>Nutzer</span>
        <span>Logins</span>
        <span>Besuche</span>
      </div>
      {users.map((user) => (
        <div key={user.userId} className="monitoring-user-row">
          <span>
            {user.userName}
            <span className="monitoring-user-id">{user.userId}</span>
          </span>
          <span>{user.logins}</span>
          <span>{user.visits}</span>
        </div>
      ))}
    </div>
  );
}

function DayDetail({
  date,
  logs,
  isLoading,
  onClose,
}: {
  date: string;
  logs: MonitoringLogEntry[];
  isLoading: boolean;
  onClose: () => void;
}) {
  const formatted = format(new Date(date), "EEEE, dd. MMMM yyyy", {
    locale: de,
  });

  const userRows = buildDayUserRows(logs);

  return (
    <div className="monitoring-day-detail">
      <div className="monitoring-day-detail-header">
        <strong>{formatted}</strong>
        <button className="ghost-button" onClick={onClose}>
          ×
        </button>
      </div>
      {isLoading ? (
        <p style={{ color: "#5c6874", fontSize: "0.85rem" }}>Lade...</p>
      ) : userRows.length === 0 ? (
        <p style={{ color: "#5c6874", fontSize: "0.85rem" }}>
          Keine Aktivität an diesem Tag.
        </p>
      ) : (
        <div className="monitoring-user-table">
          <div className="monitoring-user-row monitoring-user-header">
            <span>Nutzer</span>
            <span>Logins</span>
            <span>Besuche</span>
            <span>Aktionen</span>
          </div>
          {userRows.map((row) => (
            <div key={row.userId} className="monitoring-user-row">
              <span>{row.userName}</span>
              <span>{row.logins}</span>
              <span>{row.visits}</span>
              <span className="monitoring-actions-cell">
                {row.actions.length > 0
                  ? row.actions.map(formatAction).join(", ")
                  : "–"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DayUserRow {
  userId: string;
  userName: string;
  logins: number;
  visits: number;
  actions: string[];
}

function buildDayUserRows(logs: MonitoringLogEntry[]): DayUserRow[] {
  const map = new Map<
    string,
    { userName: string; logins: number; visits: number; actions: Set<string> }
  >();
  for (const log of logs) {
    const existing = map.get(log.user_id);
    if (existing) {
      if (log.action === "login") existing.logins++;
      else if (log.action === "session_start") existing.visits++;
      else existing.actions.add(log.action);
    } else {
      map.set(log.user_id, {
        userName: log.user_name,
        logins: log.action === "login" ? 1 : 0,
        visits: log.action === "session_start" ? 1 : 0,
        actions:
          log.action !== "login" && log.action !== "session_start"
            ? new Set([log.action])
            : new Set(),
      });
    }
  }
  return Array.from(map.entries())
    .map(([userId, data]) => ({
      userId,
      userName: data.userName,
      logins: data.logins,
      visits: data.visits,
      actions: [...data.actions],
    }))
    .sort((a, b) => b.logins - a.logins || b.visits - a.visits);
}

function UsageChart({
  stats,
  selectedDay,
  onDayClick,
}: {
  stats: MonitoringDailyStats[];
  selectedDay: string | null;
  onDayClick: (date: string) => void;
}) {
  if (stats.length === 0) {
    return (
      <div className="monitoring-chart-scroll">
        <p style={{ textAlign: "center", color: "#5c6874", padding: "24px" }}>
          Noch keine Daten vorhanden.
        </p>
      </div>
    );
  }

  const dayWidth = 48;
  const paddingY = 28;
  const yAxisWidth = 36;
  const height = 220;
  const chartHeight = height - paddingY * 2;
  const minChartPx = 680;
  const naturalWidth = stats.length * dayWidth + 20;
  const svgWidth = Math.max(naturalWidth, minChartPx);

  const maxUsers = Math.max(...stats.map((s) => s.unique_users), 1);
  const niceMax = getNiceMax(maxUsers);

  const spacing =
    stats.length > 1 ? (svgWidth - 20) / stats.length : svgWidth / 2;

  const points = stats.map((s, i) => {
    const x = stats.length > 1 ? 10 + i * spacing + spacing / 2 : svgWidth / 2;
    const y = paddingY + chartHeight - (s.unique_users / niceMax) * chartHeight;
    return { x, y, date: s.date, value: s.unique_users };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const labelInterval = Math.max(1, Math.floor(stats.length / 10));

  return (
    <div className="monitoring-chart-wrapper">
      <svg
        className="monitoring-chart-yaxis"
        width={yAxisWidth}
        height={height}
        viewBox={`0 0 ${yAxisWidth} ${height}`}
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = paddingY + chartHeight - ratio * chartHeight;
          const value = Math.round(niceMax * ratio);
          return (
            <text
              key={ratio}
              x={yAxisWidth - 4}
              y={y + 3}
              textAnchor="end"
              fontSize="10"
              fill="#5c6874"
            >
              {value}
            </text>
          );
        })}
      </svg>
      <div className="monitoring-chart-scroll">
        <svg
          width={svgWidth}
          height={height}
          viewBox={`0 0 ${svgWidth} ${height}`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = paddingY + chartHeight - ratio * chartHeight;
            return (
              <line
                key={ratio}
                x1={0}
                y1={y}
                x2={svgWidth}
                y2={y}
                stroke="#eef0f3"
                strokeWidth="1"
              />
            );
          })}

          <polyline
            points={polyline}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={selectedDay === p.date ? 7 : 5}
              fill={
                selectedDay === p.date
                  ? "var(--color-accent-deep)"
                  : "var(--color-accent)"
              }
              stroke="var(--color-surface)"
              strokeWidth="2"
              className="monitoring-dot"
              onClick={() => onDayClick(p.date)}
            />
          ))}

          {points
            .filter((_, i) => i % labelInterval === 0 || i === stats.length - 1)
            .map((p, i) => (
              <text
                key={i}
                x={p.x}
                y={height - 4}
                textAnchor="middle"
                fontSize="9"
                fill="#5c6874"
              >
                {format(new Date(p.date), "dd.MM.")}
              </text>
            ))}
        </svg>
      </div>
    </div>
  );
}

function getNiceMax(value: number): number {
  if (value <= 5) return Math.max(value, 2);
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  if (normalized <= 1.5) return Math.ceil(1.5 * magnitude);
  if (normalized <= 3) return Math.ceil(3 * magnitude);
  if (normalized <= 5) return Math.ceil(5 * magnitude);
  return Math.ceil(10 * magnitude);
}

function formatAction(action: string): string {
  switch (action) {
    case "blocker_created":
      return "Blocker erstellt";
    case "blocker_edited":
      return "Blocker bearbeitet";
    case "blocker_deleted":
      return "Blocker gelöscht";
    case "analysis_viewed":
      return "Analyse angesehen";
    default:
      return action;
  }
}
