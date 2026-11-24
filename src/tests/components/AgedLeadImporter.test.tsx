import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { AgedLeadImporter } from "@/components/dashboard/AgedLeadImporter";

const notice = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: notice }));
beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset(); vi.mocked(supabase.from).mockClear(); vi.mocked(supabase.functions.invoke).mockClear(); notice.error.mockClear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
describe("aged lead suppression verification", () => {
  it.each([
    { data: null, error: { message: "Suppression service unavailable" } },
    { data: null, error: null },
  ])("does not insert or email leads when the ban result is unverified", async result => {
    vi.mocked(supabase.rpc).mockResolvedValue(result as never);
    const complete = vi.fn();
    render(<AgedLeadImporter isOpen onClose={vi.fn()} managers={[{ id: "manager-a", name: "Manager Example" }]} onImportComplete={complete} />);
    fireEvent.keyDown(screen.getAllByRole("combobox")[0], { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Manager Example" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "first_name,last_name,email,phone\nTaylor,Example,taylor@example.test,6152345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview Import (1 rows)" }));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 Leads" }));
    await waitFor(() => expect(notice.error).toHaveBeenCalled());
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});
