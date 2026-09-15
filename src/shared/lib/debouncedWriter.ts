/**
 * MP-541. A debounce whose timer id lives outside the callback that schedules it.
 *
 * This exists because /apply had a "debounced" sessionStorage write that never
 * debounced. The timer id was declared INSIDE a react-hook-form `watch`
 * callback and cancelled by `return () => clearTimeout(timeout)` -- but
 * react-hook-form discards a watch callback's return value (it is not a
 * useEffect and has no cleanup protocol), so nothing was ever cancelled.
 * Every keystroke scheduled its own timer and all of them fired: N synchronous
 * JSON.stringify + setItem pairs per N keystrokes, on the applicant path.
 * See src/tests/lib/debouncedWriter.test.ts, which pins react-hook-form's
 * actual behaviour so the original pattern cannot be reintroduced silently.
 *
 * `cancel()` is the other half and is not decorative: it lets an unmount or a
 * completed submit stop a write that is already in flight, which is what keeps
 * a pending timer from restoring PII into storage that was deliberately cleared.
 */
export interface DebouncedWriter<T> {
  /** Schedule a write, cancelling any write still waiting. */
  schedule: (value: T) => void;
  /** Drop any pending write. Safe to call when nothing is pending. */
  cancel: () => void;
  /** True while a write is waiting to fire. Exposed for tests and assertions. */
  isPending: () => boolean;
}

export function createDebouncedWriter<T>(
  delayMs: number,
  write: (value: T) => void,
): DebouncedWriter<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(value: T) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        write(value);
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    isPending() {
      return timer !== null;
    },
  };
}
