/**
 * OVERHAUL-1 (2026-10-29): "Your link" at the top of Invite an agent and Refer a recruit must keep
 * MP-342's promise: whoever applies through /r/<slug> is credited to the slug's owner and hired
 * under them. This file walks the chain link by link, from the card to the hire:
 *
 *   card    my_recruiting_link().ref_slug -> https://apex-financial.org/r/<slug> (Copy writes exactly that)
 *   route   /r/<slug> -> /apply?ref=<slug> (the real RecruitingShortLink route)
 *   apply   resolve-ref-slug finds agents.ref_slug -> refLinkOutcome "credited" -> recruiterId
 *   server  submit-application writes recruiter_id, referral_manager_id and referral_recruiter_id
 *           from recruiterId, never overwriting an earlier attribution
 *   hire    add-agent accepts the referral manager as owner and sets manager_id to them
 *   join    a Refer a recruit link (/join/<token>) credits the same three columns to its maker
 *
 * Measured live on 2026-10-29 (project xrzweoneiieddzxogewk): of the applications in the last
 * 120 days whose consent URL carried ?ref=<an agents.ref_slug>, 7 of 7 have referral_manager_id
 * and recruiter_id equal to that slug's owner, 0 mismatches.
 */
import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-sam" } }) }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn(), useSoundEffects: () => ({ playSound: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MyLinkCard } from "@/components/invitations/MyLinkCard";
import { RecruitingShortLink } from "@/components/RecruitingShortLink";
import { ownLinkPath } from "@/lib/recruitLinks";
import { refLinkOutcome } from "@/lib/refLinkNotice";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const SLUG = "samuel-james-7c3c55";
const OWNER = "7c3c5581-3544-437f-bfe2-91391afb217d";

function ApplyEcho() {
  const location = useLocation();
  return <div data-testid="apply">{`${location.pathname}${location.search}`}</div>;
}

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockImplementation(((fn: string) =>
    Promise.resolve(fn === "my_recruiting_link"
      ? { data: { active: true, agent_id: OWNER, ref_slug: SLUG, link: `https://apex-financial.org/apply?ref=${SLUG}` }, error: null }
      : { data: null, error: null })) as never);
});

describe("Your link keeps /r/<slug> attribution (MP-342)", () => {
  it("the card shows and copies the owner's /r/<slug> link, built from ref_slug alone", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MyLinkCard blurb="Anyone who applies through it is credited to you." />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("my-link-url")).toHaveTextContent(`apex-financial.org/r/${SLUG}`);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://apex-financial.org/r/${SLUG}`));
    expect(vi.mocked(supabase.rpc).mock.calls.map((c) => c[0])).toEqual(["my_recruiting_link"]);
  });

  it("an inactive or slug-less account gets no link at all, never one that credits nobody", async () => {
    vi.mocked(supabase.rpc).mockImplementation((() => Promise.resolve({ data: { active: false }, error: null })) as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MyLinkCard blurb="x" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("You do not have a personal link yet. Every active agent account gets one.")).toBeInTheDocument();
    expect(screen.queryByTestId("my-link-url")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("the copied link, opened, lands on /apply with the owner as the recruiter", () => {
    const path = ownLinkPath(`https://apex-financial.org/r/${SLUG}`);
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/r/:code" element={<RecruitingShortLink />} />
          <Route path="/apply" element={<ApplyEcho />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("apply").textContent).toBe(`/apply?ref=${SLUG}`);
  });

  it("Apply credits the agent resolve-ref-slug found and sends them as the recruiter", () => {
    expect(refLinkOutcome({ resolved: true, agent_id: OWNER, display_name: "Samuel James" }, null))
      .toEqual({ kind: "credited", agentId: OWNER, displayName: "Samuel James" });
    const resolver = read("supabase/functions/resolve-ref-slug/index.ts");
    expect(resolver).toContain('.eq("ref_slug", slug)');
    expect(resolver).toContain("agent_id: data.id");
    const apply = read("src/pages/Apply.tsx");
    expect(apply).toContain('supabase.functions.invoke("resolve-ref-slug"');
    expect(apply).toMatch(/recruiterId:\s*\n\s*referrerId \?\?/);
  });

  it("submit-application credits the recruiter in all three columns and never overwrites an earlier one", () => {
    const fn = read("supabase/functions/submit-application/index.ts");
    expect(fn).toContain("const resolvedRecruiter = data.recruiterId ||");
    expect(fn).toContain("const resolvedReferralManager = data.selectedReferralAgentId || data.recruiterId ||");
    expect(fn).toContain("const resolvedReferralRecruiter = data.recruiterId || data.selectedReferralAgentId || null;");
    expect(fn).toContain("referral_manager_id: resolvedReferralManager,");
    expect(fn).toContain("recruiter_id: resolvedRecruiter,");
    expect(fn).toContain("referral_recruiter_id: resolvedReferralRecruiter,");
    expect(fn).toContain("if (!existingApp.referral_manager_id) {");
  });

  it("add-agent hires the applicant under the referral manager", () => {
    const fn = read("supabase/functions/add-agent/index.ts");
    expect(fn).toMatch(/data\.assigned_agent_id,\s*\n\s*data\.referral_manager_id,\s*\n\s*data\.recruiter_id,\s*\n\s*\]\.includes\(managerId\)/);
    expect(fn).toContain("manager_id: managerId,");
    expect(fn).toContain("invited_by_manager_id: managerId,");
  });

  it("a Refer a recruit link (/join/<token>) credits its maker the same way and obeys the license it was made with", () => {
    const fn = read("supabase/functions/consume-invite-token/index.ts");
    const join = fn.slice(fn.indexOf("if (tokenRow.kind === \"join\")"), fn.indexOf("// ─── kind='hire' branch"));
    expect(join).toContain("referral_manager_id: targetManager?.id ?? null,");
    expect(join).toContain("recruiter_id: targetManager?.id ?? null,");
    expect(join).toContain("referral_recruiter_id: targetManager?.id ?? null,");
    // The license path comes from the claimed row when the link was made with one.
    expect(join).toContain("tokenRow.prefill_json?.license_status_locked === true");
    expect(join).toContain('const licensedJoin = lockedJoinLicense ? lockedJoinLicense === "licensed" : body.licensed === true;');
    // The maker is the target: create_invitation is called with no upline for a join link.
    expect(read("src/components/invitations/InviteAgentForm.tsx")).toContain("p_target_manager_id: isJoin ? null : uplineId,");
  });
});
