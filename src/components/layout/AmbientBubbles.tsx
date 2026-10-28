/**
 * Five soft colour fields drifting slowly behind the operating canvas (2026-10-28, Sam:
 * "add the bubbles and effects"). Pure CSS (src/styles/delight.css .apex-ambient): no
 * JavaScript runs, nothing takes a click, the layer sits under every card and control, and
 * the drift stops under prefers-reduced-motion. Phones draw three.
 */
export function AmbientBubbles() {
  return (
    <div className="apex-ambient" aria-hidden="true" data-testid="ambient-bubbles">
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
