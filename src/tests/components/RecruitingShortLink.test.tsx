import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { RecruitingShortLink } from "@/components/RecruitingShortLink";

function ApplyEcho() {
  const location = useLocation();
  return <div data-testid="apply">{`${location.pathname}${location.search}${location.hash}`}</div>;
}

function tap(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/r/:code" element={<RecruitingShortLink />} />
        <Route path="/apply" element={<ApplyEcho />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RecruitingShortLink (/r/:code -> /apply?ref=:code)", () => {
  it("forwards the code as the recruiter and carries campaign keys and the hash, dropping a stale ref", () => {
    tap("/r/Jontay-Taylor-957597?utm_source=ig&ref=stale&utm_medium=bio#form");
    expect(screen.getByTestId("apply").textContent).toBe(
      "/apply?ref=Jontay-Taylor-957597&utm_source=ig&utm_medium=bio#form",
    );
  });

  it("keeps a bare tap bare", () => {
    tap("/r/sjames01");
    expect(screen.getByTestId("apply").textContent).toBe("/apply?ref=sjames01");
  });

  it("lands on plain /apply with what the visitor brought when the code is blank", () => {
    tap("/r/%20?utm_source=ig");
    expect(screen.getByTestId("apply").textContent).toBe("/apply?utm_source=ig");
  });
});
