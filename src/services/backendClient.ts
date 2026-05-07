import type { AworkUser, CreateProjectTaskPayload, CreateTaskSchedulePayload } from "../types/awork";

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_BASE_URL ?? "http://localhost:5174";

interface AuthStatusResponse {
  authenticated: boolean;
  user?: unknown;
}

interface TaskScheduleQuery {
  from: string;
  to: string;
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
    return {
      authenticated: response.authenticated,
      user: response.user ? mapUser(response.user) : undefined,
    };
  }

  async logout(): Promise<void> {
    await this.request("/auth/logout", { method: "POST" });
  }

  async getCurrentUser(): Promise<AworkUser> {
    return mapUser(await this.request<unknown>("/api/me"));
  }

  async getTaskSchedules(query: TaskScheduleQuery): Promise<unknown> {
    const params = new URLSearchParams({
      from: query.from,
      to: query.to,
    });
    return this.request<unknown>(`/api/taskschedules?${params.toString()}`);
  }

  async getMyProjectTasks(): Promise<unknown> {
    return this.request<unknown>("/api/me/projecttasks?pageSize=1000");
  }

  async getProjects(): Promise<unknown> {
    return this.request<unknown>("/api/projects");
  }

  async getProjectTasks(projectId: string): Promise<unknown> {
    return this.request<unknown>(`/api/projects/${encodeURIComponent(projectId)}/projecttasks`);
  }

  async createProjectTask(projectId: string, payload: CreateProjectTaskPayload): Promise<unknown> {
    return this.request<unknown>(`/api/projects/${encodeURIComponent(projectId)}/projecttasks`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async createTaskSchedule(payload: CreateTaskSchedulePayload): Promise<unknown> {
    return this.request<unknown>("/api/taskschedules", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateTaskSchedule(scheduleId: string, payload: unknown): Promise<unknown> {
    return this.request<unknown>(`/api/taskschedules/${encodeURIComponent(scheduleId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async deleteTaskSchedule(scheduleId: string): Promise<unknown> {
    return this.request<unknown>(`/api/taskschedules/${encodeURIComponent(scheduleId)}`, {
      method: "DELETE",
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    try {
      const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...init.headers,
        },
      });

      // If backend is starting up (503), wait and retry
      if (response.status === 503) {
        return this.handleBackendStarting<T>(path, init);
      }

      if (!response.ok) {
        const message = await safeReadError(response);
        throw new Error(message || `Backend request failed with status ${response.status}.`);
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

  private async handleBackendStarting<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.isBackendStarting) {
      this.isBackendStarting = true;
      this.notifyStatusChange("starting");
    }

    // Wait 3 seconds for backend to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check if backend is healthy
    const isHealthy = await this.checkBackendHealth();

    if (isHealthy) {
      this.isBackendStarting = false;
      this.notifyStatusChange("ok");
      // Retry the original request
      return this.request<T>(path, init);
    } else {
      // Still starting, wait more and try again
      return this.handleBackendStarting<T>(path, init);
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

function mapUser(rawUser: unknown): AworkUser {
  const userRecord = unwrapRecord(rawUser);
  const id = userRecord ? readString(userRecord, "id") ?? readString(userRecord, "userId") : undefined;

  if (!userRecord || !id) {
    throw new Error("The authenticated awork user could not be mapped.");
  }

  return {
    id,
    firstName: readString(userRecord, "firstName"),
    lastName: readString(userRecord, "lastName"),
    email: readString(userRecord, "email"),
  };
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

function readString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}
