# Data-Reliability Audit — awork Capacity Planner

**Date:** 2026-07-13
**Scope:** `aworkProjectFrontend` + `backend` — data accuracy only (no UX). Full pipeline: awork API → backend proxy → frontend mappers → capacity math → rendered numbers.
**Method:** three parallel code audits (backend, frontend services, capacity calculations); every Critical/Major finding below was re-verified line-by-line against the source.

---

## Fix status (2026-07-13)

Fixed in this pass:
- **C1** — `/taskschedules` now fetched via `fetchPagedAworkItems` (both the `filterby` path and the range path).
- **C2** — documented: awork capacity is weekly working-hours configuration, never range-scoped; the echoed `from`/`to` describe the schedule range only.
- **C3** — network-error retry now replays only GET/HEAD; mutations surface a clear error instead of risking duplicate writes (503 replay kept — a received 503 means the request was never processed).
- **M1** — weeks and days now count only the overlapping minutes of each schedule (`getScheduleOverlapMinutes`; day view splits multi-day schedules into per-day segments).
- **M2** — per-day absence fraction capped at 1.0 across overlapping records; a one-day absence with both half-day flags counts as 0.5 instead of 0.
- **M4** — GUID comparisons normalized to lowercase (`isOwnRawSchedule`, `formatAworkGuidLiteral`, capacity grouping).
- **M5** — invalid `from`/`to` now returns 400 on `/api/taskschedules` and `/api/analysis/capacity`.
- **M8** — `entityId`/`entityName` no longer used as project fields for private tasks; tasks carry `isPrivate`, and unresolved hints distinguish "Private Aufgabe" from real failures.
- **Overload definition** — a user is overloaded when the planned share of effective capacity exceeds the Kunden-Ziel % (e.g. 50 % planned vs. 40 % goal); the `targetHours > 0` guard was removed and the summary-card tooltip corrected.

Still open: M3, M6, M7, M9–M13 and the Minor findings.

## Critical

### C1. Task schedules are fetched WITHOUT pagination — silent large-scale data loss
`backend/src/server.ts:1000-1014` — `fetchTaskSchedulesForRange` and the `filterby` path of `fetchTaskSchedulesForUser` (`:938-941`) use `fetchAworkItems`, which issues a **single** request with no `page`/`pageSize` params. Every other list endpoint uses `fetchPagedAworkItems`.
**Failure:** workspace has more schedules than awork's default page size → the capacity analysis and planner silently operate on the first page only. A user whose schedules sort past page 1 appears empty/underbooked. No error is raised anywhere.
**Fix:** route `/taskschedules` through `fetchPagedAworkItems`.

### C2. Capacity endpoint ignores the requested date range
`backend/src/server.ts:970-978` — `fetchUserCapacity` calls `/users/{id}/capacity` with no `from`/`to`, yet the `/api/analysis/capacity` response echoes the requested range (`:326-332`) as if capacities were scoped to it.
**Failure:** utilization = September schedules ÷ capacity of whatever default window awork returns. Numbers are presented as range-scoped but aren't.
**Fix:** pass the range to awork (or document/verify that per-user capacity is range-independent weekly config and stop implying range scoping).

### C3. Connection-drop retry can double-create schedules (duplicate blockers)
`aworkProjectFrontend/src/services/backendClient.ts:316-318, 333-339, 342-372` — `request()` funnels 503s and network `TypeError`s into `handleBackendStarting`, which **replays the original request verbatim**, including `POST /api/taskschedules`, PUT and DELETE. A network `TypeError` also occurs when the connection drops *after* the request was sent (backend restart mid-response).
**Failure:** `createTaskSchedule` POST succeeds in awork, response is lost → retry creates a **second identical schedule**. No idempotency key exists; the UI reports one success; the duplicate double-counts in every capacity number until someone notices.
**Fix:** only auto-replay idempotent requests (GET). For mutations, surface the error, or add an idempotency key / existence check before re-posting.

---

## Major

