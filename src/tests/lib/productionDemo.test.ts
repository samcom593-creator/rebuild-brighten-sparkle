import { afterEach, describe, expect, it, vi } from "vitest";
import { demoNumberValues, ProductionDemoStore, productionDemoStorageKey, validateDemoNumber, type DemoNumberField } from "@/lib/productionDemo";

const fields: DemoNumberField[] = [
  { key: "alp", label: "Annual premium", value: 2400, kind: "money" },
  { key: "policies", label: "Policies", value: 2, kind: "count" },
  { key: "rate", label: "Goal progress", value: 40, kind: "percent" },
];
const scope = { scopeKey: "personal:2026-11", label: "My production", fields };
function storeFor(owner = "account-a", storage: Storage | null = sessionStorage) {
  const store = new ProductionDemoStore(owner, storage);
  store.register("widget", scope);
  return store;
}
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

describe("local production demo values", () => {
  it("validates an entire save before changing any value or storage", () => {
    const store = storeFor();
    const before = store.getSnapshot();
    const result = store.save([
      { scopeKey: scope.scopeKey, key: "alp", value: "18000" },
      { scopeKey: scope.scopeKey, key: "policies", value: "1.5" },
    ]);
    expect(result).toEqual({ ok: false, error: "Policies: enter a whole number." });
    expect(store.getSnapshot()).toBe(before);
    expect(sessionStorage.getItem(productionDemoStorageKey("account-a"))).toBeNull();
  });

  it("saves multiple visible values in one notification, rounds money, and leaves source objects intact", () => {
    const store = storeFor();
    const observed = vi.fn();
    store.subscribe(observed);
    expect(store.save([
      { scopeKey: scope.scopeKey, key: "alp", value: "18250.129" },
      { scopeKey: scope.scopeKey, key: "policies", value: "17" },
    ])).toEqual({ ok: true });
    expect(observed).toHaveBeenCalledTimes(1);
    expect(demoNumberValues(scope.scopeKey, fields, store.getSnapshot().overrides)).toEqual({ values: { alp: 18250.13, policies: 17, rate: 40 }, isDemo: true });
    expect(fields.map((field) => field.value)).toEqual([2400, 2, 40]);
  });

  it.each(["", "  ", "NaN", "Infinity", "-1", {}, null, true])("rejects invalid numeric input %j", (input) => {
    expect(validateDemoNumber(fields[0], input).ok).toBe(false);
  });

  it("honors explicit bounds and integer counts", () => {
    expect(validateDemoNumber(fields[2], "101").ok).toBe(false);
    expect(validateDemoNumber({ ...fields[0], min: 1, max: 25000 }, 0).ok).toBe(false);
    expect(validateDemoNumber({ ...fields[0], max: 25000 }, 25001).ok).toBe(false);
    expect(validateDemoNumber(fields[1], 4.2).ok).toBe(false);
    expect(validateDemoNumber(fields[1], Number.MAX_SAFE_INTEGER + 1).ok).toBe(false);
    expect(validateDemoNumber(fields[1], 0)).toEqual({ ok: true, value: 0 });
  });

  it("does not pin untouched fields when their source data refreshes", () => {
    const store = storeFor();
    store.save([{ scopeKey: scope.scopeKey, key: "alp", value: 18000 }]);
    const refreshed = fields.map((field) => field.key === "policies" ? { ...field, value: 7 } : field);
    store.register("widget", { ...scope, fields: refreshed });
    expect(demoNumberValues(scope.scopeKey, refreshed, store.getSnapshot().overrides).values).toEqual({ alp: 18000, policies: 7, rate: 40 });
    expect(store.getSnapshot().overrides[scope.scopeKey]).toEqual({ alp: 18000 });
  });

  it("scopes persistence to the real account and exact period", () => {
    const first = storeFor();
    first.save([{ scopeKey: scope.scopeKey, key: "alp", value: 18000 }]);
    const sameAccount = storeFor();
    const otherAccount = storeFor("account-b");
    expect(demoNumberValues(scope.scopeKey, fields, sameAccount.getSnapshot().overrides).values.alp).toBe(18000);
    expect(demoNumberValues(scope.scopeKey, fields, otherAccount.getSnapshot().overrides).values.alp).toBe(2400);
    expect(demoNumberValues("personal:2026-12", fields, first.getSnapshot().overrides).isDemo).toBe(false);
    const persisted = JSON.parse(sessionStorage.getItem(productionDemoStorageKey("account-a"))!);
    expect(persisted).toEqual({ version: 1, ownerId: "account-a", overrides: { [scope.scopeKey]: { alp: 18000 } } });
  });

  it("rejects a mismatched persisted owner and ignores invalid persisted values", () => {
    sessionStorage.setItem(productionDemoStorageKey("account-a"), JSON.stringify({ version: 1, ownerId: "account-b", overrides: { [scope.scopeKey]: { alp: 18000 } } }));
    expect(storeFor().getSnapshot().hasOverrides).toBe(false);
    sessionStorage.setItem(productionDemoStorageKey("account-a"), JSON.stringify({ version: 1, ownerId: "account-a", overrides: { [scope.scopeKey]: { policies: 2.5, rate: 500, alp: -2 } } }));
    expect(demoNumberValues(scope.scopeKey, fields, storeFor().getSnapshot().overrides)).toEqual({ values: { alp: 2400, policies: 2, rate: 40 }, isDemo: false });
  });

  it("does not offer unknown/nonfinite or duplicate fields as editable numbers", () => {
    const store = new ProductionDemoStore("account-a", null);
    store.register("widget", { ...scope, fields: [...fields, { ...fields[0], value: NaN }, { key: "missing", label: "Missing", value: NaN, kind: "money" }] });
    expect(store.getSnapshot().scopes[0].fields.map((field) => field.key)).toEqual(["policies", "rate"]);
    expect(store.save([{ scopeKey: scope.scopeKey, key: "missing", value: 10 }]).ok).toBe(false);
  });

  it("shares identical registrations and refuses conflicting or unmounted fields", () => {
    const store = storeFor();
    store.register("second-widget", scope);
    expect(store.getSnapshot().scopes[0].fields).toHaveLength(3);
    store.register("second-widget", { ...scope, fields: [{ ...fields[0], value: 9999 }] });
    expect(store.save([{ scopeKey: scope.scopeKey, key: "alp", value: 18000 }]).ok).toBe(false);
    store.unregister("second-widget");
    expect(store.save([{ scopeKey: scope.scopeKey, key: "alp", value: 18000 }]).ok).toBe(true);
    store.unregister("widget");
    expect(store.getSnapshot().scopes).toEqual([]);
    expect(store.save([{ scopeKey: scope.scopeKey, key: "alp", value: 19000 }]).ok).toBe(false);
  });

  it("resets to the latest source values and removes persisted overrides", () => {
    const store = storeFor();
    store.save([{ scopeKey: scope.scopeKey, key: "alp", value: 18000 }]);
    const current = fields.map((field) => field.key === "alp" ? { ...field, value: 3600 } : field);
    store.register("widget", { ...scope, fields: current });
    store.resetAll();
    expect(demoNumberValues(scope.scopeKey, current, store.getSnapshot().overrides)).toEqual({ values: { alp: 3600, policies: 2, rate: 40 }, isDemo: false });
    expect(sessionStorage.getItem(productionDemoStorageKey("account-a"))).toBeNull();
  });

  it("keeps local operation usable when session storage cannot be read or written", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    const store = storeFor();
    expect(store.save([{ scopeKey: scope.scopeKey, key: "alp", value: 18000 }]).ok).toBe(true);
    expect(demoNumberValues(scope.scopeKey, fields, store.getSnapshot().overrides).values.alp).toBe(18000);
    store.resetAll();
    expect(store.getSnapshot().hasOverrides).toBe(false);
  });

  it("survives StrictMode rehearsal but clears on a completed account lifetime", async () => {
    const store = storeFor();
    store.save([{ scopeKey: scope.scopeKey, key: "alp", value: 18000 }]);
    const first = store.retain();
    first();
    const second = store.retain();
    await Promise.resolve();
    expect(store.getSnapshot().hasOverrides).toBe(true);
    second();
    await Promise.resolve();
    expect(store.getSnapshot().hasOverrides).toBe(false);
    expect(sessionStorage.getItem(productionDemoStorageKey("account-a"))).toBeNull();
  });
});
