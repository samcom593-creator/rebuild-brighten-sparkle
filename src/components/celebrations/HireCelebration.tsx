import { useEffect } from "react";
import { X } from "lucide-react";
import { HIRE_BATCH_NAMES_SHOWN, hireHeadline, type HireCelebrationBatch } from "@/lib/hireCelebrations";
import { prefersReducedMotion } from "@/lib/celebrate";
import "./hire-celebration.css";

// Hex is what canvas-confetti reads: the dark-theme tones from src/styles/delight.css.
const CONFETTI_COLORS = ["#f0c330", "#41d38a", "#64b4f7", "#faefc4"];

/**
 * The hire screen (MP-HIRE-CELEBRATION). Shows a hire's name, license track,
 * agent code and recruiter — the same four facts the Slack post carries, and
 * nothing a payload could smuggle. No phone, email or address ever enters this UI.
 */
export function HireCelebration({ batch, managerNames, onDismiss }: {
  batch: HireCelebrationBatch;
  managerNames: Record<string, string>;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cancelled = false;
    // Loaded on first use (about 10 KB), like src/lib/celebrate.ts; a failed chunk
    // is decoration that never breaks the screen it decorates.
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;
      const k = typeof window !== "undefined" && window.innerWidth < 640 ? 0.6 : 1;
      const base = { shapes: ["circle" as const], disableForReducedMotion: true, zIndex: 10000, colors: CONFETTI_COLORS };
      confetti({ ...base, particleCount: Math.round(90 * k), spread: 100, startVelocity: 34, gravity: 0.9, ticks: 140, origin: { x: 0.5, y: 0.55 } });
      window.setTimeout(() => {
        if (cancelled) return;
        confetti({ ...base, origin: { x: 0.12, y: 0.72 }, angle: 60, particleCount: Math.round(36 * k), spread: 60, startVelocity: 36, ticks: 120 });
        confetti({ ...base, origin: { x: 0.88, y: 0.72 }, angle: 120, particleCount: Math.round(36 * k), spread: 60, startVelocity: 36, ticks: 120 });
      }, 180);
    }).catch(() => undefined); // empty-catch-allow:confetti-is-decoration
    return () => { cancelled = true; };
  }, [batch.key]);

  const shown = batch.hires.slice(0, HIRE_BATCH_NAMES_SHOWN);
  const more = batch.hires.length - shown.length;

  return (
    <aside className="hire-celebration" aria-label="New hire celebration">
      <div className="hire-celebration-backdrop" aria-hidden="true" />
      <div className="hire-celebration-card">
        <div className="hire-celebration-balloons" aria-hidden="true">
          {/* stable-key-allow:fixed-decorative-balloons */}
          {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
        </div>
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="hire-celebration-eyebrow">New hire</p>
          <p className="hire-celebration-title">{hireHeadline(batch)}</p>
          <ul className="hire-celebration-list">
            {shown.map((hire) => {
              const recruiter = hire.managerIds.map((id) => managerNames[id]).find(Boolean);
              return (
                <li key={hire.id} className="hire-celebration-hire">
                  <span className="hire-celebration-name">{hire.displayName}</span>
                  <span className={`hire-celebration-chip ${hire.licensed ? "hire-celebration-chip-licensed" : "hire-celebration-chip-prelicense"}`}>
                    {hire.licensed ? "Licensed" : "Pre-license"}
                  </span>
                  {hire.agentCode && <span className="hire-celebration-chip">{hire.agentCode}</span>}
                  {recruiter && <span className="hire-celebration-chip">Recruited by {recruiter}</span>}
                </li>
              );
            })}
            {more > 0 && <li className="hire-celebration-more">and {more} more</li>}
          </ul>
          <p className="hire-celebration-note">Added to the Galaxy roster. The team room has the post.</p>
        </div>
        <button className="hire-celebration-dismiss" type="button" aria-label="Dismiss hire celebration" onClick={onDismiss}>
          <X aria-hidden="true" size={20} />
        </button>
      </div>
    </aside>
  );
}
