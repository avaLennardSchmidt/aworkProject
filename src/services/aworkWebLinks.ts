/**
 * Builds deep links into the awork web app. awork uses the item KEY (not the
 * GUID) in its human-facing URLs, e.g.
 *   https://avasis.awork.com/tasks/HAUS-6/details
 *   https://avasis.awork.com/projects/APUA
 *
 * The workspace base is configurable via VITE_AWORK_WEB_BASE_URL so other
 * tenants can point elsewhere without a code change.
 */
const RAW_BASE =
  import.meta.env.VITE_AWORK_WEB_BASE_URL ?? "https://avasis.awork.com";

// Normalise: drop any trailing slash so we can join path segments cleanly.
const WEB_BASE = RAW_BASE.replace(/\/+$/, "");

/** Link to a task's detail page, or null when the key is unknown. */
export function taskWebUrl(key: string | undefined | null): string | null {
  const trimmed = key?.trim();
  if (!trimmed) {
    return null;
  }
  return `${WEB_BASE}/tasks/${encodeURIComponent(trimmed)}/details`;
}

/** Link to a project's overview page, or null when the key is unknown. */
export function projectWebUrl(key: string | undefined | null): string | null {
  const trimmed = key?.trim();
  if (!trimmed) {
    return null;
  }
  return `${WEB_BASE}/projects/${encodeURIComponent(trimmed)}`;
}
