# AGENTS.md

## Mission

React planner UI for awork users to load, group, create, move, delete, and analyze planned task blockers through the local backend.

## Stack and commands

- React 19 + TypeScript + Vite
- `npm run dev` — local frontend
- `npm run build` — TypeScript + Vite build
- `npm run preview` — preview built app

## Read first

- `src/App.tsx` — main workflow orchestration
- `src/services/backendClient.ts` — backend contract and retry behavior
- `src/services/scheduleMapper.ts` — raw awork schedule mapping
- `src/services/scheduleGrouping.ts` — grouping rules and DST tolerance
- `src/services/projectTaskMapper.ts` / `projectMapper.ts` / `absenceMapper.ts`
- `src/components/CreateScheduleGroupPanel.tsx`
- `src/components/CapacityAnalysisPage.tsx`
- `src/types/awork.ts` / `src/types/planner.ts`

## Architecture

- The browser talks to the local backend only. No direct `api.awork.com` calls from the frontend.
- `App.tsx` owns auth restoration, planner-user selection, schedule loading, modal state, and workflow switching.
- `BackendClient` wraps every backend request, includes credentials, and retries while the backend cold-starts.
- Raw awork payloads are normalized in mapper files before the UI uses them.
- Capacity analysis is a first-class workflow, not a side widget.

## Hard invariants

- Keep the backend boundary intact. New awork data should usually mean a backend route + frontend mapper, not a browser-side awork call.
- User-facing planner copy is currently German. Match existing tone unless the task explicitly changes language.
- `plannedDuration` is **seconds** in awork payloads.
- `scheduleMapper.ts` is the source of truth for task-schedule field guessing and ownership extraction. Fix schema drift there first.
- `groupSchedules()` groups by project/task/weekday/start/end and splits continuity gaps with a 6-8 day tolerance for DST. Preserve that behavior unless the grouping rule itself changes.
- Planner-user switching is part of the current app contract. `selectedPlannerUserId` affects load/create/update/delete flows; keep its payload/query wiring aligned with the backend.
- Team selection is intentionally heuristic: `teamFilter.ts` currently narrows users to PDS/SIM-like team paths.
- Capacity inputs are local browser preferences stored in localStorage; auth is not.
- Backend startup latency is expected. Preserve the existing retry/status behavior before adding harder failure UX.
- If docs and code disagree, prefer `App.tsx` + service code over README prose.

## Change rules

- Smallest safe diff. Most behavior changes belong in one orchestrator or one mapper, not a new abstraction layer.
- Read the component and its service helper together before editing.
- Prefer extending existing mapper/service utilities over copying awork field fallbacks into components.
- Keep accessibility basics intact: labels, button semantics, modal focus expectations, and loading/error states.

---

## Feature: Projekt einplanen

**Files:** `src/components/ProjectPlanPanel.tsx` · `src/services/autoPlanScheduler.ts`

### What it does

The "Projekt einplanen" workflow lets a user select a project, pick unscheduled tasks, and have the scheduler automatically generate time blockers. The user can manually adjust individual blockers before confirming creation.

---

### User flow

1. User selects a project → tasks are loaded via `onLoadProjectTasks`
2. Only tasks with `scheduledCount === 0` appear ("ungeplant")
3. User sets global options: working days, start/end time, distribution mode, allow overbooking, optional global weekly budget
4. Each task shows a duration field (hours) and a source badge (awork Zeit / Wochenbudget / manuell)
5. User checks tasks to include → clicks **Vorschau anzeigen**
6. A preview panel shows all planned blockers; each blocker can be individually edited or deleted
7. User clicks **Einplanen** → all payloads are created via `onCreate`

---

### Duration sources and their semantics

Every task has a duration value and a source:

| Badge | Condition | What the number means | Weekly cap in scheduler |
|---|---|---|---|
| **awork Zeit** | `task.plannedDurationSeconds > 0`, not manually edited | Total effort for entire task (from awork "Geplanter Aufwand") | `ceil(total / countIsoWeeksInRange)` — spread evenly |
| **Wochenbudget** | No awork time, not manually edited, global `weeklyBudgetHours` is set | Hours per week from global budget input | `weeklyBudgetHours` directly |
| **manuell** | User has typed into the duration field | Total hours for the task (same semantics as awork Zeit) | `ceil(total / countIsoWeeksInRange)` if timeframe exists, else `undefined` |

**Key rule:** "awork Zeit" and "manuell" always mean *total hours for the task's full duration*, never per-week. The scheduler derives the per-week cap by dividing by `countIsoWeeksInRange(startOn, dueOn)`. Wochenbudget is the only source where the input itself is per-week.

Helper: `aworkWeeklyBudgetSeconds(task)` — the bridge function in `ProjectPlanPanel.tsx` that returns the correct `weeklyBudgetSeconds` value for each case.

---

