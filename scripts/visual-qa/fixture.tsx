import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ArrowRight, Trophy } from "lucide-react";
import { PageHeader } from "../../src/components/ui/page-header";
import { Button } from "../../src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../src/components/ui/card";
import { WinActionButton } from "../../src/components/celebrations/WinActionButton";
import { DealCelebration } from "../../src/components/celebrations/DealCelebration";
import { HireCelebration } from "../../src/components/celebrations/HireCelebration";
import { TrophyProgressionView } from "../../src/components/awards/TrophyProgression";
import { TROPHY_LEVELS } from "../../src/lib/trophyProgression";
import "../../src/styles/delight.css";
import "../../src/styles/galaxy-workspace.css";
import "./fixture.css";

// Rendering-only fixture: no providers, sign-in, events, database records or send actions.
const params = new URLSearchParams(location.search);
const scene = params.get("scene") ?? "overview";
document.documentElement.className = params.get("theme") === "dark" ? "dark" : "light";

const levels = TROPHY_LEVELS.map((level) => {
  const amount = level.period === "day" ? 3400 : level.period === "week" ? 8700 : 18600;
  return {
    ...level, amount, reached: amount >= level.threshold,
    remaining: Math.max(0, level.threshold - amount), percent: Math.min(100, amount / level.threshold * 100),
    window: level.period === "day" ? "Today · Nov 27" : level.period === "week" ? "Nov 23 – Nov 27" : "Nov 1 – Nov 27",
  };
});
const deal = { key: "synthetic-deal", count: 1, annualPremium: 3600, agentCounts: { "synthetic-agent": 1 } };
const hireRows = [
  { name: "Alexandria Montgomery", licensed: true, code: "TEST1008" },
  { name: "Jordan Lee", licensed: false, code: null },
  { name: "Taylor Morgan", licensed: true, code: "TEST1010" },
  { name: "Cameron Rhodes", licensed: false, code: null },
];
const hires = {
  key: "synthetic-hires",
  hires: hireRows.map((row, index) => ({
    id: `synthetic-hire-${index}`, hiredAt: 0, displayName: row.name, firstName: row.name.split(" ")[0],
    agentCode: row.code, licensed: row.licensed, onboardingStage: null, managerIds: ["synthetic-manager"],
  })),
};

function Fixture() {
  const [visible, setVisible] = useState(true);
  const [lastAction, setLastAction] = useState<string | null>(null);
  return (
    <MemoryRouter>
      <div className="apex-app-shell galaxy-workspace visual-qa-workspace">
        <main className="apex-main-canvas" id="visual-qa-root">
          <div className="apex-content-frame">
            <div className="apex-page-slot galaxy-page">
              <PageHeader
                eyebrow="Synthetic UI verification"
                icon={<Trophy />}
                title="Wins & recognition"
                subtitle="Local rendering only. No account data or external requests."
                primaryAction={<WinActionButton kind="deal" onClick={() => setLastAction("deal")} />}
                secondaryActions={<WinActionButton kind="hire" onClick={() => setLastAction("hire")} />}
              />
              <div className="visual-qa-control-grid">
                <Card>
                  <CardHeader>
                    <CardTitle>Shared actions</CardTitle>
                    <CardDescription>Expanded, collapsed and disabled controls.</CardDescription>
                  </CardHeader>
                  <CardContent className="visual-qa-actions">
                    <WinActionButton kind="hire" onClick={() => setLastAction("hire")} />
                    <WinActionButton kind="deal" onClick={() => setLastAction("deal")} />
                    <div className="visual-qa-icon-actions">
                      <WinActionButton kind="hire" compact />
                      <WinActionButton kind="deal" compact />
                      <Button disabled>Saving…</Button>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>One clear next step</CardTitle>
                    <CardDescription>Primary and secondary controls share the same visual hierarchy.</CardDescription>
                  </CardHeader>
                  <CardContent className="visual-qa-actions">
                    <Button onClick={() => setLastAction("continue")}>Continue <ArrowRight aria-hidden="true" /></Button>
                    <Button variant="outline">Review details</Button>
                    <Button variant="ghost">Save for later</Button>
                  </CardContent>
                </Card>
              </div>
              {lastAction && <p role="status">Synthetic action: {lastAction}</p>}
              <TrophyProgressionView levels={levels} />
            </div>
          </div>
          {scene === "deal" && visible && <DealCelebration batch={deal} agentNames={{ "synthetic-agent": "Alexandria Montgomery" }} onDismiss={() => setVisible(false)} />}
          {scene === "hire" && visible && <HireCelebration batch={hires} managerNames={{ "synthetic-manager": "Jordan Taylor-Montgomery" }} onDismiss={() => setVisible(false)} />}
        </main>
      </div>
      {scene === "overview" && <section className="visual-qa-public" aria-label="Public and applicant control compatibility">
        <Card>
          <CardHeader><CardTitle>Your next step</CardTitle><CardDescription>Shared controls outside the authenticated shell.</CardDescription></CardHeader>
          <CardContent className="visual-qa-public-actions"><Button>Continue application</Button><Button variant="outline">Review application</Button></CardContent>
        </Card>
      </section>}
    </MemoryRouter>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
