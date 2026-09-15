/**
 * applyFieldProgress.test.ts — MP-539
 *
 * Contract for the /apply first-field-input funnel event.
 *
 * Imports the REAL createFieldProgressTracker rather than restating its logic:
 * a test that copies the code it guards proves only that the copy is
 * self-consistent (MP-274). Every case below drives the shipped function.
 *
 * Coverage:
 *   ✅ a user edit emits once, with the field name and a 1-based ordinal
 *   ✅ the SAME field edited repeatedly emits exactly once (dedupe)
 *   ✅ ordinals count distinct fields in touch order
 *   ✅ setValue()-shaped notifications (type undefined) emit NOTHING
 *      — the sessionStorage restore path, and the reason this gate exists
 *   ✅ focus/blur notifications emit nothing
 *   ✅ nested + array paths collapse onto their root field
 *   ✅ a missing field name is ignored rather than emitted as ""
 *   ✅ two trackers keep independent state (one per mounted form)
 */

import { describe, it, expect, vi } from "vitest";
import { createFieldProgressTracker } from "@/shared/telemetry/applyFieldProgress";

/** A real user edit as react-hook-form reports it. */
const change = (name: string) => ({ name, type: "change" });

describe("createFieldProgressTracker", () => {
  it("emits once per field with name and 1-based ordinal", () => {
    const emit = vi.fn();
    const onWatch = createFieldProgressTracker(emit);

    onWatch(change("firstName"));

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("firstName", 1);
  });

  it("dedupes repeat edits of the same field", () => {
    const emit = vi.fn();
    const onWatch = createFieldProgressTracker(emit);

    // One field, many keystrokes — the shape every real typed field makes.
    for (let i = 0; i < 25; i++) onWatch(change("email"));

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("counts distinct fields in touch order", () => {
    const emit = vi.fn();
    const onWatch = createFieldProgressTracker(emit);

    onWatch(change("firstName"));
    onWatch(change("firstName"));
    onWatch(change("lastName"));
    onWatch(change("email"));
    onWatch(change("lastName"));

    expect(emit.mock.calls).toEqual([
      ["firstName", 1],
      ["lastName", 2],
      ["email", 3],
    ]);
  });

  it("emits NOTHING for setValue()-shaped notifications", () => {
    const emit = vi.fn();
    const onWatch = createFieldProgressTracker(emit);

    // Apply.tsx restores a saved application by calling setValue() per field.
    // RHF pushes those through the same subscription with no `type`. Treating
    // them as edits would report that a returning visitor had just engaged with
    // every field they filled in on a previous visit.
    onWatch({ name: "firstName" });
    onWatch({ name: "email" });
    onWatch({ name: "phone", type: undefined });

    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores focus and blur", () => {
    const emit = vi.fn();
    const onWatch = createFieldProgressTracker(emit);

    onWatch({ name: "phone", type: "focus" });
    onWatch({ name: "phone", type: "blur" });

    expect(emit).not.toHaveBeenCalled();
  });

  it("does not let a restore suppress the user's later real edit", () => {
    const emit = vi.fn();
    const onWatch = createFieldProgressTracker(emit);

    // The restore must not mark the field seen, or the edit that follows it
    // would be swallowed and the session would look like it never engaged.
    onWatch({ name: "email" });
    onWatch(change("email"));

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("email", 1);
  });

  it("collapses nested and array paths onto their root field", () => {
    const emit = vi.fn();
    const onWatch = createFieldProgressTracker(emit);

    onWatch(change("licensedStates.0"));
    onWatch(change("licensedStates.1"));
    onWatch(change("licensedStates[2]"));
    onWatch(change("address.city"));

    expect(emit.mock.calls).toEqual([
      ["licensedStates", 1],
      ["address", 2],
    ]);
  });

  it("ignores a change with no field name", () => {
    const emit = vi.fn();
    const onWatch = createFieldProgressTracker(emit);

    onWatch({ type: "change" });
    onWatch(undefined);

    expect(emit).not.toHaveBeenCalled();
  });

  it("keeps per-tracker state independent", () => {
    const a = vi.fn();
    const b = vi.fn();
    const onA = createFieldProgressTracker(a);
    const onB = createFieldProgressTracker(b);

    onA(change("email"));
    onB(change("email"));

    expect(a).toHaveBeenCalledWith("email", 1);
    expect(b).toHaveBeenCalledWith("email", 1);
  });
});
