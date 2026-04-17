import { supabase } from "@/integrations/supabase/client";

type Level = "debug" | "info" | "warn" | "error";

const isDev = import.meta.env.DEV;

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  const entry = {
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
  };
  if (isDev || level === "error" || level === "warn") {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[${level}]`, message, context ?? "");
  }
  // Best-effort fire-and-forget to error_logs table for errors
  if (level === "error") {
    supabase.from("error_logs").insert({
      error_message: message,
      component_stack: context?.stack as string ?? null,
      url: typeof window !== "undefined" ? window.location.href : null,
    }).then(() => {}, () => {});
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};
