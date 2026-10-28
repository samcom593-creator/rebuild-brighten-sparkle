/**
 * Five soft colour fields drifting slowly behind the operating canvas (2026-10-28, Sam:
 * "add the bubbles and effects"). Pure CSS (src/styles/delight.css .apex-ambient): no
 * JavaScript runs, nothing takes a click, nothing is in the layout, the layer sits under
 * every card and control, and the drift stands still under prefers-reduced-motion. Phones
 * draw three.
 *
 * Motion review (2026-10-28): gold, sky, green, amber and coral, each at most 0.16 alpha at
 * its centre, each centre outside the viewport, none under the page title or the tab row, and
 * no violet field (the one background impeccable names as the tell of a generated page). The
 * fields animate transform only: five composited layers rastered once.
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
