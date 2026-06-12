import { addDays } from "https://esm.sh/date-fns@4.1.0";
import { formatInTimeZone, fromZonedTime } from "https://esm.sh/date-fns-tz@3.2.0";

export const APP_BASE_URL =
  (Deno.env.get("APP_BASE_URL") || "https://apex-financial.org").replace(/\/+$/, "");

export const BUSINESS_TIMEZONE = "America/Chicago";

export const SCHEDULING_LINKS = {
  unlicensed: "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone",
  licensed: "https://calendly.com/apexfinancialempire/1on1-call-clone",
} as const;

export const DISCORD_WEBHOOK_KEYS = {
  production: "discord_webhook_url",
  recruiting: "discord_webhook_url_recruiting",
} as const;

export const VALID_DEAL_STATUSES = ["submitted", "active"] as const;

export type DiscordAudience = keyof typeof DISCORD_WEBHOOK_KEYS;

export function buildAppUrl(path = "/"): string {
  if (!path.startsWith("/")) return `${APP_BASE_URL}/${path}`;
  return `${APP_BASE_URL}${path}`;
}

export function isDiscordWebhookUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(value.trim());
}

async function readSystemSetting(supabase: any, key: string): Promise<string | null> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  const value = (data as { value?: string } | null)?.value?.trim();
  return value || null;
}

/**
 * v26 NO-SPAM RULE · 2026-06-11
 * Every Discord post path now passes through canPostToDiscord() first.
 * Honors:
 *   - system_settings.discord_notifications_paused  (HARD kill switch)
 *   - should_post_to_discord(category, max_per_hour) (DB-level rate limit)
 * Returns false → caller must SILENTLY skip. No error, no throw.
 */
export async function canPostToDiscord(
  supabase: any,
  category: string = "default",
  maxPerHour: number = 5,
): Promise<boolean> {
  // Hard kill switch
  const paused = await readSystemSetting(supabase, "discord_notifications_paused");
  if (paused && paused.trim().toLowerCase() === "true") {
    console.log(`[discord-guard] PAUSED (system_settings.discord_notifications_paused=true)`);
    return false;
  }
  // DB-level rate limit (hourly bucket, max 5 per category per hour by default)
  const { data, error } = await supabase.rpc("should_post_to_discord", {
    p_category: category,
    p_max_per_hour: maxPerHour,
  });
  if (error) {
    console.warn(`[discord-guard] rpc error: ${error.message}; defaulting to ALLOW`);
    return true; // fail-open to keep critical pings flowing if DB hiccups
  }
  if (data === false) {
    console.log(`[discord-guard] RATE LIMIT exceeded for category=${category} (max ${maxPerHour}/hr)`);
  }
  return data !== false;
}

export async function resolveDiscordWebhook(
  supabase: any,
  audience: DiscordAudience,
): Promise<string> {
  // v26 NO-SPAM RULE · check kill switch + rate limit FIRST. If the guard
  // returns false, throw a sentinel that callers must catch + ignore.
  if (!(await canPostToDiscord(supabase, audience))) {
    throw new Error("DISCORD_SUPPRESSED");
  }

  const envKey = audience === "recruiting" ? "DISCORD_WEBHOOK_URL_RECRUITING" : "DISCORD_WEBHOOK_URL";
  const envValue = Deno.env.get(envKey)?.trim();
  if (isDiscordWebhookUrl(envValue)) return envValue;

  const settingValue = await readSystemSetting(supabase, DISCORD_WEBHOOK_KEYS[audience]);
  if (isDiscordWebhookUrl(settingValue)) return settingValue;

  if (audience === "recruiting") {
    const fallbackEnv = Deno.env.get("DISCORD_WEBHOOK_URL")?.trim();
    if (isDiscordWebhookUrl(fallbackEnv)) {
      console.warn("[discord] recruiting webhook missing; falling back to production env webhook");
      return fallbackEnv;
    }

    const fallbackSetting = await readSystemSetting(supabase, DISCORD_WEBHOOK_KEYS.production);
    if (isDiscordWebhookUrl(fallbackSetting)) {
      console.warn("[discord] recruiting webhook missing; falling back to production system setting");
      return fallbackSetting;
    }
  }

  throw new Error(
    audience === "recruiting"
      ? "Missing Discord recruiting webhook. Configure discord_webhook_url_recruiting or DISCORD_WEBHOOK_URL_RECRUITING."
      : "Missing Discord production webhook. Configure discord_webhook_url or DISCORD_WEBHOOK_URL.",
  );
}

export function getBusinessDayKey(date: Date = new Date()): string {
  return formatInTimeZone(date, BUSINESS_TIMEZONE, "yyyy-MM-dd");
}

export function getBusinessDayBounds(date: Date = new Date()) {
  const startKey = getBusinessDayKey(date);
  const endKey = formatInTimeZone(addDays(date, 1), BUSINESS_TIMEZONE, "yyyy-MM-dd");
  const start = fromZonedTime(`${startKey}T00:00:00`, BUSINESS_TIMEZONE);
  const end = fromZonedTime(`${endKey}T00:00:00`, BUSINESS_TIMEZONE);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function getBusinessMonthBounds(date: Date = new Date()) {
  const monthStartKey = formatInTimeZone(date, BUSINESS_TIMEZONE, "yyyy-MM-01");
  const nextDayKey = formatInTimeZone(addDays(date, 1), BUSINESS_TIMEZONE, "yyyy-MM-dd");
  const start = fromZonedTime(`${monthStartKey}T00:00:00`, BUSINESS_TIMEZONE);
  const end = fromZonedTime(`${nextDayKey}T00:00:00`, BUSINESS_TIMEZONE);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}
