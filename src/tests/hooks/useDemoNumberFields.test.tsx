import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionDemoContext, useDemoNumberFields, type DemoNumberField } from "@/hooks/useDemoNumberFields";
import { ProductionDemoStore } from "@/lib/productionDemo";

const november = "personal:2026-11-01:2026-12-01";
const december = "personal:2026-12-01:2027-01-01";
const source = Object.freeze({ alp: 2400, policies: 2, progress: 40 });
const fieldsFor = (data: { alp: number; policies: number; progress: number } = source): readonly DemoNumberField[] => Object.freeze([
  Object.freeze({ key: "alp", label: "Annual premium", value: data.alp, kind: "money" as const }),
  Object.freeze({ key: "policies", label: "Policies", value: data.policies, kind: "count" as const }),
  Object.freeze({ key: "progress", label: "Goal progress", value: data.progress, kind: "percent" as const }),
]);

interface ProbeProps {
  scopeKey?: string;
  fields?: readonly DemoNumberField[];
  id?: string;
  onRender?: () => void;
}
function Probe({ scopeKey = november, fields = fieldsFor(), id = "view", onRender }: ProbeProps) {
  const values = useDemoNumberFields({ scopeKey, label: "My production", fields });
  onRender?.();
  return <output data-testid={id}>{JSON.stringify(values)}</output>;
}
function Surface({ store, ...props }: ProbeProps & { store: ProductionDemoStore }) {
  return <ProductionDemoContext.Provider value={store}><Probe {...props} /></ProductionDemoContext.Provider>;
}
const result = (id = "view") => JSON.parse(screen.getByTestId(id).textContent!);
afterEach(cleanup);

describe("useDemoNumberFields with the real account store", () => {
  it("registers mounted fields once per scope and removes only the unmounted consumer", () => {
    const store = new ProductionDemoStore("account-a", null);
    const view = render(
      <ProductionDemoContext.Provider value={store}>
        <Probe key="first" id="first" />
        <Probe key="second" id="second" />
      </ProductionDemoContext.Provider>,
    );
    expect(store.getSnapshot().scopes).toEqual([{ scopeKey: november, label: "My production", fields: fieldsFor() }]);
    view.rerender(<ProductionDemoContext.Provider value={store}><Probe key="first" id="first" /></ProductionDemoContext.Provider>);
    expect(store.getSnapshot().scopes[0].fields).toHaveLength(3);
    expect(result("first")).toEqual({ values: { alp: 2400, policies: 2, progress: 40 }, isDemo: false });
    view.unmount();
    expect(store.getSnapshot().scopes).toEqual([]);
    expect(store.save([{ scopeKey: november, key: "alp", value: 5000 }]).ok).toBe(false);
  });

  it("returns all base keys plus only the edited override without mutating query inputs", () => {
    const queryData = Object.freeze({ ...source });
    const queryFields = fieldsFor(queryData);
    const original = JSON.stringify({ queryData, queryFields });
    const store = new ProductionDemoStore("account-a", null);
    render(<Surface store={store} fields={queryFields} />);
    act(() => {
      expect(store.save([{ scopeKey: november, key: "alp", value: 18000 }]).ok).toBe(true);
    });
    expect(result()).toEqual({ values: { alp: 18000, policies: 2, progress: 40 }, isDemo: true });
    expect(store.getSnapshot().overrides).toEqual({ [november]: { alp: 18000 } });
    expect(JSON.stringify({ queryData, queryFields })).toBe(original);
    expect(queryFields[0].value).toBe(queryData.alp);
  });

  it("switches periods without displaying the previous period's override", () => {
    const store = new ProductionDemoStore("account-a", null);
    const view = render(<Surface store={store} />);
    act(() => { store.save([{ scopeKey: november, key: "alp", value: 18000 }]); });
    const decemberSource = Object.freeze({ alp: 3600, policies: 3, progress: 60 });
    view.rerender(<Surface store={store} scopeKey={december} fields={fieldsFor(decemberSource)} />);
    expect(result()).toEqual({ values: { alp: 3600, policies: 3, progress: 60 }, isDemo: false });
    expect(store.getSnapshot().scopes.map((scope) => scope.scopeKey)).toEqual([december]);
    expect(store.save([{ scopeKey: november, key: "alp", value: 19000 }]).ok).toBe(false);
    // Returning to the original period restores that period's own saved presentation.
    view.rerender(<Surface store={store} scopeKey={november} />);
    expect(result().values.alp).toBe(18000);
  });

  it("keeps edited fields stable while untouched fields follow refreshed query data", () => {
    const store = new ProductionDemoStore("account-a", null);
    const view = render(<Surface store={store} />);
    act(() => { store.save([{ scopeKey: november, key: "alp", value: 18000 }]); });
    const refreshed = Object.freeze({ alp: 4800, policies: 4, progress: 80 });
    const refreshedFields = fieldsFor(refreshed);
    view.rerender(<Surface store={store} fields={refreshedFields} />);
    expect(result()).toEqual({ values: { alp: 18000, policies: 4, progress: 80 }, isDemo: true });
    expect(refreshed).toEqual({ alp: 4800, policies: 4, progress: 80 });
    expect(refreshedFields.map((field) => field.value)).toEqual([4800, 4, 80]);
    act(() => { store.resetScope(november); });
    expect(result()).toEqual({ values: { alp: 4800, policies: 4, progress: 80 }, isDemo: false });
  });

  it("detaches the previous account store immediately when the context owner changes", () => {
    const first = new ProductionDemoStore("account-a", null);
    const second = new ProductionDemoStore("account-b", null);
    const view = render(<Surface store={first} />);
    act(() => { first.save([{ scopeKey: november, key: "alp", value: 18000 }]); });
    const secondSource = Object.freeze({ alp: 6000, policies: 5, progress: 20 });
    view.rerender(<Surface store={second} fields={fieldsFor(secondSource)} />);
    expect(result()).toEqual({ values: { alp: 6000, policies: 5, progress: 20 }, isDemo: false });
    expect(first.getSnapshot().scopes).toEqual([]);
    expect(second.getSnapshot().scopes[0].fields[0].value).toBe(6000);
    act(() => {
      first.resetAll();
      second.save([{ scopeKey: november, key: "alp", value: 24000 }]);
    });
    expect(result()).toEqual({ values: { alp: 24000, policies: 5, progress: 20 }, isDemo: true });
    expect(secondSource.alp).toBe(6000);
  });

  it("settles after registration and identical newly allocated field arrays do not create a notification loop", () => {
    const store = new ProductionDemoStore("account-a", null);
    const changed = vi.fn();
    const rendered = vi.fn();
    const unsubscribe = store.subscribe(changed);
    const view = render(<Surface store={store} onRender={rendered} fields={fieldsFor()} />);
    expect(changed).toHaveBeenCalledTimes(1);
    const settledRenders = rendered.mock.calls.length;
    for (let index = 0; index < 10; index += 1) view.rerender(<Surface store={store} onRender={rendered} fields={fieldsFor()} />);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(rendered.mock.calls.length).toBe(settledRenders + 10);
    expect(result().values).toEqual({ alp: 2400, policies: 2, progress: 40 });
    unsubscribe();
  });
});
