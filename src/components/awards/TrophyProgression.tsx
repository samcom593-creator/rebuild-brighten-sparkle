import { Link } from "react-router-dom";
import { ArrowRight, Check, LockKeyhole, Trophy } from "lucide-react";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { useProducerWorkspace } from "@/hooks/useProducerWorkspace";
import { trophyProgression, type TrophyProgress } from "@/lib/trophyProgression";
import { Button } from "@/components/ui/button";
import "./trophy-progression.css";

const money = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 });

export function TrophyProgressionView({ levels }: { levels: TrophyProgress }) {
  const next = levels.find((level) => !level.reached);
  const reached = levels.filter((level) => level.reached).length;
  return (
    <section className="trophy-path" aria-label="Your trophy progression">
      <header className="trophy-path__heading">
        <div>
          <p className="trophy-path__eyebrow">Every win builds the next</p>
          <h2>Your trophy path.</h2>
          <p className="trophy-path__intro">Five production milestones. One next move.</p>
        </div>
        <div className="trophy-path__score"><strong>{reached}<span> / 5</span></strong><span>current milestones reached</span></div>
      </header>
      <ol className="trophy-path__levels" aria-label="Production trophy levels">
        {levels.map((level) => (
          <li key={level.key} className="trophy-path__level" data-tone={level.tone} data-reached={level.reached} data-next={next?.key === level.key}>
            <span className="trophy-path__state">{level.reached ? <><Check aria-hidden="true" /> Reached</> : next?.key === level.key ? "Next milestone" : <><LockKeyhole aria-hidden="true" /> In progress</>}</span>
            <div className="trophy-path__medallion" aria-hidden="true"><Trophy /><span>{level.reached ? "★" : "◇"}</span></div>
            <h3>{level.title}</h3>
            <p>{level.caption}</p>
            <div role="progressbar" aria-label={`${level.title} progress`} aria-valuemin={0} aria-valuemax={level.threshold}
              aria-valuenow={Math.min(level.amount, level.threshold)} aria-valuetext={`${money(level.amount)} of ${money(level.threshold)} posted annual premium`}
              className="trophy-path__track"><span style={{ width: `${level.percent}%` }} /></div>
            <p className="trophy-path__amount">{level.reached ? "Milestone complete" : `${money(level.remaining)} to go`}</p>
            <span className="trophy-path__dates">{level.window}</span>
          </li>
        ))}
      </ol>
      <footer className="trophy-path__next">
        <div><strong>{next ? `${money(next.remaining)} to ${next.title}.` : "Every current milestone is complete."}</strong>
          <p>{next ? "Work your next lead. Follow through. Build the next win." : "Keep the momentum. Help your next client and protect the book."}</p></div>
        <Button asChild><Link to="/dashboard/my-leads">Work my leads <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link></Button>
      </footer>
      <p className="trophy-path__source">Personal posted annual premium · Phoenix business dates. Daily, weekly and monthly progress resets with each period; your recorded awards stay in the wall below.</p>
    </section>
  );
}

export function TrophyProgression() {
  const identity = useAgentIdentity();
  const today = useBusinessToday();
  const workspace = useProducerWorkspace(identity.agentId);
  if (identity.identity?.status === "none") return null;
  if (identity.isLoading || (identity.agentId && workspace.isPending)) {
    return <section className="trophy-path" role="status" aria-label="Loading trophy progress"><p>Loading your trophy path…</p></section>;
  }
  let levels: TrophyProgress | null = null;
  if (identity.agentId && workspace.data?.agent_id === identity.agentId && workspace.data.today === today && !workspace.isError) {
    try { levels = trophyProgression(workspace.data.days, today); } catch { levels = null; }
  }
  if (!levels) return (
    <section className="trophy-path" aria-label="Trophy progress unavailable">
      <h2>Your trophy path.</h2><p className="mt-2 text-sm text-muted-foreground">Your production progress could not be verified. Your recorded awards remain separate below.</p>
      <Button variant="outline" className="mt-3" onClick={() => { identity.refetch(); if (identity.agentId) void workspace.refetch(); }}>Retry trophy progress</Button>
    </section>
  );
  return <TrophyProgressionView levels={levels} />;
}
