import { useEffect, useState, useCallback, useMemo } from "react";
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
  MonitoringTotals,
} from "../services/backendClient";
import { DatePickerInput } from "./DatePickerInput";
import { ModalShell } from "./ModalShell";

type Metric = "nutzer" | "logins" | "besuche" | "aktionen";
type ChartMode = Metric | "alle";

const METRIC_LABEL: Record<Metric, string> = {
  nutzer: "Unique Nutzer pro Tag",
  logins: "Logins pro Tag",
  besuche: "Besuche pro Tag",
  aktionen: "Aktionen pro Tag",
};

const CHART_TITLE: Record<ChartMode, string> = {
  ...METRIC_LABEL,
  alle: "Alle Statistiken pro Tag",
};

function dailyActions(s: MonitoringDailyStats): number {
  return (
    s.blockers_created +
    s.blockers_edited +
    s.blockers_deleted +
    s.analysis_views
  );
}

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
  const [selectedMetric, setSelectedMetric] = useState<ChartMode>("nutzer");
  const [totals, setTotals] = useState<MonitoringTotals | null>(null);

  useEffect(() => {
    let cancelled = false;
    backendClient
      .getMonitoringTotals()
      .then((data) => {
        if (!cancelled) setTotals(data);
      })
      .catch(() => {
        if (!cancelled) setTotals(null);
      });
    return () => {
      cancelled = true;
    };
  }, [backendClient]);

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
  const totalActions = chartStats.reduce((s, d) => s + dailyActions(d), 0);
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

      {totals ? <TotalsSection totals={totals} /> : null}

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
            <StatCard
              label="Nutzer"
              value={users.length}
              metric="nutzer"
              active={selectedMetric === "nutzer"}
              onSelect={setSelectedMetric}
            />
            <StatCard
              label="Logins"
              value={totalLogins}
              metric="logins"
              active={selectedMetric === "logins"}
              onSelect={setSelectedMetric}
            />
            <StatCard
              label="Besuche"
              value={totalVisits}
              metric="besuche"
              active={selectedMetric === "besuche"}
              onSelect={setSelectedMetric}
            />
            <StatCard
              label="Aktionen"
              value={totalActions}
              metric="aktionen"
              active={selectedMetric === "aktionen"}
              onSelect={setSelectedMetric}
            />
          </div>

          <InsightStrip
            stats={chartStats}
            users={users}
            totalVisits={totalVisits}
            totalActions={totalActions}
          />

          <div className="monitoring-section-head">
            <h3 className="monitoring-section-title">
              {CHART_TITLE[selectedMetric]}
            </h3>
            <button
              type="button"
              className={`monitoring-all-toggle${selectedMetric === "alle" ? " active" : ""}`}
              onClick={() =>
                setSelectedMetric((m) => (m === "alle" ? "nutzer" : "alle"))
              }
            >
              {selectedMetric === "alle" ? "Einzelansicht" : "Alle anzeigen"}
            </button>
          </div>
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

          <ActivityBreakdown stats={chartStats} />

          <UserTableSection
            users={userSummary}
            from={from}
            to={to}
          />
        </>
      )}
    </ModalShell>
  );
}

function StatCard({
  label,
  value,
  metric,
  active,
  onSelect,
}: {
  label: string;
  value: number;
  metric: Metric;
  active: boolean;
  onSelect: (m: Metric) => void;
}) {
  return (
    <button
      type="button"
      className={`monitoring-stat-card monitoring-stat-card--${metric}${active ? " active" : ""}`}
      onClick={() => onSelect(metric)}
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  );
}

/* ── All-time totals ("Gesamt-Statistik") ───────────────────────── */

