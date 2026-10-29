import { formatPhoneDisplay } from "@/lib/phone";
export const TOPICS: Record<string, string> = {
  join_team: "Join team",
  income: "Make money / income",
  car_rental: "Car rental",
  team_info: "Team info",
  next_steps: "Next steps",
  licensing: "Licensing",
  booking: "Interview / booking",
  payment: "Payment",
  other: "Other",
};
export const SOURCES: Record<string, string> = {
  imessage: "iMessage",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
};
export function phoenixDay(value: string | number = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function absoluteTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}
export function relativeTime(value: string | null, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time unavailable";
  const delta = now - Date.parse(value);
  const seconds = Math.max(0, Math.round(delta / 1000));
  if (delta < 0) return "In the future — check source";
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
export function contactLabel(name: string | null, handle: string | null) {
  if (name) return name;
  if (!handle) return "Unknown contact";
  return formatPhoneDisplay(handle);
}
