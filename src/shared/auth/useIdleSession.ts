import { useEffect, useRef, useState, useCallback } from "react";

interface UseIdleSessionOptions {
  /** Total idle time before forced sign-out (ms). Default: 60 minutes */
  idleTimeoutMs?: number;
  /** How long the warning is shown before sign-out (ms). Default: 60 seconds */
  warningMs?: number;
  /** Whether tracking is active (e.g. only when signed in) */
  enabled?: boolean;
  /** Callback fired when timer expires and user must be signed out */
  onTimeout: () => void | Promise<void>;
}

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
] as const;

/**
 * Tracks user activity and exposes a warning state before forced sign-out.
 * - Resets on any user activity
 * - Surfaces `showWarning` + `secondsRemaining` so callers can render a dialog
 * - Calls `onTimeout` exactly once when the idle window fully elapses
 */
export function useIdleSession({
  idleTimeoutMs = 60 * 60 * 1000,
  warningMs = 60 * 1000,
  enabled = true,
  onTimeout,
}: UseIdleSessionOptions) {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(Math.floor(warningMs / 1000));

  const lastActivityRef = useRef<number>(Date.now());
  const warningTimerRef = useRef<number | null>(null);
  const logoutTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) window.clearTimeout(logoutTimerRef.current);
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
    warningTimerRef.current = null;
    logoutTimerRef.current = null;
    countdownTimerRef.current = null;
  }, []);

  const scheduleTimers = useCallback(() => {
    clearAllTimers();
    const warnAfter = Math.max(0, idleTimeoutMs - warningMs);

    warningTimerRef.current = window.setTimeout(() => {
      setShowWarning(true);
      setSecondsRemaining(Math.floor(warningMs / 1000));

      // Tick countdown every second
      countdownTimerRef.current = window.setInterval(() => {
        setSecondsRemaining((s) => (s > 0 ? s - 1 : 0));
      }, 1000);

      // Fire timeout when warning expires
      logoutTimerRef.current = window.setTimeout(() => {
        clearAllTimers();
        setShowWarning(false);
        void onTimeoutRef.current();
      }, warningMs);
    }, warnAfter);
  }, [idleTimeoutMs, warningMs, clearAllTimers]);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (showWarning) return; // ignore activity once warning is up — user must explicitly extend
    scheduleTimers();
  }, [scheduleTimers, showWarning]);

  /** Called by UI when user clicks "Stay signed in" */
  const extendSession = useCallback(() => {
    setShowWarning(false);
    setSecondsRemaining(Math.floor(warningMs / 1000));
    lastActivityRef.current = Date.now();
    scheduleTimers();
  }, [scheduleTimers, warningMs]);

  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      setShowWarning(false);
      return;
    }

    scheduleTimers();
    const handler = () => resetActivity();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, handler, { passive: true }));

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, handler));
      clearAllTimers();
    };
  }, [enabled, scheduleTimers, resetActivity, clearAllTimers]);

  return { showWarning, secondsRemaining, extendSession };
}