### M1. Schedules spanning range/week boundaries are dropped or fully booked into the wrong week
`aworkProjectFrontend/src/components/CapacityAnalysisPage.tsx:2483-2493` (mirrored `:2581-2585`) — weekly bucketing uses **start time only** against weeks clipped to the selected range, while the backend deliberately returns schedules that merely *overlap* the range (`backend/src/server.ts:1045-1047`).
**Failures (verified):**
- Schedule Fri 14:00 → Mon 10:00, range starting Mon: returned by backend, start falls in no clipped week → **0 h counted anywhere** (totals, table, CSV).
- Schedule starting on the range's last day but ending days later: **full duration** counted inside the range → week shows phantom overload.
- Any Fri→Mon schedule books its whole duration into Friday's ISO week.
**Fix:** clip each schedule to the week interval and count only the overlapping minutes (or split multi-day schedules per day).

### M2. Overlapping absences double-count; week view and day view disagree
`aworkProjectFrontend/src/services/absenceMapper.ts:52-67` — `calculateAbsentFractionForDay` sums fractions across overlapping absence records with no cap at 1.0 per day.
**Failures (verified):**
- Same Monday covered by two absence records → fraction 2.0 → week path (`CapacityAnalysisPage.tsx:2523-2532`) deducts 2 days of capacity for 1 absent day → utilization inflated.
- Day path caps at day capacity (`:2632-2635`), week path doesn't cap per-day → expanded day rows no longer sum to the week row (contradicting the code comment at `:2570-2572`).
- Sub-case: one-day absence with both `isHalfDayOnStart` and `isHalfDayOnEnd` → fraction 0 → treated as **not absent at all** (`:59-64`).
**Fix:** cap the per-day fraction at 1.0 (merge overlapping absences per day) and handle the both-half-flags single-day case.

### M3. `fetchPagedAworkItems` early-termination can silently truncate lists
`backend/src/server.ts:886-924` — breaks when `items.length < pageSize` (1000). If awork caps the effective page size below 1000, page 1 returns fewer items and the loop stops — users/projects/absences/assignedtasks silently truncated. `totalItems` from the response is never consulted; `maxPages = 25` is another silent cap. Also breaks when a page contains only already-seen items, even if later pages hold unseen ones.
**Fix:** verify awork's max page size; use the response's `totalItems`/paging metadata to detect truncation and log/flag it.

### M4. Case-sensitive GUID comparison can empty a user's planner
`backend/src/server.ts:863-865` — `isOwnRawSchedule` compares user GUIDs with strict `===`, no case normalization; `formatAworkGuidLiteral` (`:1102-1104`) doesn't normalize either.
**Failure:** casing mismatch between the client-supplied `userId` and awork's returned GUIDs → all schedules filtered out → `/api/taskschedules?userId=…` returns `[]` for a user who has schedules; PUT/DELETE return spurious 403s (`:566`, `:609`).
**Fix:** lowercase both sides before comparing.

### M5. Invalid `from`/`to` yields empty results with HTTP 200
`backend/src/server.ts:1079-1100, 1041-1047` — an unparseable range boundary becomes `NaN`; `startTime < NaN` is always false → **every schedule filtered out**, returned as a successful empty response. Looks like "nobody is booked".
**Fix:** reject unparseable `from`/`to` with a 400.

### M6. Mixed timezone semantics at range/day boundaries
- Backend: schedule timestamps parsed via `Date.parse` (server-local for offset-less strings) vs date-only boundaries built in UTC (`server.ts:1039-1040, 1086-1094`).
- Frontend: `parseISO(schedule.start)` converts UTC to local, then buckets against **local** week/day boundaries (`CapacityAnalysisPage.tsx:2484-2487, 2604`), while absences deliberately use UTC date parts (`absenceMapper.ts:4-10`).
**Failure:** schedules near midnight UTC land in the wrong day/week or get dropped at range edges (CEST: `…T22:30Z` Sunday counts as Monday). Backend and frontend demonstrably use different day conventions.
**Fix:** pick one convention (UTC calendar days, matching the absence mapper) for both sides.

### M7. Silent partial drops of unmappable schedules
`aworkProjectFrontend/src/services/scheduleMapper.ts:18-22` produces warnings for schedules missing id/taskId/start/end, but `CapacityAnalysisPage.tsx:2358` never reads them, and `App.tsx` only surfaces warnings when **all** schedules drop.
**Failure:** 3 of 40 schedules fail mapping → user sees 37 with zero indication → planned load understated.
**Fix:** surface mapping warnings (count + affected users) in the analysis header.

