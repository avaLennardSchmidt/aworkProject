# CLAUDE.md

Read `AGENTS.md` first. If this file and `AGENTS.md` differ, follow `AGENTS.md`.

## Working posture

- Keep the diff boring and local. `App.tsx` is large, but adding another layer is usually worse than a focused edit.
- This UI is data-contract heavy. Correct mapping and mutation payloads matter more than component cleverness.
- Do not add packages for formatting dates, state, fetch, modals, or forms; the repo already has enough primitives.

## Frontend-specific rules

- Route awork shape fixes into the mapper/service layer first, not into JSX branches.
- `BackendClient` is the transport contract. If request/response behavior changes, update it and its callers together.
- Treat backend ownership checks as mandatory, but keep the frontend prechecks too; the double-check is intentional.
- Preserve German planner wording unless the task explicitly changes copy strategy.
- Keep localStorage limited to UI preferences/cache-like state such as capacity inputs. Never move awork tokens into browser storage.
- When touching planner-user behavior, inspect all four paths:
  - schedule load
  - create schedule group
  - update/delete schedule
  - capacity analysis
- When touching schedule grouping, verify both recurring weekly grouping and continuity-gap splitting logic.
- When README and code differ, trust the code path in `App.tsx`, `backendClient.ts`, and the mapper files.

## Validation

- Use `npm run build` for frontend changes.
- If a change affects mapper or grouping logic, prefer one focused check over broad rewrites.

## Projekt einplanen — quick reference

Full documentation is in `AGENTS.md` under "Feature: Projekt einplanen". Key things to know before touching that feature:

- **Duration semantics**: "awork Zeit" and "manuell" = total hours for the task's full duration, divided by `countIsoWeeksInRange` to get the weekly cap. "Wochenbudget" = hours per week directly. Never treat awork `plannedDurationSeconds` as a weekly figure.
- **Pending payloads**: the manual-blocker modal does not create immediately — payloads accumulate in `pendingManualPayloads` and are only sent to `onCreate` at confirm. Always inject pending payloads into `accumulated` before any `buildProjectTaskPlan` call.
- **Week-counting alignment**: `aworkWeeklyBudgetSeconds` divides by `countIsoWeeksInRange`; the scheduler multiplies by `countIsoWeeksInRange`. These must use the same function or total scheduled hours drift.
- **Overlap prevention**: pending payloads injected as occupied schedules before the algo prevents false "Überschneidung" warnings in the preview.

## Useful awork docs

- Append `.md` to `developers.awork.com` pages for clean Markdown.
- Relevant docs for this repo: authentication, permissions, projects, tasks, task schedules, users, pagination, filtering, rate limits, and error handling.
