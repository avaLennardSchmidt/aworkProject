import type {
  AworkUserCapacity,
  AworkUser,
  CreateProjectTaskPayload,
  CreateTaskSchedulePayload,
} from "../types/awork";
import { isUserInPdsOrSimTeam } from "./teamFilter";

const BACKEND_BASE_URL = (
  import.meta.env.VITE_BACKEND_BASE_URL ?? "http://localhost:5174"
).replace(/\/$/, "");

const LOCAL_STORAGE_KEY = "awork_planner_session";

/**
 * Reads the session ID from localStorage (shared across all tabs).
 * The session ID is an opaque random string — NOT a token.
 * Actual OAuth tokens remain server-side only.
 */
export function getStoredSessionId(): string | null {
  return localStorage.getItem(LOCAL_STORAGE_KEY);
}

export function storeSessionIdFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("session");
  if (id) {
    localStorage.setItem(LOCAL_STORAGE_KEY, id);
  }
}

export function clearStoredSessionId(): void {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
}

interface AuthStatusResponse {
  authenticated: boolean;
  user?: unknown;
}

interface TaskScheduleQuery {
  from: string;
  to: string;
  userId?: string;
}

interface CapacityAnalysisQuery {
  from: string;
  to: string;
}

export interface MonitoringLogEntry {
  id: number;
  timestamp: string;
  user_id: string;
  user_name: string;
  action: string;
  details: string | null;
}

export interface MonitoringDailyStats {
  date: string;
  total_events: number;
  unique_users: number;
  logins: number;
  session_starts: number;
  blockers_created: number;
  blockers_edited: number;
  blockers_deleted: number;
  analysis_views: number;
}

type BackendStatusListener = (status: "ok" | "starting") => void;

export class BackendClient {
  private statusListeners: Set<BackendStatusListener> = new Set();
  private isBackendStarting = false;

  onStatusChange(listener: BackendStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private notifyStatusChange(status: "ok" | "starting") {
    this.statusListeners.forEach((listener) => listener(status));
  }

  async checkBackendHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/auth/status`, {
        credentials: "include",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok || response.status === 401;
    } catch {
      return false;
    }
  }

  getLoginUrl(): string {
    return `${BACKEND_BASE_URL}/auth/login`;
  }

  async getAuthStatus(): Promise<{ authenticated: boolean; user?: AworkUser }> {
    const response = await this.request<AuthStatusResponse>("/auth/status");
    if (!response.authenticated) {
      clearStoredSessionId();
    }
    return {
      authenticated: response.authenticated,
      user: response.user ? mapUser(response.user) : undefined,
    };
  }

  async logout(): Promise<void> {
    await this.request("/auth/logout", { method: "POST" });
    clearStoredSessionId();
  }

  async getCurrentUser(): Promise<AworkUser> {
    return mapUser(await this.request<unknown>("/api/me"));
  }

  async getUsers(): Promise<AworkUser[]> {
    const response = await this.request<unknown>("/api/users");
    return extractArray(response)
      .filter((u) => {
        const rec = u as Record<string, unknown>;
        return !rec.isDeactivated;
      })
      .map(mapNullableUser)
      .filter((user): user is AworkUser => Boolean(user))
      .filter(isUserInPdsOrSimTeam)
      .sort((a, b) => formatUserName(a).localeCompare(formatUserName(b)));
  }

  async getTaskSchedules(query: TaskScheduleQuery): Promise<unknown> {
    const params = new URLSearchParams({
      from: query.from,
      to: query.to,
    });
    if (query.userId) {
      params.set("userId", query.userId);
    }
    return this.request<unknown>(`/api/taskschedules?${params.toString()}`);
  }

  async getCapacityAnalysis(query: CapacityAnalysisQuery): Promise<unknown> {
    const params = new URLSearchParams({
      from: query.from,
      to: query.to,
    });
    return this.request<unknown>(`/api/analysis/capacity?${params.toString()}`);
  }

  async getAbsences(): Promise<unknown> {
    return this.request<unknown>("/api/absences");
  }

  async getMyProjectTasks(): Promise<unknown> {
    return this.request<unknown>("/api/me/projecttasks?pageSize=1000");
  }

  async getUserAssignedTasks(userId: string): Promise<unknown> {
    return this.request<unknown>(
      `/api/users/${encodeURIComponent(userId)}/assignedtasks`,
    );
  }

  async getUserCapacity(userId: string): Promise<AworkUserCapacity> {
    return mapUserCapacity(
      await this.request<unknown>(
        `/api/users/${encodeURIComponent(userId)}/capacity`,
      ),
      userId,
    );
  }

  async getTask(taskId: string): Promise<unknown> {
    return this.request<unknown>(`/api/tasks/${encodeURIComponent(taskId)}`);
  }

  async getProjects(): Promise<unknown> {
    return this.request<unknown>("/api/projects");
  }

  async getProjectTasks(projectId: string): Promise<unknown> {
    return this.request<unknown>(
      `/api/projects/${encodeURIComponent(projectId)}/projecttasks`,
    );
  }

  async createProjectTask(
    projectId: string,
    payload: CreateProjectTaskPayload,
  ): Promise<unknown> {
    return this.request<unknown>(
      `/api/projects/${encodeURIComponent(projectId)}/projecttasks`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  }

  async createTaskSchedule(
    payload: CreateTaskSchedulePayload,
  ): Promise<unknown> {
    return this.request<unknown>("/api/taskschedules", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateTaskSchedule(
    scheduleId: string,
    payload: unknown,
    userId?: string,
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (userId) {
      params.set("userId", userId);
    }
    return this.request<unknown>(
      `/api/taskschedules/${encodeURIComponent(scheduleId)}${params.size ? `?${params.toString()}` : ""}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
  }

