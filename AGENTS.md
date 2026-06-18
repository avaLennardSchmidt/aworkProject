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
