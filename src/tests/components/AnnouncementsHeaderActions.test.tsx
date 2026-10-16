/**
 * F38 on the Announcements page: the header declares its slots instead of leaving PageHeader to guess. Before, the
 * minified SubmitDealDialog ranked below the outline Refresh button, so production showed Refresh and hid Add Deal
 * behind More on phones. Add Deal is now the declared primary at every width; Refresh and the admin's Post are the
 * secondaries.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { user: { id: "user-1" }, isAdmin: true };

function emptyRead(): Record<string, unknown> {
  const result = { data: [], error: null };
  const node: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "insert"]) node[method] = () => node;
  node.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return node;
}

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => undefined }));
vi.mock("@/lib/looseSupabase", () => ({ looseSupabase: { from: () => emptyRead() } }));
vi.mock("@/components/deals/SubmitDealDialog", () => ({
  SubmitDealDialog: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));

import Announcements from "@/pages/Announcements";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Announcements />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.isAdmin = true;
});

describe("Announcements header actions (F38)", () => {
  it("keeps Add Deal visible as the declared primary and puts Refresh and Post behind More on phones", () => {
    renderPage();
    const addDeal = screen.getByRole("button", { name: "Add Deal" });
    expect(addDeal.closest(".apex-page-primary-action")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" }).closest(".apex-page-secondary-actions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Post" }).closest(".apex-page-secondary-actions")).toBeTruthy();
    expect(screen.getByRole("button", { name: /More \(2\)/ })).toBeTruthy();
  });

  it("gives a non-admin the same primary with Refresh as the only secondary", () => {
    auth.isAdmin = false;
    renderPage();
    expect(screen.getByRole("button", { name: "Add Deal" }).closest(".apex-page-primary-action")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
    expect(screen.getByRole("button", { name: /More \(1\)/ })).toBeTruthy();
  });
});
