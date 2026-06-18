import { useEffect, useState, useCallback } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import type {
  BackendClient,
  MonitoringUserStats,
  MonitoringDailyStats,
} from "../services/backendClient";
import { DatePickerInput } from "./DatePickerInput";
import { ModalShell } from "./ModalShell";

type Metric = "nutzer" | "logins" | "besuche";

interface MonitoringModalProps {
  backendClient: BackendClient;
  onClose: () => void;
}

export function MonitoringModal({
  backendClient,
  onClose,
}: MonitoringModalProps) {
  const [from, setFrom] = useState(() =>
    format(startOfWeek(new Date(), { locale: de }), "yyyy-MM-dd"),
  );
  const [to, setTo] = useState(() =>
    format(endOfWeek(new Date(), { locale: de }), "yyyy-MM-dd"),
  );
  const [stats, setStats] = useState<MonitoringDailyStats[]>([]);
  const [users, setUsers] = useState<MonitoringUserStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayUsers, setDayUsers] = useState<MonitoringUserStats[]>([]);
  const [isDayLoading, setIsDayLoading] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<Metric>("nutzer");

  const loadData = useCallback(
    (fromDate: string, toDate: string) => {
      setIsLoading(true);
      setError("");
      setSelectedDay(null);
      Promise.all([
        backendClient.getMonitoringStats(fromDate, toDate),
        backendClient.getMonitoringUserStats(fromDate, toDate),
      ])
        .then(([statsData, usersData]) => {
          setStats(statsData);
          setUsers(usersData);
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
      .getMonitoringUserStats(date, date)
      .then(setDayUsers)
      .catch(() => setDayUsers([]))
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
  const userSummary = users.map((u) => toSummaryRow(u));

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
            <button
              type="button"
              className={`monitoring-stat-card monitoring-stat-card--nutzer${selectedMetric === "nutzer" ? " active" : ""}`}
              onClick={() => setSelectedMetric("nutzer")}
            >
              <strong>{users.length}</strong>
              <span>Nutzer</span>
            </button>
            <button
              type="button"
              className={`monitoring-stat-card monitoring-stat-card--logins${selectedMetric === "logins" ? " active" : ""}`}
              onClick={() => setSelectedMetric("logins")}
            >
              <strong>{totalLogins}</strong>
              <span>Logins</span>
            </button>
            <button
              type="button"
              className={`monitoring-stat-card monitoring-stat-card--besuche${selectedMetric === "besuche" ? " active" : ""}`}
              onClick={() => setSelectedMetric("besuche")}
            >
              <strong>{totalVisits}</strong>
              <span>Besuche</span>
            </button>
          </div>

          <h3 className="monitoring-section-title">
            {selectedMetric === "nutzer"
              ? "Unique Nutzer pro Tag"
              : selectedMetric === "logins"
                ? "Logins pro Tag"
                : "Besuche pro Tag"}
          </h3>
          <UsageChart
            stats={chartStats}
            metric={selectedMetric}
            selectedDay={selectedDay}
            onDayClick={handleDayClick}
          />

          {selectedDay ? (
            <DayDetail
              date={selectedDay}
              rows={dayUsers.map((u) => toDayRow(u))}
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
  lastLoginTimestamp: string | null;
  lastVisitTimestamp: string | null;
}

function toSummaryRow(user: MonitoringUserStats): UserSummaryRow {
  return {
    userId: user.user_id,
    userName: user.user_name,
    logins: user.logins,
    visits: user.visits,
    lastLoginTimestamp: user.last_login,
    lastVisitTimestamp: user.last_visit,
  };
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
          <span className="monitoring-stat-compact">
            {user.logins}
            {user.lastLoginTimestamp && (
              <span className="monitoring-stat-time">
                {formatRelativeTime(user.lastLoginTimestamp)}
              </span>
            )}
          </span>
          <span className="monitoring-stat-compact">
            {user.visits}
            {user.lastVisitTimestamp && (
              <span className="monitoring-stat-time">
                {formatRelativeTime(user.lastVisitTimestamp)}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function DayDetail({
  date,
  rows,
  isLoading,
  onClose,
}: {
  date: string;
  rows: DayUserRow[];
  isLoading: boolean;
  onClose: () => void;
}) {
  const formatted = format(new Date(date), "EEEE, dd. MMMM yyyy", {
    locale: de,
  });

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
      ) : rows.length === 0 ? (
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
          {rows.map((row) => (
            <div key={row.userId} className="monitoring-user-row">
              <span>{row.userName}</span>
              <span className="monitoring-stat-compact">
                {row.logins}
                {row.lastLoginTimestamp && (
                  <span className="monitoring-stat-time">
                    {formatRelativeTime(row.lastLoginTimestamp)}
                  </span>
                )}
              </span>
              <span className="monitoring-stat-compact">
                {row.visits}
                {row.lastVisitTimestamp && (
                  <span className="monitoring-stat-time">
                    {formatRelativeTime(row.lastVisitTimestamp)}
                  </span>
                )}
              </span>
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
  lastLoginTimestamp: string | null;
  lastVisitTimestamp: string | null;
}

function toDayRow(user: MonitoringUserStats): DayUserRow {
  return {
    userId: user.user_id,
    userName: user.user_name,
    logins: user.logins,
    visits: user.visits,
    actions: user.actions,
    lastLoginTimestamp: user.last_login,
    lastVisitTimestamp: user.last_visit,
  };
}

function UsageChart({
  stats,
  metric,
  selectedDay,
  onDayClick,
}: {
  stats: MonitoringDailyStats[];
  metric: Metric;
  selectedDay: string | null;
  onDayClick: (date: string) => void;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (stats.length === 0) {
    return (
      <div className="monitoring-chart-scroll">
        <p style={{ textAlign: "center", color: "#5c6874", padding: "24px" }}>
          Noch keine Daten vorhanden.
        </p>
      </div>
    );
  }

  const getValue = (s: MonitoringDailyStats) =>
    metric === "nutzer"
      ? s.unique_users
      : metric === "logins"
        ? s.logins
        : s.session_starts;

  const color =
    metric === "nutzer"
      ? "var(--color-accent)"
      : metric === "logins"
        ? "#4f7cf7"
        : "#f59e3a";

  const colorDeep =
    metric === "nutzer"
      ? "var(--color-accent-deep, #2a7d5f)"
      : metric === "logins"
        ? "#2d5de8"
        : "#d97e1a";

  const dayWidth = 48;
  const paddingY = 28;
  const yAxisWidth = 36;
  const height = 220;
  const chartHeight = height - paddingY * 2;
  const minChartPx = 680;
  const naturalWidth = stats.length * dayWidth + 20;
  const svgWidth = Math.max(naturalWidth, minChartPx);

  const maxVal = Math.max(...stats.map(getValue), 1);
  const niceMax = getNiceMax(maxVal);

  const spacing =
    stats.length > 1 ? (svgWidth - 20) / stats.length : svgWidth / 2;

  const points = stats.map((s, i) => {
    const x = stats.length > 1 ? 10 + i * spacing + spacing / 2 : svgWidth / 2;
    const y = paddingY + chartHeight - (getValue(s) / niceMax) * chartHeight;
    return { x, y, date: s.date, value: getValue(s) };
  });

  const peakIdx = points.reduce(
    (best, p, i) => (p.value > points[best].value ? i : best),
    0,
  );

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const labelInterval = Math.max(1, Math.floor(stats.length / 10));

  const tooltipW = 82;
  const tooltipH = 34;

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
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Peak day outer ring */}
          {points.length > 1 && (
            <>
              <circle
                cx={points[peakIdx].x}
                cy={points[peakIdx].y}
                r={11}
                fill="none"
                stroke="#f5c842"
                strokeWidth="2"
                opacity="0.7"
                pointerEvents="none"
              />
              <text
                x={points[peakIdx].x}
                y={points[peakIdx].y - 14}
                textAnchor="middle"
                fontSize="10"
                fill="#c89b00"
                fontWeight="700"
                pointerEvents="none"
              >
                ★
              </text>
            </>
          )}

          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={hoveredIdx === i || selectedDay === p.date ? 7 : 5}
              fill={selectedDay === p.date ? colorDeep : color}
              stroke="var(--color-surface)"
              strokeWidth="2"
              className="monitoring-dot"
              onClick={() => onDayClick(p.date)}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
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

          {/* Hover tooltip — rendered last so it sits on top */}
          {hoveredIdx !== null &&
            (() => {
              const p = points[hoveredIdx];
              const dateLabel = format(new Date(p.date), "dd. MMM", {
                locale: de,
              });
              const tx = Math.max(
                tooltipW / 2 + 4,
                Math.min(svgWidth - tooltipW / 2 - 4, p.x),
              );
              const ty = Math.max(paddingY - 8, p.y - tooltipH - 12);
              return (
                <g pointerEvents="none">
                  <rect
                    x={tx - tooltipW / 2}
                    y={ty}
                    width={tooltipW}
                    height={tooltipH}
                    rx="6"
                    fill="#1e2a35"
                    opacity="0.92"
                  />
                  <text
                    x={tx}
                    y={ty + 13}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#adb8c2"
                  >
                    {dateLabel}
                  </text>
                  <text
                    x={tx}
                    y={ty + 27}
                    textAnchor="middle"
                    fontSize="13"
                    fontWeight="700"
                    fill="#fff"
                  >
                    {p.value}
                  </text>
                </g>
              );
            })()}
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

function formatRelativeTime(isoString: string): string {
  const now = new Date();
  const date = new Date(isoString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "gerade eben";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return format(date, "dd.MM");
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
