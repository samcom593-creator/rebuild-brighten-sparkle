/**
 * MP-539: the funnel had no event between "form rendered" and "Next pressed".
 *
 * MP-512 instrumented the step machine (apply_start / apply_step_advance /
 * apply_step_blocked / apply_submit_attempt / apply_submitted) and MP-538 then
 * proved the /apply conversion ratio really is falling. Neither could say WHERE,
 * because measured over the instrumentation's first 4 live days every session
 * that advanced a step also submitted -- 7 of 7. There is no leak BETWEEN steps.
 * The entire loss sits before the first Next press, which emitted nothing at all.
 *
 * Measured on those 48 sessions: 41 never advanced, and they are two populations
 * with opposite remedies that apply_start merges under one name --
 *   - 27 left in under 15s (p50 dwell 5.1s), 24 with no web_vital.INP row at all:
 *     landed, never touched the form. No form change reaches these people.
 *   - 17 have an INP row, so they DID interact, and 7 stayed over 60s. They
 *     engaged and left anyway, and exactly ONE apply_step_blocked fired across
 *     all 41 -- so they are not quitting at a validation error, they are quitting
 *     mid-form where apply_step_blocked cannot see them by construction.
 *
 * This emits one event the first time the user edits each distinct field. The
 * first such event in a session splits engaged from bounced; the last one names
 * the field they quit on. Deliberately NOT a terminal (pagehide) "abandon"
 * event: track.ts registers its own flush on document visibilitychange and
 * window pagehide at app boot, so a listener added later on Apply mount fires
 * AFTER the queue has already drained and its event would never be sent. A
 * per-field emit needs no terminal flush and no ordering assumption, and it
 * records the whole path rather than only its last point.
 */

/** The second argument react-hook-form's watch() subscription passes. */
export interface WatchInfo {
  name?: string;
  type?: string;
}

/**
 * Builds the watch-subscription handler. `emit` is called at most once per
 * distinct root field, with the field NAME and its 1-based touch ordinal.
 *
 * Field names only, never values -- this lands in analytics_events, which the
 * anon role can insert into (the constraint MP-512 set for apply_step_blocked's
 * invalid_fields). A name localises the abandonment; a value publishes the
 * applicant.
 */
export function createFieldProgressTracker(
  emit: (field: string, ordinal: number) => void
): (info: WatchInfo | undefined) => void {
  const seen = new Set<string>();

  return (info) => {
    // Gate on type === 'change' -- the load-bearing line.
    //
    // Apply.tsx restores a saved application out of sessionStorage by calling
    // setValue() for every persisted field. RHF pushes those through the SAME
    // watch subscription, so without this gate a RESUMED session would report
    // that the user had just "first touched" every field they filled in on a
    // previous visit -- inventing engagement that never happened in that
    // session and contaminating the one number this event exists to produce.
    // Only real field events carry a type; setValue() leaves it undefined.
    if (info?.type !== "change") return;

    const name = info.name;
    if (!name) return;

    // Collapse nested / array paths ("licenses.0.state") onto their root so a
    // repeating field cannot emit once per row and outvote every other field.
    const root = name.split(/[.[]/)[0];
    if (!root || seen.has(root)) return;

    seen.add(root);
    emit(root, seen.size);
  };
}
