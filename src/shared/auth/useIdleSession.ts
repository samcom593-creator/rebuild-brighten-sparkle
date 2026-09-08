import { useEffect, useRef, useState, useCallback } from "react";

interface UseIdleSessionOptions {
  /** Total idle time before forced sign-out (ms). Default: 8 hours (one workday). */
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

/** Shared across every APEX tab so working in one tab keeps the others alive. */
const CROSS_TAB_KEY = "apex:idle:last-activity";

/**
 * Tracks user activity and exposes a warning state before forced sign-out.
 *
 * WHY THIS IS TAB-AWARE (2026-09-08): agents work the dialer, Discord and carrier
 * portals in other tabs and apps. Activity events only fire on the focused tab, so a
 * timer that logs out on a blind setTimeout signs an agent out while they are mid-call
 * and shows them a 60-second warning they physically cannot see. That is what "we keep
 * getting kicked out" was. Three rules keep it honest:
 *   1. Never sign out while the tab is hidden — defer and let them answer when they return.
 *   2. Coming back to the tab after the window elapsed shows the WARNING, never an
 *      instant logout, so one click keeps the session.
 *   3. Activity in any APEX tab counts for all of them, and activity during the warning
 *      dismisses it — a present user is never signed out for failing to hit a button.
 */
export function useIdleSession({
  idleTimeoutMs = 8 * 60 * 60 * 1000,
  warningMs = 60 * 1000,
  enabled = true,
  onTimeout,
}: UseIdleSessionOptions) {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(Math.floor(warningMs / 1000));

  const lastActivityRef = useRef<number>(Date.now());
  const showWarningRef = useRef(false);
  const warningTimerRef = useRef<number | null>(null);
  const logoutTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  /** Set when the idle window elapsed while the tab was hidden; answered on return. */
  const deferredLogoutRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const isHidden = () => typeof document !== "undefined" && document.hidden;

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) window.clearTimeout(logoutTimerRef.current);
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
    warningTimerRef.current = null;
    logoutTimerRef.current = null;
    countdownTimerRef.current = null;
  }, []);

  const beginWarning = useCallback(() => {
    showWarningRef.current = true;
    setShowWarning(true);
    setSecondsRemaining(Math.floor(warningMs / 1000));

    countdownTimerRef.current = window.setInterval(() => {
      setSecondsRemaining((s) => (s > 0 ? s - 1 : 0));
    }, 1000);

    logoutTimerRef.current = window.setTimeout(() => {
      // Rule 1: a hidden tab cannot show a warning, so it must never sign anyone out.
      // Hold the decision until they come back and can actually answer it.
      if (isHidden()) {
        deferredLogoutRef.current = true;
        clearAllTimers();
        showWarningRef.current = false;
        setShowWarning(false);
        return;
      }
      clearAllTimers();
      showWarningRef.current = false;
      setShowWarning(false);
      void onTimeoutRef.current();
    }, warningMs);
  }, [warningMs, clearAllTimers]);

  const scheduleTimers = useCallback(() => {
    clearAllTimers();
    const warnAfter = Math.max(0, idleTimeoutMs - warningMs);

    warningTimerRef.current = window.setTimeout(() => {
      if (isHidden()) {
        // Idle window elapsed off-screen. Defer; the visibility handler asks on return.
        deferredLogoutRef.current = true;
        return;
      }
      beginWarning();
    }, warnAfter);
  }, [idleTimeoutMs, warningMs, clearAllTimers, beginWarning]);

  const resetActivity = useCallback(
    (broadcast = true) => {
      lastActivityRef.current = Date.now();
      deferredLogoutRef.current = false;
      // Rule 3: a present, active user is never signed out for missing a button.
      if (showWarningRef.current) {
        showWarningRef.current = false;
        setShowWarning(false);
      }
      if (broadcast) {
        try {
          localStorage.setItem(CROSS_TAB_KEY, String(lastActivityRef.current));
        } catch (e) {
          // empty-catch-allow:cross-tab-activity-is-best-effort — private mode or a
          // full quota only costs the cross-tab sync; this tab's own timer still runs.
          void e;
        }
      }
      scheduleTimers();
    },
    [scheduleTimers],
  );

  /** Called by UI when user clicks "Stay signed in" */
  const extendSession = useCallback(() => {
    setSecondsRemaining(Math.floor(warningMs / 1000));
    resetActivity();
  }, [resetActivity, warningMs]);

  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      showWarningRef.current = false;
      deferredLogoutRef.current = false;
      setShowWarning(false);
      return;
    }

    scheduleTimers();

    const handler = () => resetActivity();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, handler, { passive: true }));

    // Another APEX tab saw activity — this tab is alive too.
    const onStorage = (e: StorageEvent) => {
      if (e.key === CROSS_TAB_KEY && e.newValue) resetActivity(false);
    };
    window.addEventListener("storage", onStorage);

    // Rule 2: returning to the tab never lands on an instant logout.
    const onVisibility = () => {
      if (isHidden()) return;
      if (deferredLogoutRef.current) {
        deferredLogoutRef.current = false;
        clearAllTimers();
        beginWarning();
        return;
      }
      resetActivity();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, handler));
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
      clearAllTimers();
    };
  }, [enabled, scheduleTimers, resetActivity, clearAllTimers, beginWarning]);

  return { showWarning, secondsRemaining, extendSession };
}
