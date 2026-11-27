import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTrainingIdentity } from "@/lib/trainingIdentity";

const mock = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/agentIdentity", () => ({ resolveAgentIdentity: mock.resolve }));
const canonical = { status: "resolved", agentId: "root", mergedFromAgentId: "alias" };
const access = { user_id: "login", agent_id: "root", alias_progress_count: 0 };
const rpc = vi.fn();
const client = { rpc, from: vi.fn() } as any;

describe("canonical training access", () => {
  beforeEach(() => { mock.resolve.mockResolvedValue(canonical); rpc.mockReset(); rpc.mockResolvedValue({ data: access, error: null }); });
  it("opens canonical progress for a verified merged login with no stranded history", async () => {
    expect(await resolveTrainingIdentity(client, "login")).toEqual(canonical);
    expect(rpc).toHaveBeenCalledWith("training_progress_access");
  });
  it("preserves a known alias history as a review state, without inventing completion", async () => {
    rpc.mockResolvedValue({ data: { ...access, alias_progress_count: 2 }, error: null });
    expect(await resolveTrainingIdentity(client, "login")).toMatchObject({ status: "history_review", agentId: "root", count: 2 });
  });
  it.each(["none", "ambiguous", "error"])("preserves %s without authorizing or calling access on an unresolved identity", async status => {
    const identity = { status, message: "Cannot verify identity" };
    mock.resolve.mockResolvedValue(identity);
    expect(await resolveTrainingIdentity(client, "login")).toEqual(identity);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { data: null, error: new Error("schema unavailable") },
    { data: { ...access, user_id: "other" }, error: null },
    { data: { ...access, agent_id: "other" }, error: null },
    { data: { ...access, alias_progress_count: null }, error: null },
    { data: { ...access, alias_progress_count: -1 }, error: null },
    { data: { ...access, alias_progress_count: 1.2 }, error: null },
  ])("fails closed when canonical access evidence is invalid: %j", async reply => {
    rpc.mockResolvedValue(reply);
    expect(await resolveTrainingIdentity(client, "login")).toMatchObject({ status: "error" });
  });
  it("reports a thrown history read as an error rather than no history", async () => {
    rpc.mockRejectedValue(new Error("network unavailable"));
    expect(await resolveTrainingIdentity(client, "login")).toMatchObject({ status: "error" });
  });
});
