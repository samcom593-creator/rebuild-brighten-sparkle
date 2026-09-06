import { useEffect, useState } from "react";
import type { Levels } from "@/lib/callLab/useCallLabSession";

export function useLevelSnapshot(levelsRef: React.MutableRefObject<Levels>) {
  const [snap, setSnap] = useState({ input: 0, synthetic: false });
  useEffect(() => { const id = setInterval(() => { const l = levelsRef.current; setSnap((s) => { const input = Math.round(l.input * 100); return s.input === input && s.synthetic === l.outputSynthetic ? s : { input, synthetic: l.outputSynthetic }; }); }, 250); return () => clearInterval(id); }, [levelsRef]);
  return snap;
}