function TotalsSection({ totals }: { totals: MonitoringTotals }) {
  const [open, setOpen] = useState(false);
  const tiles = [
    { label: "Events gesamt", value: totals.total_events, accent: "#1d2329" },
    { label: "Logins", value: totals.logins, accent: "#4f7cf7" },
    { label: "Besuche", value: totals.session_starts, accent: "#f59e3a" },
    { label: "Aktive Nutzer", value: totals.unique_users, accent: "var(--color-accent)" },
    { label: "Blocker erstellt", value: totals.blockers_created, accent: "var(--color-accent)" },
    { label: "Blocker bearbeitet", value: totals.blockers_edited, accent: "#4f7cf7" },
    { label: "Blocker gelöscht", value: totals.blockers_deleted, accent: "#b8323a" },
    { label: "Analyse-Aufrufe", value: totals.analysis_views, accent: "#0891b2" },
  ];

  const since =
    totals.first_event != null
      ? format(new Date(totals.first_event), "dd. MMM yyyy", { locale: de })
      : null;

  return (
    <section className="monitoring-totals" data-open={open}>
      <button
        type="button"
        className="monitoring-totals-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div>
          <span className="monitoring-totals-eyebrow">Gesamt-Statistik</span>
          <h3 className="monitoring-totals-title">Seit Beginn der Aufzeichnung</h3>
        </div>
        <div className="monitoring-totals-head-right">
          {since ? (
            <span className="monitoring-totals-since">
              seit {since} · {totals.active_days} aktive{" "}
              {totals.active_days === 1 ? "Tag" : "Tage"}
            </span>
          ) : null}
          <svg
            className="monitoring-totals-chevron"
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>
      {open ? (
        <div className="monitoring-totals-grid">
          {tiles.map((t) => (
            <div
              key={t.label}
              className="monitoring-total-tile"
              style={{ ["--tile-accent" as string]: t.accent }}
            >
              <strong className="monitoring-total-value">
                {t.value.toLocaleString("de-DE")}
              </strong>
              <span className="monitoring-total-label">{t.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ── Insight tiles ("Auf einen Blick") ──────────────────────────── */

function InsightStrip({
  stats,
  users,
  totalVisits,
  totalActions,
}: {
  stats: MonitoringDailyStats[];
  users: MonitoringUserStats[];
  totalVisits: number;
  totalActions: number;
}) {
  const peak = useMemo(
    () =>
      stats.reduce<MonitoringDailyStats | null>(
        (best, s) =>
          !best || s.unique_users > best.unique_users ? s : best,
        null,
      ),
    [stats],
  );

  const topUser = useMemo(
    () =>
      users.reduce<MonitoringUserStats | null>(
        (best, u) => (!best || u.visits > best.visits ? u : best),
        null,
      ),
    [users],
  );

  const avgVisits =
    users.length > 0 ? (totalVisits / users.length).toFixed(1) : "0";

  const tiles = [
    {
      label: "Aktivster Tag",
      value: peak && peak.unique_users > 0
        ? format(new Date(peak.date), "dd.MM.")
        : "–",
      sub:
        peak && peak.unique_users > 0
          ? `${peak.unique_users} Nutzer`
          : "keine Aktivität",
      accent: "var(--color-accent)",
    },
    {
      label: "Ø Besuche / Nutzer",
      value: avgVisits,
      sub: `${users.length} aktive Nutzer`,
      accent: "#f59e3a",
    },
    {
      label: "Top-Nutzer",
      value: topUser ? shortName(topUser.user_name) : "–",
      sub: topUser ? `${topUser.visits} Besuche` : "keine Daten",
      accent: "#4f7cf7",
    },
    {
      label: "Aktionen gesamt",
      value: String(totalActions),
      sub: "Blocker & Analysen",
      accent: "#0891b2",
    },
  ];

  return (
    <div className="monitoring-insights">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="monitoring-insight"
          style={{ ["--insight-accent" as string]: t.accent }}
        >
          <span className="monitoring-insight-label">{t.label}</span>
          <strong className="monitoring-insight-value" title={String(t.value)}>
            {t.value}
          </strong>
          <span className="monitoring-insight-sub">{t.sub}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Activity breakdown (composition of blocker + analysis actions) ─ */

function ActivityBreakdown({ stats }: { stats: MonitoringDailyStats[] }) {
  const parts = [
    {
      key: "created",
      label: "Blocker erstellt",
      value: stats.reduce((s, d) => s + d.blockers_created, 0),
      color: "var(--color-accent)",
    },
    {
      key: "edited",
      label: "Blocker bearbeitet",
      value: stats.reduce((s, d) => s + d.blockers_edited, 0),
      color: "#4f7cf7",
    },
    {
      key: "deleted",
      label: "Blocker gelöscht",
      value: stats.reduce((s, d) => s + d.blockers_deleted, 0),
      color: "#b8323a",
    },
    {
      key: "analysis",
      label: "Analyse-Aufrufe",
      value: stats.reduce((s, d) => s + d.analysis_views, 0),
      color: "#0891b2",
    },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);

  return (
    <>
      <h3 className="monitoring-section-title">Aktivität im Zeitraum</h3>
      <div className="monitoring-breakdown">
        {total === 0 ? (
          <p className="monitoring-breakdown-empty">
            Keine Aktionen im gewählten Zeitraum.
          </p>
        ) : (
          <>
            <div
              className="monitoring-breakdown-bar"
              role="img"
              aria-label={parts
                .map((p) => `${p.label}: ${p.value}`)
                .join(", ")}
            >
              {parts
                .filter((p) => p.value > 0)
                .map((p) => (
                  <span
                    key={p.key}
                    className="monitoring-breakdown-seg"
                    style={{
                      width: `${(p.value / total) * 100}%`,
                      background: p.color,
                    }}
                    title={`${p.label}: ${p.value}`}
                  />
                ))}
            </div>
            <div className="monitoring-breakdown-legend">
              {parts.map((p) => (
                <div key={p.key} className="monitoring-breakdown-item">
                  <span
                    className="monitoring-breakdown-dot"
                    style={{ background: p.color }}
                  />
                  <span className="monitoring-breakdown-name">{p.label}</span>
                  <strong className="monitoring-breakdown-count">
                    {p.value}
                  </strong>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

interface UserSummaryRow {
  userId: string;
  userName: string;
  logins: number;
  visits: number;
  actions: number;
  lastLoginTimestamp: string | null;
  lastVisitTimestamp: string | null;
}

function toSummaryRow(user: MonitoringUserStats): UserSummaryRow {
  return {
    userId: user.user_id,
    userName: user.user_name,
    logins: user.logins,
    visits: user.visits,
    actions: user.actions.length,
    lastLoginTimestamp: user.last_login,
    lastVisitTimestamp: user.last_visit,
  };
}

type SortKey = "userName" | "logins" | "visits" | "actions";

function UserTableSection({
  users,
  from,
  to,
}: {
  users: UserSummaryRow[];
  from: string;
  to: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("visits");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "userName" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const copy = [...users];
    copy.sort((a, b) => {
      let cmp: number;
      if (sortKey === "userName") {
        cmp = a.userName.localeCompare(b.userName);
      } else {
        cmp = a[sortKey] - b[sortKey];
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [users, sortKey, sortDir]);

  function exportCsv() {
    const header = ["Nutzer", "User-ID", "Logins", "Besuche", "Aktionen"];
    const rows = sorted.map((u) => [
      u.userName,
      u.userId,
      String(u.logins),
      String(u.visits),
      String(u.actions),
    ]);
    const csv = [header, ...rows]
      .map((cols) =>
        cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monitoring_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <>
      <div className="monitoring-section-header">
        <h3 className="monitoring-section-title monitoring-section-title--inline">
          Nutzer-Übersicht
        </h3>
        {users.length > 0 ? (
          <button
            type="button"
            className="ghost-button monitoring-export-btn"
            onClick={exportCsv}
          >
            CSV exportieren
          </button>
        ) : null}
      </div>

      {users.length === 0 ? (
        <p
          style={{
            padding: "0 24px 24px",
            color: "#5c6874",
            fontSize: "0.85rem",
          }}
        >
          Keine Nutzer im gewählten Zeitraum.
        </p>
      ) : (
        <div className="monitoring-user-table monitoring-user-table--4col">
          <div className="monitoring-user-row monitoring-user-header">
            <button
              type="button"
              className="monitoring-sort-btn"
              onClick={() => toggleSort("userName")}
            >
              Nutzer{arrow("userName")}
            </button>
            <button
              type="button"
              className="monitoring-sort-btn"
              onClick={() => toggleSort("logins")}
            >
              Logins{arrow("logins")}
            </button>
            <button
              type="button"
              className="monitoring-sort-btn"
              onClick={() => toggleSort("visits")}
            >
              Besuche{arrow("visits")}
            </button>
            <button
              type="button"
              className="monitoring-sort-btn"
              onClick={() => toggleSort("actions")}
            >
              Aktivität{arrow("actions")}
            </button>
          </div>
          {sorted.map((user) => (
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
              <span className="monitoring-stat-compact">{user.actions}</span>
            </div>
          ))}
        </div>
      )}
    </>
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
  metric: ChartMode;
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

  const METRICS: {
    key: Metric;
    label: string;
    color: string;
    colorDeep: string;
    getValue: (s: MonitoringDailyStats) => number;
  }[] = [
    {
      key: "nutzer",
      label: "Nutzer",
      color: "var(--color-accent)",
      colorDeep: "var(--color-accent-deep, #2a7d5f)",
      getValue: (s) => s.unique_users,
    },
    {
      key: "logins",
      label: "Logins",
      color: "#4f7cf7",
      colorDeep: "#2d5de8",
      getValue: (s) => s.logins,
    },
    {
      key: "besuche",
      label: "Besuche",
      color: "#f59e3a",
      colorDeep: "#d97e1a",
      getValue: (s) => s.session_starts,
    },
    {
      key: "aktionen",
      label: "Aktionen",
      color: "#0891b2",
      colorDeep: "#0e7490",
      getValue: dailyActions,
    },
  ];

  const isAll = metric === "alle";
  const activeMetrics = isAll
    ? METRICS
    : METRICS.filter((m) => m.key === metric);

  const dayWidth = 48;
  const paddingY = 28;
  const yAxisWidth = 36;
  const height = 220;
  const chartHeight = height - paddingY * 2;
  const minChartPx = 680;
  const naturalWidth = stats.length * dayWidth + 20;
  const svgWidth = Math.max(naturalWidth, minChartPx);

  const maxVal = Math.max(
    ...stats.flatMap((s) => activeMetrics.map((m) => m.getValue(s))),
    1,
  );
  const niceMax = getNiceMax(maxVal);

  const spacing =
    stats.length > 1 ? (svgWidth - 20) / stats.length : svgWidth / 2;

  const xOf = (i: number) =>
    stats.length > 1 ? 10 + i * spacing + spacing / 2 : svgWidth / 2;
  const yOf = (v: number) =>
    paddingY + chartHeight - (v / niceMax) * chartHeight;

  const series = activeMetrics.map((m) => {
    const points = stats.map((s, i) => ({
      x: xOf(i),
      y: yOf(m.getValue(s)),
      date: s.date,
      value: m.getValue(s),
    }));
    const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
    const areaPath =
      points.length > 0
        ? `M ${points[0].x},${paddingY + chartHeight} ` +
          points.map((p) => `L ${p.x},${p.y}`).join(" ") +
          ` L ${points[points.length - 1].x},${paddingY + chartHeight} Z`
        : "";
    return { ...m, points, polyline, areaPath };
  });

  // Single-metric view drives the fade, peak marker and dot interaction from
  // the one active series; the "alle" overlay reuses the same x positions.
  const primary = series[0];
  const points = primary.points;
  const color = primary.color;
  const colorDeep = primary.colorDeep;

  const peakIdx = points.reduce(
    (best, p, i) => (p.value > points[best].value ? i : best),
    0,
  );

  const gradientId = `mon-area-${metric}`;
  const labelInterval = Math.max(1, Math.floor(stats.length / 10));

  const tooltipW = 82;
  const tooltipH = 34;

  return (
    <>
      {isAll && (
        <div className="monitoring-chart-legend">
          {series.map((m) => (
            <span key={m.key} className="monitoring-chart-legend-item">
              <span
                className="monitoring-chart-legend-swatch"
                style={{ background: m.color }}
              />
              {m.label}
            </span>
          ))}
        </div>
      )}
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
            {/* The downward area fade is intentionally omitted in the "alle"
                overlay so four stacked lines stay readable. */}
            {!isAll && (
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
            )}
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

            {/* Hover guide (overlay mode) */}
            {isAll && hoveredIdx !== null && (
              <line
                x1={points[hoveredIdx].x}
                y1={paddingY}
                x2={points[hoveredIdx].x}
                y2={paddingY + chartHeight}
                stroke="#c7ccd2"
                strokeWidth="1"
                strokeDasharray="3 3"
                pointerEvents="none"
              />
            )}

            {!isAll && primary.areaPath && (
              <path
                d={primary.areaPath}
                fill={`url(#${gradientId})`}
                stroke="none"
              />
            )}

            {series.map((m) => (
              <polyline
                key={m.key}
                points={m.polyline}
                fill="none"
                stroke={m.color}
                strokeWidth={isAll ? 2 : 2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {/* Peak day outer ring — single-metric view only */}
            {!isAll && points.length > 1 && points[peakIdx].value > 0 && (
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

            {isAll
              ? // Small static markers per series + transparent column hit
                // areas so a whole day is hoverable/clickable.
                series.map((m) =>
                  m.points.map((p, i) => (
                    <circle
                      key={`${m.key}-${i}`}
                      cx={p.x}
                      cy={p.y}
                      r={hoveredIdx === i ? 4 : 2.5}
                      fill={m.color}
                      pointerEvents="none"
                    />
                  )),
                )
              : points.map((p, i) => (
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

            {isAll &&
              points.map((p, i) => (
                <rect
                  key={`hit-${i}`}
                  x={p.x - spacing / 2}
                  y={paddingY - 10}
                  width={spacing}
                  height={chartHeight + 20}
                  fill="transparent"
                  className="monitoring-dot"
                  onClick={() => onDayClick(p.date)}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              ))}

            {points
              .filter(
                (_, i) => i % labelInterval === 0 || i === stats.length - 1,
              )
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
                const anchor = points[hoveredIdx];
                const dateLabel = format(new Date(anchor.date), "dd. MMM", {
                  locale: de,
                });
                if (isAll) {
                  const rows = series.map((m) => ({
                    label: m.label,
                    color: m.color,
                    value: m.points[hoveredIdx].value,
                  }));
                  const tw = 118;
                  const th = 20 + rows.length * 15;
                  const tx = Math.max(
                    tw / 2 + 4,
                    Math.min(svgWidth - tw / 2 - 4, anchor.x),
                  );
                  const ty = Math.max(paddingY - 8, paddingY);
                  return (
                    <g pointerEvents="none">
                      <rect
                        x={tx - tw / 2}
                        y={ty}
                        width={tw}
                        height={th}
                        rx="6"
                        fill="#1e2a35"
                        opacity="0.94"
                      />
                      <text
                        x={tx - tw / 2 + 8}
                        y={ty + 14}
                        fontSize="9"
                        fill="#adb8c2"
                      >
                        {dateLabel}
                      </text>
                      {rows.map((r, ri) => (
                        <g key={r.label}>
                          <circle
                            cx={tx - tw / 2 + 11}
                            cy={ty + 24 + ri * 15}
                            r={3}
                            fill={r.color}
                          />
                          <text
                            x={tx - tw / 2 + 19}
                            y={ty + 27 + ri * 15}
                            fontSize="9.5"
                            fill="#e6eaee"
                          >
                            {r.label}
                          </text>
                          <text
                            x={tx + tw / 2 - 8}
                            y={ty + 27 + ri * 15}
                            textAnchor="end"
                            fontSize="9.5"
                            fontWeight="700"
                            fill="#fff"
                          >
                            {r.value}
                          </text>
                        </g>
                      ))}
                    </g>
                  );
                }
                const tx = Math.max(
                  tooltipW / 2 + 4,
                  Math.min(svgWidth - tooltipW / 2 - 4, anchor.x),
                );
                const ty = Math.max(paddingY - 8, anchor.y - tooltipH - 12);
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
                      {anchor.value}
                    </text>
                  </g>
                );
              })()}
          </svg>
        </div>
      </div>
    </>
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

function shortName(name: string): string {
  return name.length > 18 ? name.slice(0, 17) + "…" : name;
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
