// One source for what a telegram_groups row can say, because three surfaces were
// each carrying their own copy and all three disagreed with the database.
//
// 2026-08-30. telegram_groups.type is a CHECK-constrained text column, not an enum,
// so nothing in the type system or in PostgREST ever objected to a wrong word — a
// bad literal in a filter just returns nothing, and a bad literal in a write is
// rejected at row level after the statement is built. Measured against the live
// constraint, the copies were wrong in both directions at once:
//
//   src/pages/admin/SamHQ.tsx        asked for onboarding + licensing_reference +
//   src/pages/admin/TelegramBot.tsx  daily_movement + seminar_reminders + ask_apex_ai.
//                                    Four of those five can never exist, and the
//                                    three types the column CAN hold besides
//                                    onboarding were not asked for at all.
//   supabase/functions/telegram-webhook  wrote type:"lobby" on every bot-add (23514,
//                                    error discarded) and its welcome message
//                                    advertised seven types, four of them dead.
//
// Keep this list identical to telegram_groups_type_check. scripts/
// check-enum-filter-literals.mjs grades every literal in src/ and supabase/functions
// against the live constraint recorded in scripts/data/enum-catalog.json, so a drift
// here fails the build rather than silently emptying a panel.
export const TELEGRAM_GROUP_TYPES = [
  "pipeline",
  "ai_dm",
  "manager_alerts",
  "wins",
  "onboarding",
] as const;

export type TelegramGroupType = (typeof TELEGRAM_GROUP_TYPES)[number];

// Real Telegram chat ids are >= 1e6 in magnitude; the seeded placeholders (-1001,
// -1006) are not. This is the rule fn_post_new_applicant_to_onboarding_chat already
// uses (migration 20260807055000, `abs(chat_id) >= 1000000`).
//
// Both call sites in SamHQ.tsx tested `v > -1000 && v < 0` instead, which is true
// only for -1..-999 — so BOTH documented placeholders read as real, bound channels
// and the "Bind N Telegram HQ channels" action could never fire.
export const REAL_TELEGRAM_ID_MIN_MAGNITUDE = 1_000_000;

export function isPlaceholderChatId(chatId: string | number | null | undefined): boolean {
  const v = Number(chatId);
  if (!Number.isFinite(v)) return false;
  return Math.abs(v) < REAL_TELEGRAM_ID_MIN_MAGNITUDE;
}
