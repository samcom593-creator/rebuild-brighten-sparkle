import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingCourse } from "@/hooks/useOnboardingCourse";

const mock = vi.hoisted(() => ({
  progress: { id: "p", agent_id: "canonical", module_id: "m", video_watched_percent: 100, started_at: "2026-11-01T12:00:00Z", completed_at: null, score: null, attempts: 0, answers: null, passed: false } as any,
  writeResult: { data: null as any, error: null as any },
  readError: null as any,
  invoke: vi.fn(async () => ({ data: {}, error: null })),
  writes: [] as any[],
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false, isManager: false, isVaManager: false, isVa: false }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: mock.invoke },
  from: (table: string) => {
    let writing = false;
    const chain: any = {};
    for (const method of ["select", "eq", "order"]) chain[method] = () => chain;
    for (const method of ["update", "upsert"]) chain[method] = (payload: any) => { writing = true; mock.writes.push({ table, method, payload }); return chain; };
    const result = () => writing ? mock.writeResult : { error: table === "onboarding_progress" ? mock.readError : null, data: table === "onboarding_modules" ? [{ id: "m", order_index: 1, title: "Module", is_active: true }] : table === "onboarding_progress" ? [mock.progress] : [] };
    chain.single = () => Promise.resolve(result());
    chain.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  },
} }));

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const hook = renderHook(() => useOnboardingCourse("canonical"), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...hook, invalidate };
}

describe("useOnboardingCourse save confirmation", () => {
  beforeEach(() => { mock.writeResult = { data: null, error: null }; mock.readError = null; mock.invoke.mockClear(); mock.writes.length = 0; });
  it.each(["error", "empty", "wrong-agent", "wrong-attempt"])("does not complete or notify after %s persistence", async kind => {
    mock.writeResult = { data: kind === "empty" || kind === "error" ? null : { ...mock.progress, agent_id: kind === "wrong-agent" ? "other" : "canonical", score: 100, attempts: kind === "wrong-attempt" ? 2 : 1, passed: true }, error: kind === "error" ? new Error("denied") : null };
    const { result, invalidate } = await setup();
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.submitQuiz("m", [0], 100, true); });
    expect(saved).toBe(false);
    expect(result.current.progress.m.passed).toBe(false);
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
  it("publishes the persisted canonical result to the path only after confirmation", async () => {
    mock.writeResult = { data: { ...mock.progress, score: 100, passed: true, attempts: 1, answers: [0] }, error: null };
    const { result, invalidate } = await setup();
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.submitQuiz("m", [0], 100, true); });
    expect(saved).toBe(true); expect(result.current.progress.m.passed).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["training-path-progress", "canonical"] });
    expect(mock.invoke).toHaveBeenCalledWith("notify-course-complete", { body: { agentId: "canonical" } });
  });
  it("exposes a failed progress read and never initializes or saves over unknown progress", async () => {
    mock.readError = new Error("unavailable");
    const { result } = await setup();
    expect(result.current.loadError).toContain("could not be loaded");
    expect(await result.current.submitQuiz("m", [0], 100, true)).toBe(false);
    expect(mock.writes).toEqual([]); expect(mock.invoke).not.toHaveBeenCalled();
  });
});
