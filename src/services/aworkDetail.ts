/**
 * Normalises awork's raw project/task objects into a fixed shape the detail
 * modals render. awork's field names vary a little between endpoints, so every
 * accessor tries a few candidate paths and falls back gracefully. Everything
 * here is read-only extraction — no fetching.
 */

type UnknownRecord = Record<string, unknown>;

export interface DetailAssignee {
  id: string;
  name?: string;
}

export interface ProjectDetail {
  name?: string;
  key?: string;
  statusName?: string;
  statusType?: string;
  companyId?: string;
  companyName?: string;
  projectTypeName?: string;
  teamNames: string[];
  tagNames: string[];
  startOn?: string;
  dueOn?: string;
  timeBudgetSeconds?: number;
  isBillable?: boolean;
  description?: string;
}

export interface TaskDetail {
  name?: string;
  key?: string;
  statusName?: string;
  statusType?: string;
  projectId?: string;
  projectName?: string;
  companyName?: string;
  typeOfWorkName?: string;
  listNames: string[];
  assignees: DetailAssignee[];
  tagNames: string[];
  startOn?: string;
  dueOn?: string;
  plannedSeconds?: number;
  priority?: boolean;
  numberOfSubtasks?: number;
  isSubtask?: boolean;
  parentTaskName?: string;
  checklistDone?: number;
  checklistTotal?: number;
  commentCount?: number;
  createdOn?: string;
  updatedOn?: string;
  description?: string;
}

export function extractProjectDetail(raw: unknown): ProjectDetail {
  const record = isRecord(raw) ? raw : {};
  return {
    name: firstString(record, ["name", "projectName"]),
    key: firstString(record, ["key", "projectKey"]),
    statusName: firstString(record, [
      "projectStatus.name",
      "status.name",
      "statusName",
    ]),
    statusType: firstString(record, [
      "projectStatus.type",
      "status.type",
      "statusType",
    ]),
    companyId: firstString(record, ["companyId", "company.id", "customerId"]),
    companyName: firstString(record, ["company.name", "customer.name"]),
    projectTypeName: firstString(record, [
      "projectType.name",
      "type.name",
      "projectTypeName",
    ]),
    teamNames: namesFrom(record, ["teams", "projectTeams"]),
    tagNames: namesFrom(record, ["tags"]),
    startOn: firstString(record, ["startDate", "startOn", "start"]),
    dueOn: firstString(record, ["dueDate", "dueOn", "endDate"]),
    timeBudgetSeconds: firstNumber(record, ["timeBudget", "plannedDuration"]),
    isBillable: firstBoolean(record, ["isBillableByDefault", "isBillable"]),
    description: firstString(record, ["description", "descriptionHtml"]),
  };
}

export function extractTaskDetail(raw: unknown): TaskDetail {
  const record = isRecord(raw) ? raw : {};
  return {
    name: firstString(record, ["name", "title"]),
    key: taskKeyOf(record),
    statusName: firstString(record, ["taskStatus.name", "status.name", "statusName"]),
    statusType: firstString(record, ["taskStatus.type", "status.type", "statusType"]),
    projectId: firstString(record, ["projectId", "project.id", "entityId", "entity.id"]),
    projectName: firstString(record, ["projectName", "project.name", "entityName", "entity.name"]),
    companyName: firstString(record, ["company.name", "project.company.name"]),
    typeOfWorkName: firstString(record, ["typeOfWork.name", "typeOfWorkName"]),
    listNames: namesFrom(record, ["lists", "taskLists"]),
    assignees: extractAssignees(record),
    tagNames: namesFrom(record, ["tags"]),
    startOn: firstString(record, ["startOn", "startDate"]),
    dueOn: firstString(record, ["dueOn", "dueDate"]),
    plannedSeconds: firstNumber(record, ["plannedDuration", "totalPlannedDuration"]),
    priority: firstBoolean(record, ["isPrio", "isPriority", "priority"]),
    numberOfSubtasks: firstNumber(record, ["numberOfSubtasks"]),
    isSubtask: firstBoolean(record, ["isSubtask"]),
    parentTaskName: firstString(record, ["parentTask.name"]),
    checklistDone: firstNumber(record, ["checklistItemsDoneCount"]),
    checklistTotal: firstNumber(record, ["checklistItemsCount"]),
    commentCount: firstNumber(record, ["commentCount"]),
    createdOn: firstString(record, ["createdOn"]),
    updatedOn: firstString(record, ["updatedOn"]),
    description: firstString(record, ["description", "descriptionHtml"]),
  };
}

/**
 * awork's task key ("HAUS-6") lives in `taskIdentifier`. Fall back to building
 * it from the embedded project key + task number if the identifier is absent.
 */
function taskKeyOf(record: UnknownRecord): string | undefined {
  const direct = firstString(record, ["taskIdentifier", "key", "taskKey"]);
  if (direct) {
    return direct;
  }
  const projectKey = firstString(record, ["project.key", "projectKey"]);
  const number = firstNumber(record, ["taskNumber", "number"]);
  if (projectKey && number !== undefined) {
    return `${projectKey}-${number}`;
  }
  return undefined;
}

function extractAssignees(record: UnknownRecord): DetailAssignee[] {
  const list = firstArray(record, ["assignees", "users"]);
  const result: DetailAssignee[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) {
      continue;
    }
    // awork sometimes nests the user under `.user`.
    const user = isRecord(entry.user) ? entry.user : entry;
    const id = firstString(user, ["id", "userId"]);
    if (!id) {
      continue;
    }
    const explicit = firstString(user, ["name", "fullName"]);
    const first = firstString(user, ["firstName"]);
    const last = firstString(user, ["lastName"]);
    const name =
      explicit ?? ([first, last].filter(Boolean).join(" ").trim() || undefined);
    result.push({ id, name });
  }
  return result;
}

/** Collect `.name` (or plain string) values from the first present array field. */
function namesFrom(record: UnknownRecord, paths: string[]): string[] {
  const list = firstArray(record, paths);
  const names: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string" && entry.trim()) {
      names.push(entry.trim());
    } else if (isRecord(entry)) {
      const name = firstString(entry, ["name", "label", "title"]);
      if (name) {
        names.push(name);
      }
    }
  }
  return names;
}

function firstArray(record: UnknownRecord, paths: string[]): unknown[] {
  for (const path of paths) {
    const value = getPath(record, path);
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function firstString(record: UnknownRecord, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(record: UnknownRecord, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function firstBoolean(record: UnknownRecord, paths: string[]): boolean | undefined {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function getPath(record: UnknownRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!isRecord(value)) {
      return undefined;
    }
    return value[key];
  }, record);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
