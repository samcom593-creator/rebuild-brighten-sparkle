import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { person, rosterRow } from "../helpers/teamContractingFixtures";
import type { TeamPerson } from "@/lib/teamContracting";

const auth = { isAdmin: true, isManager: false, isVaManager: false, isVa: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/shared/realtime/useRealtimeTable", () => ({ useRealtimeTable: vi.fn() }));
const state = vi.hoisted(() => ({ isLoading: false, isError: false, people: [] as unknown[] }));
vi.mock("@/lib/teamContracting", async (orig) => {
  const real = await orig<typeof import("@/lib/teamContracting")>();
  return {
    ...real,
    useTeamContracting: () => ({
      isLoading: state.isLoading, isError: state.isError, data: state.isError ? undefined : { people: state.people }, queryKey: ["tc"], refetch: vi.fn(),
      byAgent: real.indexPeople(state.people as TeamPerson[]),
    }),
    useCheckoffToggle: () => ({ toggle: vi.fn(), isPending: () => false }),
  };
});

import { useTeamWorkspace } from "@/hooks/useTeamWorkspace";

let search = "";
const Probe = () => { search = useLocation().search; return null; };
const render = (entry: string, rows = [rosterRow()], ready = true) =>
  renderHook(() => useTeamWorkspace(rows, ready), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[entry]}><Probe />{children}</MemoryRouter></QueryClientProvider>
    ),
  });

beforeEach(() => {
  Object.assign(auth, { isAdmin: true, isManager: false, isVaManager: false, isVa: false });
  Object.assign(state, { isLoading: false, isError: false, people: [person({ agent_id: "a1", alias_ids: ["twin1"] })] });
  search = "";
});

describe("team workspace: the open person lives in the URL", () => {
  it("opens the person named in the URL, resolving a duplicate twin's id to the same person", () => {
    const { result } = render("/team?person=twin1", [rosterRow({ agent_id: "twin1", full_name: "Ann Lee (twin)" })]);
    expect(result.current.selectedId).toBe("twin1");
    expect(result.current.person?.agent_id).toBe("a1");
    expect(result.current.row?.agent_id).toBe("twin1");
  });

  it("opening and closing change only the person parameter, so the page's other state is untouched", () => {
    const { result } = render("/team?tab=x&q=ann");
    act(() => result.current.openPerson("a1", "followup"));
    expect(new URLSearchParams(search).get("person")).toBe("a1");
    expect(new URLSearchParams(search).get("tab")).toBe("x");
    expect(result.current.scrollTo).toBe("followup");
    act(() => result.current.closePerson());
    expect(new URLSearchParams(search).has("person")).toBe(false);
    expect(new URLSearchParams(search).get("q")).toBe("ann");
    expect(result.current.scrollTo).toBeNull();
  });

  it("drops a stale or mistyped person id once both reads have settled, rather than leaving an empty drawer", () => {
    render("/team?person=nobody&keep=1");
    expect(new URLSearchParams(search).has("person")).toBe(false);
    expect(new URLSearchParams(search).get("keep")).toBe("1");
  });

  it("does not drop the person while the roster is still loading", () => {
    render("/team?person=a1", [], false);
    expect(new URLSearchParams(search).get("person")).toBe("a1");
  });
});

describe("team workspace: contracting read state and roles", () => {
  it("reports loading, error and ok as separate states", () => {
    state.isLoading = true;
    expect(render("/team").result.current.read).toBe("loading");
    Object.assign(state, { isLoading: false, isError: true });
    expect(render("/team").result.current.read).toBe("error");
    Object.assign(state, { isError: false });
    expect(render("/team").result.current.read).toBe("ok");
  });

  it("only admins and managers may tick; staff roles can read but not change", () => {
    expect(render("/team").result.current.canTick).toBe(true);
    Object.assign(auth, { isAdmin: false, isVaManager: true });
    const r = render("/team").result.current;
    expect(r.canTick).toBe(false);
    expect(r.contractingEnabled).toBe(true);
  });

  it("a role with no contracting access has contracting switched off entirely", () => {
    Object.assign(auth, { isAdmin: false });
    const r = render("/team").result.current;
    expect(r.contractingEnabled).toBe(false);
    expect(r.canTick).toBe(false);
  });

  it("finds a person's phone through the canonical id or a twin's id", () => {
    const { result } = render("/team", [rosterRow({ agent_id: "twin1", phone: "+15555550177" })]);
    expect(result.current.contactFor("a1").phone).toBe("+15555550177");
    expect(result.current.contactFor("missing").phone).toBeNull();
  });
});
