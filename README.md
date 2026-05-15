# awork Self-Service Bulk Planner

A React + TypeScript MVP for bulk-editing the time window of your own awork task schedules. It is intended for recurring weekly planner blockers where changing each blocker manually would be slow.

The app uses a small local backend for awork OAuth. Do not use awork API keys from **API-Keys verwalten** for this workflow; those keys are not user-specific.

## Run Locally

Start the backend first:

```bash
cd /Users/ASG-LESC-MBA/Documents/GitHub/backend
cp .env.example .env
npm install
npm run dev
```

Fill `/Users/ASG-LESC-MBA/Documents/GitHub/backend/.env` with your awork OAuth client id and client secret before running the backend.

Then start the frontend:

```bash
cd /Users/ASG-LESC-MBA/Documents/GitHub/aworkProjectFrontend
npm install
npm run dev
```

Open the local Vite URL shown in the terminal.

## Using The App

1. Click **Sign in with awork**.
2. Log in with your own awork account.
3. Choose one workflow:
   - **Manage existing groups** loads your existing planned task blockers, groups them by project/task/weekday/time, and lets you bulk-change their time window after a preview.
   - **Create new group** lets you select a project, choose an existing task or create a new project task, then select a weekly date/time period for new planned blockers.
   - **Team capacity analysis** is available from the planner user section for any signed-in user.
4. For existing groups, click **Load planned tasks**, pick a row, preview the changes, and apply them.
5. For new groups, review the generated blocker preview, then create them. If you choose **New task**, the app creates the awork project task first and then plans blockers for that new task.

## What Is A Blocker Group?

A blocker group is a set of planned awork task schedule entries that the app treats as one recurring pattern. This lets you change the same recurring blocker across many dates at once.

Planned blockers are grouped together only when all of these values match:

- project id
- task id
- weekday
- start time
- end time

The actual calendar date does not need to match. For example, every Wednesday 07:00-12:00 blocker for the same task in the same project becomes one group, even when those blockers happen on different Wednesdays.

## Team Capacity Analysis

Any signed-in user can open **Team capacity analysis** from the planner user section. The analysis page loads the selected date range for all users, lets you include or exclude users, and shows planned project time against each user's configured capacity.

Capacity inputs are stored per browser:

- weekly hours
- customer target percentage

The calendar-week blocks show capacity per ISO calendar week. If the selected date range starts or ends mid-week, the first or last week is prorated to only the selected days. Each week block uses the user's weekly hours as 100% capacity, and the yellow marker shows the configured customer target. If planned project blockers exceed capacity, the week can go above 100%.

The analysis uses the same planned task schedule loading and ownership filtering as **Manage existing groups**, so planned hours should match the blockers shown for the same user and date range. The analysis does not reduce capacity for absence, holidays, sick leave, public holidays, vacation, or other non-project availability data.

## Safety Rule

Only the authenticated awork user's own planned task schedules are shown as editable. There is no user selector, team selector, colleague selector, or admin mode. The app re-checks schedule ownership before preview and again before each update. New planned blockers are created only with the authenticated user's awork user id. Creating a new task is a real project change in awork and requires the signed-in user to have permission in that project.

## Known Limitation

The awork task schedule response shape may need adjustment after testing against real API data. Field mapping and ownership checks are isolated in `src/services/scheduleMapper.ts`, so changing candidate response fields should be contained there.
