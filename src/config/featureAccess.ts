/**
 * Feature Access - Fetched from Backend
 *
 * The authorization list is managed on the backend via MULTI_EDIT_AUTHORIZED_USERS env var.
 * This frontend module handles fetching and caching the access check.
 */

const BACKEND_BASE_URL = (
  import.meta.env.VITE_BACKEND_BASE_URL ?? "http://localhost:5174"
).replace(/\/$/, "");

let cachedFeatureAccess: { multiEdit: boolean } | null = null;

/**
 * Fetch user's feature access from backend API
 */
export async function fetchUserFeatureAccess(): Promise<{ multiEdit: boolean }> {
  if (cachedFeatureAccess) {
    return cachedFeatureAccess;
  }

  try {
    const response = await fetch(`${BACKEND_BASE_URL}/api/features/access`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();
      cachedFeatureAccess = data as { multiEdit: boolean };
      return cachedFeatureAccess;
    }
  } catch (error) {
    console.warn("Could not fetch feature access from backend:", error);
  }

  // Default: no access if fetch fails
  return { multiEdit: false };
}

/**
 * Clear cached feature access (call when user logs out)
 */
export function clearFeatureAccessCache(): void {
  cachedFeatureAccess = null;
}

/**
 * Check if current user is authorized for multi-edit
 */
export async function isAuthorizedForMultiEdit(): Promise<boolean> {
  const access = await fetchUserFeatureAccess();
  return access.multiEdit;
}
