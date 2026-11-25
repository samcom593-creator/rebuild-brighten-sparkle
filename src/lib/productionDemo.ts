/** Local presentation values only. This module never reads or writes production data. */
export interface DemoNumberField {
  key: string;
  label: string;
  value: number;
  kind: "money" | "count" | "percent";
  min?: number;
  max?: number;
}

export interface DemoNumberScope {
  scopeKey: string;
  label: string;
  fields: readonly DemoNumberField[];
}

export interface DemoNumberEdit {
  scopeKey: string;
  key: string;
  value: unknown;
}

type Overrides = Readonly<Record<string, Readonly<Record<string, number>>>>;
export interface ProductionDemoSnapshot {
  scopes: readonly DemoNumberScope[];
  overrides: Overrides;
  hasOverrides: boolean;
}

type DemoStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DemoValidation = { ok: true; value: number } | { ok: false; error: string };
export type DemoSaveResult = { ok: true } | { ok: false; error: string };

const PREFIX = "galaxy:production-demo:v1:";
const RESERVED_KEYS = new Set(["prototype", ...Object.getOwnPropertyNames(Object.prototype)]);
const MAX_STORED_LENGTH = 250_000;
export const EMPTY_PRODUCTION_DEMO: ProductionDemoSnapshot = Object.freeze({
  scopes: Object.freeze([]), overrides: Object.freeze({}), hasOverrides: false,
});

function usableKey(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !RESERVED_KEYS.has(value);
}

export function productionDemoStorageKey(ownerId: string): string {
  return `${PREFIX}${encodeURIComponent(ownerId)}`;
}

function browserStorage(): DemoStorage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; }
  catch { return null; } // empty-catch-allow:session-storage-unavailable
}

export function validateDemoNumber(field: DemoNumberField, input: unknown): DemoValidation {
  if ((typeof input !== "string" && typeof input !== "number") || (typeof input === "string" && !input.trim())) {
    return { ok: false, error: `${field.label}: enter a number.` };
  }
  const parsed = Number(input);
  const minimum = Math.max(0, field.min ?? 0);
  const maximum = field.max ?? (field.kind === "percent" ? 100 : Number.MAX_SAFE_INTEGER);
  if (!Number.isFinite(parsed) || !Number.isFinite(minimum) || !Number.isFinite(maximum) || parsed < minimum || parsed > maximum) {
    return { ok: false, error: `${field.label}: enter a finite number from ${minimum} to ${maximum}.` };
  }
  if (field.kind === "count" && !Number.isSafeInteger(parsed)) {
    return { ok: false, error: `${field.label}: enter a whole number.` };
  }
  const value = field.kind === "money" ? Math.round((parsed + Number.EPSILON) * 100) / 100 : parsed;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    return { ok: false, error: `${field.label}: the rounded amount is outside its allowed range.` };
  }
  return { ok: true, value };
}

/** Invalid, unknown or conflicting source figures are never offered as editable facts. */
export function normalizeDemoFields(fields: readonly DemoNumberField[]): readonly DemoNumberField[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const valid: DemoNumberField[] = [];
  for (const field of fields) {
    if (!usableKey(field.key) || !field.label?.trim() || !["money", "count", "percent"].includes(field.kind)) continue;
    if (seen.has(field.key)) { duplicates.add(field.key); continue; }
    seen.add(field.key);
    if (!validateDemoNumber(field, field.value).ok) continue;
    valid.push(Object.freeze({ ...field }));
  }
  return Object.freeze(valid.filter((field) => !duplicates.has(field.key)));
}

function freezeOverrides(values: Record<string, Record<string, number>>): Overrides {
  return Object.freeze(Object.fromEntries(Object.entries(values).map(([scope, fields]) => [scope, Object.freeze({ ...fields })])));
}

function readOverrides(storage: DemoStorage | null, ownerId: string): Overrides {
  try {
    const raw = storage?.getItem(productionDemoStorageKey(ownerId));
    if (!raw || raw.length > MAX_STORED_LENGTH) return Object.freeze({});
    const payload: unknown = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return Object.freeze({});
    const record = payload as Record<string, unknown>;
    if (record.version !== 1 || record.ownerId !== ownerId || !record.overrides || typeof record.overrides !== "object" || Array.isArray(record.overrides)) return Object.freeze({});
    const result: Record<string, Record<string, number>> = {};
    for (const [scopeKey, fields] of Object.entries(record.overrides)) {
      if (!usableKey(scopeKey) || !fields || typeof fields !== "object" || Array.isArray(fields)) continue;
      const numbers: Record<string, number> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (usableKey(key) && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) numbers[key] = value;
      }
      if (Object.keys(numbers).length) result[scopeKey] = numbers;
    }
    return freezeOverrides(result);
  } catch { return Object.freeze({}); } // empty-catch-allow:malformed-or-unavailable-session-storage
}

/** One instance per real signed-in account; registrations contain only mounted visible fields. */
export class ProductionDemoStore {
  private registrations = new Map<string, DemoNumberScope>();
  private listeners = new Set<() => void>();
  private overrides: Overrides;
  private snapshot: ProductionDemoSnapshot;
  private mounts = 0;
  private lifetime = 0;
  private storage: DemoStorage | null;

