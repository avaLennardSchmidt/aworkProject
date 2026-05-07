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

export class BackendClient {
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
    const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const message = await safeReadError(response);
      throw new Error(message || `Backend request failed with status ${response.status}.`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
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
