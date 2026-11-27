import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CourseCatalog from "@/pages/CourseCatalog";

const mock = vi.hoisted(() => ({
  resolve: vi.fn(), invoke: vi.fn(async () => ({ data: null, error: null })),
  useCourse: vi.fn(), filters: [] as any[], markerWrites: 0, markerError: null as Error | null,
}));
vi.mock("@/lib/trainingIdentity", () => ({ resolveTrainingIdentity: mock.resolve }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "merged-login", email: "learner@example.test" }, isAdmin: false, isManager: false, isVaManager: false, isVa: false }) }));
vi.mock("@/hooks/useSoundEffects", () => ({ useSoundEffects: () => ({ playSound: vi.fn() }) }));
vi.mock("@/hooks/useOnboardingCourse", () => ({ MAX_QUIZ_ATTEMPTS: 4, useOnboardingCourse: (id: string | null) => {
  mock.useCourse(id);
  return { modules: [], questions: {}, progress: {}, currentModuleIndex: 0, setCurrentModuleIndex: vi.fn(), loading: false, loadError: null, currentModule: null, getOverallProgress: () => 0, isCourseComplete: () => false };
} }));
vi.mock("@/components/training/TrainingWorkspaceNav", () => ({ TrainingWorkspaceNav: () => <nav>Training</nav> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: mock.invoke },
  from: (table: string) => {
    let writing = false;
    const chain: any = {};
    for (const method of ["select", "order", "limit", "ilike"]) chain[method] = () => chain;
    chain.update = () => { writing = true; return chain; };
    chain.eq = (key: string, value: unknown) => { mock.filters.push([table, key, value]); return chain; };
    chain.then = (resolve: any, reject: any) => {
      if (writing) mock.markerWrites++;
      return Promise.resolve({ data: [{ license_status: "licensed" }], error: writing ? mock.markerError : null }).then(resolve, reject);
    };
    return chain;
  },
} }));

describe("CourseCatalog identity", () => {
  beforeEach(() => { mock.resolve.mockReset(); mock.invoke.mockClear(); mock.useCourse.mockClear(); mock.filters.length = 0; mock.markerWrites = 0; mock.markerError = null; });
  it("loads progress and licensing by canonical identity for a merged login", async () => {
    mock.resolve.mockResolvedValue({ status: "resolved", agentId: "canonical-agent" });
    render(<MemoryRouter><CourseCatalog /></MemoryRouter>);
    await screen.findByText("Course lessons are unavailable");
    expect(mock.useCourse).toHaveBeenLastCalledWith("canonical-agent");
    expect(mock.filters).toContainEqual(["agents", "id", "canonical-agent"]);
    expect(mock.filters.some(([, key]) => key === "user_id")).toBe(false);
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(mock.markerWrites).toBe(1);
  });
  it("continues loading verified training when the enrollment marker cannot be saved", async () => {
    mock.resolve.mockResolvedValue({ status: "resolved", agentId: "canonical-agent" });
    mock.markerError = new Error("Marker write unavailable");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MemoryRouter><CourseCatalog /></MemoryRouter>);
    await screen.findByText("Course lessons are unavailable");
    expect(mock.useCourse).toHaveBeenLastCalledWith("canonical-agent");
    expect(mock.markerWrites).toBe(1);
    expect(log).toHaveBeenCalledWith("Training enrollment marker could not be saved:", mock.markerError);
    log.mockRestore();
  });
  it.each(["error", "ambiguous", "history_review"])("shows %s identity without provisioning or showing empty progress", async status => {
    mock.resolve.mockResolvedValue({ status, message: "Training history needs review before continuing." });
    render(<MemoryRouter><CourseCatalog /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("Course lessons are unavailable")).not.toBeInTheDocument();
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(mock.filters).toEqual([]);
  });
});