### M8. Private tasks fabricate a "project" via `entityId`
`aworkProjectFrontend/src/services/projectTaskMapper.ts:21, 31` — `entityId`/`entityName` are used as projectId/projectName candidates. For awork **private tasks**, `entityId` is the *user's* GUID and `entityName` the user's name.
**Failure:** a private task from `/users/{id}/assignedtasks` is attributed to a fake project named after the user; grouping keys on the bogus id.
**Fix:** only use `entityId` when `baseType === "projecttask"`; classify `baseType === "private"` explicitly (this is also the clean detector for the "Project not resolved / Unsichtbare Aufgabe" case).

### M9. `taskName` can capture the schedule's own `name`, permanently
`aworkProjectFrontend/src/services/scheduleMapper.ts:57` — candidate list ends with top-level `"name"`, which on a task-schedule object is the *schedule's* name, not the task's. Enrichment (`scheduleEnrichment.ts:21`) only fills nullish values, so a wrong non-null pick is never repaired and becomes the group label/sort key.
**Fix:** drop `"name"` from the taskName candidates, or let enrichment prefer the resolved task's name.

### M10. Ownership guards are decorative on the schedule write path
- Frontend: `App.tsx:1103-1106` and `CapacityAnalysisPage.tsx:2360-2365` stamp `userId: user.id` onto every schedule before `isOwnSchedule` runs → the check is a tautology; updater/deleter gates never block anything.
- Backend: PUT/DELETE ownership is checked against a **client-supplied** `userId` query param (`server.ts:560, 603`), and PUT forwards `req.body` verbatim *after* the check — the body can reassign the schedule to another user post-check.
**Failure:** a frontend bug passing the wrong `userId` can edit/delete another user's schedule while the code appears to prevent exactly that. Real enforcement is only whatever awork does with the caller's token.
**Fix:** backend should resolve the actor from the session, not the query string, and validate/whitelist body fields on PUT.

### M11. Task creation partial-failure states
`backend/src/server.ts:481-516` — task is created, then assignees set, then re-fetched. If `setassignees` or the re-fetch throws → 500, but the task exists unassigned (client retry duplicates it). If the created-task id can't be extracted → **200 success with assignment silently skipped**.
**Fix:** return the partial state explicitly; never report success when assignment was skipped.

### M12. Per-user capacity failures silently remove users from the analysis
`backend/src/server.ts:313-321` — `catch { return null; }` per user; unbounded `Promise.all` fan-out invites awork 429s.
**Failure:** rate-limited users vanish from `userCapacities` while keeping schedules → rendered as 0 capacity → overloaded users look free. No error flag in the response.
**Fix:** report per-user fetch failures in the payload; limit concurrency.

### M13. Concurrent token refresh race can invalidate a session
`backend/src/sessionStore.ts:142-166` — no locking; two parallel requests refresh with the same (possibly single-use) refresh token; out-of-order writes can persist a stale token → all requests fail until re-login. Reliability issue, not data corruption.
**Fix:** single-flight the refresh per session.

---

## Minor

