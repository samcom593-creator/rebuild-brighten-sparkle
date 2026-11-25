export interface DayPlanTask {
  id: string; weekday: number; start_min: number; duration_min: number; title: string;
  detail: string | null; category: string; sort: number; alert: boolean;
}
export interface PendingDayCheck { task_id: string; day: string; done: boolean }
export class MyDayStorageError extends Error {}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const dateKey = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export function isDayPlanTasks(value: unknown): value is DayPlanTask[] {
  return Array.isArray(value) && value.every(row => record(row) && text(row.id) && text(row.title)
    && integer(row.weekday, 1, 7) && integer(row.start_min, 0, 1439) && integer(row.duration_min, 5, 900)
    && (row.detail === null || typeof row.detail === "string") && text(row.category)
    && typeof row.sort === "number" && Number.isFinite(row.sort) && typeof row.alert === "boolean")
    && new Set(value.map(row => row.id)).size === value.length;
}

export function isDayCheckIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
}

export function isDayCheckRows(value: unknown): value is Array<{ task_id: string }> {
  return Array.isArray(value) && value.every(row => record(row) && text(row.task_id));
}

export function isPendingDayChecks(value: unknown): value is PendingDayCheck[] {
  return Array.isArray(value) && value.every(row => record(row) && text(row.task_id) && dateKey(row.day) && typeof row.done === "boolean")
    && new Set(value.map(row => `${row.task_id}:${row.day}`)).size === value.length;
}

/** Missing cache is distinct from denied storage, malformed JSON, or an invalid payload. */
export function readDayCache<T>(key: string, valid: (value: unknown) => value is T): T | null {
  let raw: string | null;
  try { raw = localStorage.getItem(key); }
  catch { throw new MyDayStorageError("Browser storage is unavailable."); }
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new MyDayStorageError("Saved browser data could not be read."); }
  if (!valid(value)) throw new MyDayStorageError("Saved browser data could not be verified.");
  return value;
}

/** A checkmark may enter the durable queue only after the write is confirmed. */
export function writeDayCache(key: string, value: unknown): void {
  try {
    const encoded = JSON.stringify(value);
    localStorage.setItem(key, encoded);
    if (localStorage.getItem(key) !== encoded) throw new Error("Storage write was not retained.");
  } catch {
    throw new MyDayStorageError("Browser storage could not save this change.");
  }
}
