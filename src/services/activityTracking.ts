import { backendClient, type ActivityAction } from "./backendClient";

// Client-side debounce for passive navigation events so browsing doesn't spam
// the activity log. The backend debounces too (defence in depth); this just
// avoids the needless round-trips. 10 min per action, matching the server.
const DEBOUNCE_MS = 10 * 60 * 1000;
const lastSent = new Map<ActivityAction, number>();

/** Fire-and-forget activity tracking; failures are swallowed. */
export function trackActivity(
  action: ActivityAction,
  metadata?: Record<string, unknown>,
): void {
  const now = Date.now();
  const previous = lastSent.get(action);
  if (previous !== undefined && now - previous < DEBOUNCE_MS) {
    return;
  }
  lastSent.set(action, now);
  void backendClient.trackActivity(action, metadata).catch(() => {});
}