- **Negative durations clamped silently** — `CapacityAnalysisPage.tsx:344-347, 2489-2492, 2595-2598`: corrupted end<start schedules count 0 h but still increment blocker counts → hours and blocker counts can disagree. DST-crossing blocks count elapsed minutes, not wall-clock.
- **Zero-capacity weeks report exactly 100%** — `CapacityAnalysisPage.tsx:2540-2551`: fully-absent week with planned hours is indistinguishable from perfectly full; aggregate `isOverloaded` (`:2700-2707`) requires `targetHours > 0`, so a fully-absent overplanned user never appears in "Überlastete Nutzer".
- **Summary tooltip describes the wrong formula** — `CapacityAnalysisPage.tsx:1471`: claims "geplante Stunden übersteigen Gesamtkapazität", actual comparison is against the Kunden-Ziel (`plannedHours > targetHours`).
- **Unresolved-project bucket merges distinct projects, first-writer-wins name** — `CapacityAnalysisPage.tsx:2495-2516`: schedules with a projectName but no projectId merge into the generic unresolved bucket; label depends on code path ("Project not resolved" from enrichment vs the never-reached German fallback). Totals are unaffected.
- **Absence deduction assumes a 5-day week** — `CapacityAnalysisPage.tsx:2529-2532, 2625, 2634`: `absentHours = absentDays × weeklyHours/5` ignores awork's per-weekday capacity detail (fetched at `:2196-2201` but summed away). Part-timers get wrong per-day deductions.
- **Dedupe fallback key can collapse distinct items** — `backend/src/server.ts:909-916`: items without a string `id`/`taskId` dedupe on `JSON.stringify(item).slice(0,200)`; records with long identical leading fields collide → silent drop.
- **Schedule user attribution falls back to task assignee** — `backend/src/server.ts:875-883`: candidate paths include `task.userId`/`task.user.id`; a schedule without its own userId is attributed to the task's assignee — wrong for multi-assignee/reassigned tasks. Same candidate list on the frontend (`scheduleMapper.ts:60-68`).
- **POST /api/taskschedules forwards conflicting user fields** — `backend/src/server.ts:533-539`: body spread + `userId` override can send both `user.id` and `userId`; awork decides which wins.
- **Midnight-spanning schedule edits produce multi-day blockers** — `scheduleTimeCalculator.ts:68-77`: editing a 22:00→02:00 schedule to 09:00–17:00 yields a ~32 h blocker; callers only reject `duration <= 0`.
- **Auto-plan single-day branch ignores window/capacity** — `autoPlanScheduler.ts:434-452`: places the full requested duration at the start time, even past midnight, regardless of `endTime`/capacity/`allowOverbooking`. Also `countIsoWeeksInRange` (`:708-720`) counts partial weeks as full → inflated weekly budgets on Fri→Mon ranges.
- **Closed-project detection is English-only on statusName** — `projectMapper.ts:84-94`: German custom status names ("Abgeschlossen") not caught unless `statusType`/`closedOn` present.
- **`getUsers` can throw on a null array entry** — `backendClient.ts:131-134`; also deactivated users are dropped, so their historical schedules have no user row.
- **Retry trigger is browser-dependent** — `backendClient.ts:335`: Safari's network error message lacks "fetch", so the startup retry never fires there (accidentally the safer behavior; see C3).
- **DST fragmentation of grouped series** — `scheduleGrouping.ts:60-68`: UTC-fixed weekly series split into two groups across a DST boundary (display only).
- **Activity-log stats undercount** — `activityLog.ts:134-139`: fallback select has no explicit limit; Supabase `max_rows` (default 1000) silently truncates counts.
- **Latent:** `CapacityAnalysisPage.tsx:337-378` computes a second, unfiltered `plannedMinutes`/`projectTotals` that no display path uses today — any future consumer would diverge from the week-based totals. `weekCount` (`:316`) is unused.

---

## Known limitation (by design, needs classification, not fixing)

**awork private tasks are unresolvable by any other user's token.** The whole proxy runs on the viewer's OAuth token; awork hides private tasks (and tasks in private projects the viewer isn't a member of) even from admins. Their schedules still appear in `/taskschedules` (times only), so they surface as "Project not resolved / Unknown task". awork's own UI shows the same slots as "Unsichtbare Aufgabe". Recommended: classify 403/404 task lookups (and `baseType === "private"`, see M8) as a first-class "Private / nicht sichtbare Aufgabe" category instead of an error, and disable the delete action for it.

---

## Verified-clean areas

- No cross-user token/data leakage: sessions keyed by 256-bit random IDs, tokens set per-request, no response caching (except a harmless `Cache-Control: public` on profile images).
- No double counting across weeks (weeks partition the range) or across users (per-user fetch + per-user storage; `allSchedules` only used for name resolution).
- Formula chain "verfügbar / Kunden-Ziel / geplant %" is internally consistent (`target = effective × Kunden%`, aggregate = Σ weekly).
- Unit conversions (seconds→hours, minutes→hours) and display rounding correct; rounding never feeds back into computations.
- CSV export reads the same week rows as the UI.
- Absence UTC parsing, half-day fractions (single absence), weekend exclusion, and partial-week capacity scaling are correct.
- Auto-plan core slot math (overlap subtraction, window clamping) correct in multi-day paths.
- `scheduleUpdater.buildUpdatePayload` rewrites all date-field aliases, no stale alias survives an update.

---

## Suggested fix order

1. **C1** unpaginated `/taskschedules` (invisible, workspace-wide data loss)
2. **C3** mutation replay / duplicate blockers (writes bad data into awork)
3. **C2** range-less capacity fetch
4. **M1** span-boundary bucketing + **M2** absence double-count (the two that make today's numbers wrong)
5. **M4/M5** GUID casing + NaN range (silent-empty failure modes)
6. **M8** private-task classification (also resolves the "Project not resolved" UX confusion)
