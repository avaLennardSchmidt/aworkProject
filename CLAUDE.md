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

## Useful awork docs

- Append `.md` to `developers.awork.com` pages for clean Markdown.
- Relevant docs for this repo: authentication, permissions, projects, tasks, task schedules, users, pagination, filtering, rate limits, and error handling.