  async deleteTaskSchedule(
    scheduleId: string,
    userId?: string,
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (userId) {
      params.set("userId", userId);
    }
    return this.request<unknown>(
      `/api/taskschedules/${encodeURIComponent(scheduleId)}${params.size ? `?${params.toString()}` : ""}`,
      {
        method: "DELETE",
      },
    );
  }

  async getMonitoringAccess(): Promise<{ hasAccess: boolean }> {
    return this.request<{ hasAccess: boolean }>("/api/monitoring/access");
  }

  async getMonitoringLogs(options?: {
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<MonitoringLogEntry[]> {
    const params = new URLSearchParams();
    if (options?.from) params.set("from", options.from);
    if (options?.to) params.set("to", options.to);
    if (options?.limit) params.set("limit", String(options.limit));
    const query = params.size ? `?${params.toString()}` : "";
    return this.request<MonitoringLogEntry[]>(`/api/monitoring/logs${query}`);
  }

  async getMonitoringStats(
    from: string,
    to: string,
  ): Promise<MonitoringDailyStats[]> {
    const params = new URLSearchParams({ from, to });
    return this.request<MonitoringDailyStats[]>(
      `/api/monitoring/stats?${params.toString()}`,
    );
  }

  async trackActivity(action: string, details?: string): Promise<void> {
    await this.request("/api/monitoring/track", {
      method: "POST",
      body: JSON.stringify({ action, details }),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const sessionId = getStoredSessionId();
    try {
      const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(sessionId ? { "X-Session-Token": sessionId } : {}),
          ...init.headers,
        },
      });

      // If backend is starting up (503), wait and retry
      if (response.status === 503) {
        return this.handleBackendStarting<T>(path, init);
      }

      if (!response.ok) {
        const message = await safeReadError(response);
        throw new Error(
          message || `Backend request failed with status ${response.status}.`,
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }

      this.notifyStatusChange("ok");
      return response.json() as Promise<T>;
    } catch (error) {
      // Connection error likely means backend is starting
      if (error instanceof TypeError && error.message.includes("fetch")) {
        return this.handleBackendStarting<T>(path, init);
      }
      throw error;
    }
  }

  private async handleBackendStarting<T>(
    path: string,
    init: RequestInit,
    attempt = 0,
  ): Promise<T> {
    const maxAttempts = 10; // Stop after ~30 seconds
    if (attempt >= maxAttempts) {
      this.isBackendStarting = false;
      this.notifyStatusChange("ok");
      throw new Error(
        "Backend did not start in time. Please refresh the page and try again.",
      );
    }

    if (!this.isBackendStarting) {
      this.isBackendStarting = true;
      this.notifyStatusChange("starting");
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const isHealthy = await this.checkBackendHealth();

    if (isHealthy) {
      this.isBackendStarting = false;
      this.notifyStatusChange("ok");
      return this.request<T>(path, init);
    } else {
      return this.handleBackendStarting<T>(path, init, attempt + 1);
    }
  }
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const raw = (await response.json()) as unknown;
    if (isRecord(raw) && typeof raw.error === "string") {
      return raw.error;
    }
    return JSON.stringify(raw).slice(0, 500);
  } catch {
    return "";
  }
}

export function mapUser(rawUser: unknown): AworkUser {
  const userRecord = unwrapRecord(rawUser);
  const id = userRecord
    ? (readString(userRecord, "id") ?? readString(userRecord, "userId"))
    : undefined;

  if (!userRecord || !id) {
    throw new Error("The authenticated awork user could not be mapped.");
  }

  return {
    id,
    firstName: readString(userRecord, "firstName"),
    lastName: readString(userRecord, "lastName"),
    email: readString(userRecord, "email"),
    raw: rawUser,
  };
}

function mapNullableUser(rawUser: unknown): AworkUser | undefined {
  try {
    return mapUser(rawUser);
  } catch {
    return undefined;
  }
}

function mapUserCapacity(
  rawCapacity: unknown,
  fallbackUserId: string,
): AworkUserCapacity {
  const record = unwrapRecord(rawCapacity);
  const weeklyCapacity = isRecord(record?.weeklyCapacity)
    ? Object.fromEntries(
        Object.entries(record.weeklyCapacity).filter(
          ([, value]) => typeof value === "number",
        ),
      )
    : undefined;

  return {
    userId:
      record && typeof record.userId === "string"
        ? record.userId
        : fallbackUserId,
    weeklyCapacity,
    capacityPerWeek:
      record && typeof record.capacityPerWeek === "number"
        ? record.capacityPerWeek
        : undefined,
  };
}

function formatUserName(user: AworkUser): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email ||
    user.id
  );
}

function extractArray(response: unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }
  if (!isRecord(response)) {
    return [];
  }
  const candidates = [
    response.items,
    response.data,
    response.results,
    response.users,
  ];
  const arrayCandidate = candidates.find(Array.isArray);
  return arrayCandidate ?? [];
}

function unwrapRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (isRecord(value.data)) {
    return value.data;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}
