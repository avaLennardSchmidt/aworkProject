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
4. For existing groups, click **Load planned tasks**, pick a row, preview the changes, and apply them.
5. For new groups, review the generated blocker preview, then create them. If you choose **New task**, the app creates the awork project task first and then plans blockers for that new task.

## Safety Rule

Only the authenticated awork user's own planned task schedules are shown as editable. There is no user selector, team selector, colleague selector, or admin mode. The app re-checks schedule ownership before preview and again before each update. New planned blockers are created only with the authenticated user's awork user id. Creating a new task is a real project change in awork and requires the signed-in user to have permission in that project.

## Known Limitation

The awork task schedule response shape may need adjustment after testing against real API data. Field mapping and ownership checks are isolated in `src/services/scheduleMapper.ts`, so changing candidate response fields should be contained there.
