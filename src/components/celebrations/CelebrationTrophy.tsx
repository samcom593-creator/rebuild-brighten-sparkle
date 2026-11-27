import { Trophy } from "lucide-react";
import "./celebration-trophy.css";

/** Decorative only: a saved win is celebrated here; this does not claim a plaque was earned or sent. */
export function CelebrationTrophy() {
  return <div className="celebration-trophy" aria-hidden="true"><Trophy size={30} strokeWidth={1.8} /></div>;
}