### Scheduler: `buildProjectTaskPlan` (autoPlanScheduler.ts)

Takes a `ProjectTaskPlanInput` and returns a `ProjectTaskPlanResult` with `payloads: CreateTaskSchedulePayload[]`.

**Two modes inside the scheduler:**

- **Weekly cap mode** (`weeklyBudgetSeconds > 0`): calls `buildAutoPlan` once per ISO week with `requestedMinutes = weeklyBudgetMinutes`. Total scheduled = `weeklyBudgetMinutes × countIsoWeeksInRange`. Used for all tasks that have a timeframe (awork, manual, and Wochenbudget).
- **Total budget mode** (`weeklyBudgetSeconds` absent): uses `plannedDurationSeconds` as a single total, fills front-loaded respecting existing blockers and capacity. Used when there is no valid `startOn`/`dueOn`.

`buildAutoPlan` fills one week day-by-day. In **even** mode it divides remaining minutes equally across remaining candidate days. In **packed** mode it fills each day to capacity before moving on.

`countIsoWeeksInRange` counts ISO calendar weeks between two dates (used both in the component divisor and the scheduler multiplier — they must match).

---

### Pending manual payloads

The modal ("Manuell Blocker anlegen") does **not** create blockers immediately. Blockers are accumulated as **pending** and only created when the user confirms the preview.

State: `pendingManualPayloads: Record<taskId, { payloads: CreateTaskSchedulePayload[]; remainingMinutes: number }>`

**On modal save (`handleManualSave`):**
- Stores payloads in `pendingManualPayloads[taskId]`
- Computes `remainingMinutes = max(0, openMinutes - sum(newly added payloads beyond the algo count))`
- Removes the task from `selectedIds` (algo won't re-plan it)
- Clears the task's `taskPlanHints` entry
- Syncs any existing preview in-place: removes old payloads for that task, appends new ones

**On preview (`handlePreview`):**
- Pending payloads are converted to `AworkTaskSchedule` and injected into `accumulated` **before** the algo loop, so the scheduler treats those slots as occupied and won't re-fill them
- After the algo loop, pending payloads are appended to `preview.payloads` alongside auto-planned ones

**On confirm (`handleConfirm`):**
- Sends `preview.payloads` (which already includes both auto + pending) to `onCreate`
- Clears `pendingManualPayloads` and `selectedIds`

**`prepareTaskPlanHint` short-circuit:** if a task has pending payloads, the `?` hint popover shows them directly without re-running the algo.

---

### Task row badges (second row)

Tasks get a second row when they are overbooked or have pending payloads:

- **Red left border + `is-overbooked`**: task has remaining unplanned minutes (`taskOpenMinutes > 0`) and no pending payloads
- **Blue left border + `has-pending`**: task has pending manual payloads saved
- Both badges can appear together when pending payloads exist but still leave hours uncovered (`pendingRemainingMinutes > 0`)

Every task row always shows a pen icon (✎) in the meta row that opens `ManualResolveModal` via `openManualResolve(task, taskOpenMinutes, algorithmPayloads)`.

---

### ManualResolveModal

Props: `task`, `openMinutes`, `plannedPayloads`, `userId`, `defaultStartTime`, `defaultEndTime`, `onClose`, `onSave`.

- `plannedPayloads`: payloads already planned (either algo output or previously saved pending) — shown as editable existing rows
- User can click any row to edit its date/start/end inline
- User can add new blockers via the form at the bottom
- `remainingOpen = max(0, openMinutes - sum(newly added payloads beyond plannedPayloads.length))`
- When `openMinutes === 0` the orange "X h konnten nicht automatisch eingeplant werden" banner is hidden; only the project window is shown
- On "Speichern & schließen": calls `onSave(allPayloads)` — all rows including newly added ones

---

### False overlap prevention

`getPayloadPreviewOverlapCount` checks each preview payload against `existingSchedules + all other payloads`. Without the pending-payload injection, the algo would re-fill a pending task's time slots for other tasks, causing false overlap warnings. The fix: pending payloads are injected into `accumulated` before the algo runs in both `handlePreview` and `prepareTaskPlanHint`.

---

### Invariants to preserve

- `plannedDuration` in `CreateTaskSchedulePayload` is **seconds**, not minutes.
- `aworkWeeklyBudgetSeconds` must divide by the same week-counting function (`countIsoWeeksInRange`) that the scheduler multiplies by — otherwise total scheduled hours drift from the awork planned time.
- Pending payloads must always be injected into `accumulated` before any `buildProjectTaskPlan` call, or the algo will double-book those slots.
- `handleManualSave` must sync the existing preview (remove stale, add new) so the preview stays consistent without a full re-run.
- Do not make `buildProjectTaskPlan` calls directly in the UI — always go through `handlePreview` or `prepareTaskPlanHint` so pending payload injection happens correctly.
