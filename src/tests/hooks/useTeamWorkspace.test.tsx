import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rosterRow } from "../helpers/teamRosterFixtures";

const auth = { isAdmin: true, isManager: false, isVaManager: false, isVa: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

import { useTeamWorkspace } from "@/hooks/useTeamWorkspace";

let search = "";
const Probe = () => { search = useLocation().search; return null; };
const render = (entry: string, rows = [rosterRow()], ready = true) =>
  renderHook(() => useTeamWorkspace(rows, ready), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[entry]}><Probe />{children}</MemoryRouter>,
  });

beforeEach(() => {
  Object.assign(auth, { isAdmin: true, isManager: false, isVaManager: false, isVa: false });
  search = "";
});

describe("team workspace: the open person lives in the URL", () => {
  it("opens the person named in the URL", () => {
    const { result } = render("/team?person=a1");
    expect(result.current.selectedId).toBe("a1");
    expect(result.current.row?.agent_id).toBe("a1");
  });

  it("opening and closing change only the person parameter, so the page's other state is untouched", () => {
    const { result } = render("/team?tab=x&q=ann");
    act(() => result.current.openPerson("a1"));
    expect(new URLSearchParams(search).get("person")).toBe("a1");
    expect(new URLSearchParams(search).get("tab")).toBe("x");
    act(() => result.current.closePerson());
    expect(new URLSearchParams(search).has("person")).toBe(false);
    expect(new URLSearchParams(search).get("q")).toBe("ann");
  });

  it("drops a stale or mistyped person id once the roster has settled, rather than leaving an empty drawer", () => {
    render("/team?person=nobody&keep=1");
    expect(new URLSearchParams(search).has("person")).toBe(false);
    expect(new URLSearchParams(search).get("keep")).toBe("1");
  });

  it("does not drop the person while the roster is still loading", () => {
    render("/team?person=a1", [], false);
    expect(new URLSearchParams(search).get("person")).toBe("a1");
  });
});

describe("team workspace: who sees contracting", () => {
  it("admins, managers, VA managers and VAs do; nobody else", () => {
    expect(render("/team").result.current.contractingEnabled).toBe(true);
    Object.assign(auth, { isAdmin: false, isManager: true });
    expect(render("/team").result.current.contractingEnabled).toBe(true);
    Object.assign(auth, { isManager: false, isVaManager: true });
    expect(render("/team").result.current.contractingEnabled).toBe(true);
    Object.assign(auth, { isVaManager: false, isVa: true });
    expect(render("/team").result.current.contractingEnabled).toBe(true);
    Object.assign(auth, { isVa: false });
    expect(render("/team").result.current.contractingEnabled).toBe(false);
  });
});