  constructor(readonly ownerId: string, storage: DemoStorage | null = browserStorage()) {
    this.storage = storage;
    this.overrides = readOverrides(storage, ownerId);
    this.snapshot = Object.freeze({ scopes: Object.freeze([]), overrides: this.overrides, hasOverrides: Object.keys(this.overrides).length > 0 });
  }

  getSnapshot = (): ProductionDemoSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Survives StrictMode's effect rehearsal, but logout/unmount clears the account's active demo. */
  retain = (): (() => void) => {
    this.mounts += 1;
    this.lifetime += 1;
    let retained = true;
    return () => {
      if (!retained) return;
      retained = false;
      this.mounts -= 1;
      const ended = ++this.lifetime;
      queueMicrotask(() => {
        if (this.mounts === 0 && this.lifetime === ended) this.resetAll();
      });
    };
  };

  register = (token: string, scope: DemoNumberScope): void => {
    if (!usableKey(scope.scopeKey)) return;
    const next = { scopeKey: scope.scopeKey, label: scope.label, fields: normalizeDemoFields(scope.fields) };
    if (JSON.stringify(this.registrations.get(token)) === JSON.stringify(next)) return;
    this.registrations.set(token, next);
    this.emit();
  };

  unregister = (token: string): void => {
    if (this.registrations.delete(token)) this.emit();
  };

  save = (edits: readonly DemoNumberEdit[]): DemoSaveResult => {
    const validated: Array<{ scopeKey: string; key: string; value: number; source: number }> = [];
    const seen = new Set<string>();
    for (const edit of edits) {
      const field = this.snapshot.scopes.find((scope) => scope.scopeKey === edit.scopeKey)?.fields.find((candidate) => candidate.key === edit.key);
      if (!field) return { ok: false, error: "A selected figure is no longer available on this page. Reopen the editor to review the current figures." };
      const id = JSON.stringify([edit.scopeKey, edit.key]);
      if (seen.has(id)) return { ok: false, error: "A figure was submitted more than once. Reopen the editor." };
      seen.add(id);
      const result = validateDemoNumber(field, edit.value);
      if (result.ok === false) return result;
      validated.push({ scopeKey: edit.scopeKey, key: edit.key, value: result.value, source: field.value });
    }
    const next: Record<string, Record<string, number>> = Object.fromEntries(Object.entries(this.overrides).map(([scope, fields]) => [scope, { ...fields }]));
    for (const edit of validated) {
      const fields = next[edit.scopeKey] ?? {};
      if (edit.value === edit.source) delete fields[edit.key];
      else fields[edit.key] = edit.value;
      if (Object.keys(fields).length) next[edit.scopeKey] = fields;
      else delete next[edit.scopeKey];
    }
    this.overrides = freezeOverrides(next);
    this.persist();
    this.emit();
    return { ok: true };
  };

  resetScope = (scopeKey: string): void => {
    const next = { ...this.overrides };
    delete next[scopeKey];
    this.overrides = freezeOverrides(next);
    this.persist();
    this.emit();
  };

  resetAll = (): void => {
    this.overrides = Object.freeze({});
    this.persist();
    this.emit();
  };

  private persist(): void {
    try {
      if (!Object.keys(this.overrides).length) this.storage?.removeItem(productionDemoStorageKey(this.ownerId));
      else this.storage?.setItem(productionDemoStorageKey(this.ownerId), JSON.stringify({ version: 1, ownerId: this.ownerId, overrides: this.overrides }));
    } catch { /* empty-catch-allow:session-storage-unavailable; current-page values remain usable */ }
  }

  private emit(): void {
    const grouped = new Map<string, { label: string; fields: Map<string, DemoNumberField>; conflicts: Set<string> }>();
    for (const scope of this.registrations.values()) {
      const group = grouped.get(scope.scopeKey) ?? { label: scope.label, fields: new Map(), conflicts: new Set<string>() };
      for (const field of scope.fields) {
        const existing = group.fields.get(field.key);
        if (existing && JSON.stringify(existing) !== JSON.stringify(field)) group.conflicts.add(field.key);
        else group.fields.set(field.key, field);
      }
      grouped.set(scope.scopeKey, group);
    }
    const scopes = [...grouped.entries()].map(([scopeKey, group]) => Object.freeze({
      scopeKey, label: group.label,
      fields: Object.freeze([...group.fields.values()].filter((field) => !group.conflicts.has(field.key))),
    })).filter((scope) => scope.fields.length > 0);
    this.snapshot = Object.freeze({ scopes: Object.freeze(scopes), overrides: this.overrides, hasOverrides: Object.keys(this.overrides).length > 0 });
    this.listeners.forEach((listener) => listener());
  }
}

/** Applies only valid registered-number overrides; source objects and unknown values stay untouched. */
export function demoNumberValues(scopeKey: string, fields: readonly DemoNumberField[], overrides: Overrides): { values: Record<string, number>; isDemo: boolean } {
  const values = Object.fromEntries(fields.filter((field) => usableKey(field.key)).map((field) => [field.key, field.value]));
  let isDemo = false;
  for (const field of normalizeDemoFields(fields)) {
    const proposed = overrides[scopeKey]?.[field.key];
    if (proposed === undefined) continue;
    const result = validateDemoNumber(field, proposed);
    if (result.ok === false) continue;
    values[field.key] = result.value;
    isDemo = true;
  }
  return { values, isDemo };
}
