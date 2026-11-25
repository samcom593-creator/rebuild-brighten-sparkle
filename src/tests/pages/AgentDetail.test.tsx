import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import AgentDetail from "@/pages/AgentDetail";
function Location() { const location = useLocation(); return <div data-testid="location">{location.pathname}{location.search}{location.hash}</div>; }
describe("canonical producer profile redirect", () => {
  it("retains the selected producer, unrelated query parameters and anchor", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/agent/producer-a?tab=policies&agentId=wrong#outcomes"]}><Routes>
      <Route path="/dashboard/agent/:id" element={<AgentDetail />} />
      <Route path="/dashboard/profile" element={<Location />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByTestId("location")).toHaveTextContent("/dashboard/profile?tab=policies&agentId=producer-a#outcomes");
  });
});
