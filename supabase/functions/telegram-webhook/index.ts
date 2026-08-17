// APEX Telegram Bot — webhook handler
//
// Deploy: pushed to main by CI (see .github/workflows/deploy-supabase.yml).
//
// Env required (set via Supabase secrets):
//   APEX_TELEGRAM_BOT_TOKEN      — from @BotFather (Sam drops it on his phone)
//   APEX_TELEGRAM_WEBHOOK_SECRET — random string, set via /setWebhook secret_token
//   APEX_TELEGRAM_BOT_USERNAME   — bot @-handle without the @ (e.g. ApexFinancialBot)
//   ANTHROPIC_API_KEY            — optional, enables Ask Apex AI
//   ANTHROPIC_MODEL              — optional, defaults to claude-haiku-4-5-20251001
//
// Companion daemon: ~/business-ops/telegram-bot/scripts/nudge-runner.py runs
// every 5 min via launchd, syncs stages from applications/agents and drains
// telegram_scheduled_messages.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("APEX_TELEGRAM_BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("APEX_TELEGRAM_WEBHOOK_SECRET") ?? "";
const BOT_USERNAME = Deno.env.get("APEX_TELEGRAM_BOT_USERNAME") ?? "ApexFinancialBot";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

const APPLY_URL = "https://apex-financial.org/apply?utm_source=telegram&utm_medium=bot";
const ICA_URL = "https://apex-financial.org/pay-ica";
const LICENSE_URL = "https://apex-financial.org/get-licensed";
const LICENSED_CALL_URL = "https://calendly.com/apexfinancialempire/1on1-call-clone";

const PUBLIC_GROUP_COMMANDS = new Set([
  "/help",
  "/ask",
  "/faq",
  "/resources",
  "/contracting",
  "/license",
  "/exam",
  "/seminar",
  "/apply",
]);

const RESOURCE_TEXT =
  `APEX recruit resources:\n\n` +
  `1. Apply: ${APPLY_URL}\n` +
  `2. ICA/payment gate: ${ICA_URL}\n` +
  `3. Licensing path: ${LICENSE_URL}\n` +
  `4. Exam help: /exam\n` +
  `5. Seminar info: /seminar\n` +
  `6. Contracting checklist: /contracting\n` +
  `7. Human help: /manager\n\n` +
  `Already licensed? Book the licensed call: ${LICENSED_CALL_URL}`;

const CONTRACTING_TEXT =
  `Contracting checklist:\n\n` +
  `1. Prelicensing course paid -> contracting packet sent within 24 hours.\n` +
  `2. Have these ready: license number/state, SSN for background, direct deposit/routing, driver's license photo, monitored email + phone.\n` +
  `3. Fill carrier forms carefully. Bad direct deposit or missed carrier emails can stall commissions.\n` +
  `4. Background check usually takes 2-5 days. Carrier appointments usually take 5-10 business days each.\n` +
  `5. First carrier approved -> writing number issued -> ready to write.\n\n` +
  `Stuck or missing a packet? Use /manager.`;

const FAQ_TEXT =
  `Fast commands:\n\n` +
  `/status - see your file\n` +
  `/resources - links and next steps\n` +
  `/contracting - paperwork checklist\n` +
  `/license - pre-license path\n` +
  `/exam - exam scheduling help\n` +
  `/seminar - next seminar info\n` +
  `/ask how long does licensing take - FAQ answer\n` +
  `/manager - human escalation`;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const TG = (m: string) => `https://api.telegram.org/bot${BOT_TOKEN}/${m}`;

// ============================================================================
// LOW-LEVEL TG API
// ============================================================================

async function tgSend(payload: {
  chat_id: number;
  text: string;
  parse_mode?: string;
  reply_markup?: any;
  disable_web_page_preview?: boolean;
}): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.error("APEX_TELEGRAM_BOT_TOKEN not set — cannot send");
    return false;
  }
  try {
    const r = await fetch(TG("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: payload.chat_id,
        text: payload.text,
        parse_mode: payload.parse_mode ?? "HTML",
        reply_markup: payload.reply_markup,
        disable_web_page_preview: payload.disable_web_page_preview ?? true,
      }),
    });
    if (!r.ok) {
      console.error("tgSend non-ok", r.status, await r.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("tgSend error", e);
    return false;
  }
}

// ============================================================================
// TEMPLATE RENDER
// ============================================================================

async function renderTemplate(key: string, ctx: Record<string, unknown> = {}) {
  const { data } = await sb.from("telegram_templates")
    .select("body, parse_mode, buttons")
    .eq("key", key)
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  let body = data.body as string;
  for (const [k, v] of Object.entries(ctx)) {
    body = body.replaceAll(`{${k}}`, String(v ?? ""));
  }
  body = body.replace(/\{[a-zA-Z0-9_]+\}/g, "");
  return { body, parse_mode: (data.parse_mode as string) ?? "HTML", buttons: data.buttons };
}

async function sendTemplate(chat_id: number, key: string, ctx: Record<string, unknown> = {}, override_markup?: any): Promise<boolean> {
  const t = await renderTemplate(key, ctx);
  if (!t) {
    console.error(`template missing: ${key}`);
    return false;
  }
  const ok = await tgSend({
    chat_id,
    text: t.body,
    parse_mode: t.parse_mode,
    reply_markup: override_markup ?? t.buttons ?? undefined,
  });
  if (ok) {
    await sb.from("telegram_messages").insert({
      chat_id,
      direction: "outbound",
      message_type: "template",
      text: t.body,
      template_key: key,
      context: ctx,
    });
  }
  return ok;
}

// ============================================================================
// AUDIT INGEST
// ============================================================================

async function ingest(chat_id: number, telegram_user_id: number | null, opts: {
  direction: "inbound" | "outbound";
  message_type: string;
  text?: string;
  command?: string;
  context?: Record<string, unknown>;
}) {
  await sb.from("telegram_messages").insert({
    chat_id,
    telegram_user_id,
    direction: opts.direction,
    message_type: opts.message_type,
    text: opts.text ?? null,
    command: opts.command ?? null,
    context: opts.context ?? {},
  });
}

async function upsertUser(chat: any, fromUser: any) {
  if (chat?.type !== "private" || !fromUser) return;
  await sb.from("telegram_users").upsert({
    chat_id: chat.id,
    telegram_user_id: fromUser.id,
    username: fromUser.username ?? null,
    first_name: fromUser.first_name ?? null,
    last_name: fromUser.last_name ?? null,
    language_code: fromUser.language_code ?? "en",
    last_active_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  }, { onConflict: "chat_id", ignoreDuplicates: false });
}

// ============================================================================
// ESCALATION
// ============================================================================

const HARD_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(manager|human|talk to (someone|a person)|speak to|call me|phone me)\b/i, reason: "keyword_trigger" },
  { re: /\b(commission|comp|split|payout|paycheck|refund|chargeback|charged)\b/i, reason: "money_question" },
  { re: /\b(contract|terms|legal|sue|lawsuit|attorney|cancel|quit|exit)\b/i, reason: "legal_question" },
  { re: /\b(part[\s-]?time|side hustle|on the side|nights and weekends)\b/i, reason: "part_time_question" },
];

async function raiseEscalation(chat_id: number, reason: string, ctx: Record<string, unknown> = {}): Promise<number | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await sb.from("telegram_escalations")
    .select("id")
    .eq("chat_id", chat_id)
    .is("resolved_at", null)
    .gt("created_at", since)
    .maybeSingle();
  if (existing) {
    await sb.from("telegram_escalations").update({ trigger_context: { ...ctx, also_triggered: reason } }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await sb.from("telegram_escalations")
    .insert({ chat_id, reason, trigger_context: ctx })
    .select("id")
    .single();
  if (error) {
    console.error("escalation insert", error);
    return null;
  }
  await sb.from("telegram_users").update({
    escalated_at: new Date().toISOString(),
    escalated_reason: reason,
  }).eq("chat_id", chat_id);
  await postManagerAlert(chat_id, reason, data?.id);
  return data?.id ?? null;
}

async function postManagerAlert(source_chat_id: number, reason: string, escalationId?: number | null) {
  const { data: group } = await sb.from("telegram_groups")
    .select("chat_id")
    .eq("type", "manager_alerts")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!group?.chat_id) {
    console.warn("no manager_alerts group registered — cannot post alert");
    return;
  }

  const hourCT = new Date().getUTCHours() - 5;
  const quiet = hourCT >= 22 || hourCT < 7;
  if (quiet && reason !== "money_question") {
    const target = new Date();
    target.setUTCHours(12, 0, 0, 0);
    if (target.getTime() < Date.now()) target.setUTCDate(target.getUTCDate() + 1);
    await sb.from("telegram_scheduled_messages").insert({
      chat_id: group.chat_id,
      template_key: "escalation.manager_alert",
      context: { source_chat_id, reason, escalation_id: escalationId },
      scheduled_at: target.toISOString(),
      reason: "escalation_deferred_quiet_hours",
    });
    return;
  }

  const { data: user } = await sb.from("telegram_users").select("first_name, username, stage").eq("chat_id", source_chat_id).maybeSingle();
  const body =
    `🚨 Telegram escalation\n` +
    `From: ${user?.first_name ?? "?"} (@${user?.username ?? "no_handle"}) — stage \`${user?.stage ?? "?"}\`\n` +
    `Reason: ${reason}\n` +
    `Source chat_id: ${source_chat_id}\n` +
    `Escalation id: ${escalationId ?? "?"}`;

  await tgSend({
    chat_id: group.chat_id,
    text: body,
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Take this", callback_data: `esc:take:${escalationId}` },
        { text: "✔ Resolve", callback_data: `esc:resolve:${escalationId}` },
      ]],
    },
  });
}

async function checkEscalation(chat_id: number, text: string): Promise<boolean> {
  for (const p of HARD_PATTERNS) {
    if (p.re.test(text)) {
      await raiseEscalation(chat_id, p.reason, { matched_text: text.slice(0, 240) });
      if (p.reason === "money_question" || p.reason === "legal_question") {
        await sendTemplate(chat_id, "ai.escalating", { manager: "your assigned manager" });
      } else {
        await sendTemplate(chat_id, "escalation.confirmed", {
          manager: "your assigned manager",
          manager_phone: "(see DM after pickup)",
        });
      }
      return true;
    }
  }
  return false;
}

// ============================================================================
// AI (FAQ + Anthropic fallback)
// ============================================================================

async function tryFAQ(q: string) {
  const tokens = q.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [];
  if (tokens.length === 0) return null;
  const tokenSet = new Set<string>(tokens);
  const { data } = await sb.from("telegram_faq")
    .select("id, answer_body, match_keywords, use_count")
    .eq("active", true);
  if (!data) return null;
  let best: any = null;
  let bestScore = 0;
  for (const row of data) {
    const kws = (row.match_keywords as string[] | null) ?? [];
    const matches = kws.filter((k) => tokenSet.has(k.toLowerCase())).length;
    if (matches > bestScore) {
      bestScore = matches;
      best = row;
    }
  }
  return bestScore >= 2 ? best : null;
}

async function aiAnswer(chat_id: number, question: string) {
  const q = question.trim();
  if (q.length < 3) {
    await tgSend({ chat_id, text: "Ask me a real question — full sentence." });
    return;
  }

  const hit = await tryFAQ(q);
  if (hit) {
    await tgSend({ chat_id, text: hit.answer_body });
    await sb.from("telegram_faq")
      .update({ use_count: hit.use_count + 1, last_used_at: new Date().toISOString() })
      .eq("id", hit.id);
    return;
  }

  if (!ANTHROPIC_KEY) {
    await sendTemplate(chat_id, "ai.fallback_unknown");
    return;
  }

  const { data: faqs } = await sb.from("telegram_faq")
    .select("category, question_pattern, answer_body")
    .eq("active", true);
  const faqContext = (faqs ?? []).slice(0, 30)
    .map((r: any) => `[${r.category}] Q: ${r.question_pattern}\nA: ${r.answer_body}`)
    .join("\n\n");

  const system = `You are the APEX bot answering inside Telegram for a candidate or new agent at Apex Financial — a life insurance recruiting agency.

Voice: direct, faith-aware (Christian, never preachy), no corporate hedging. ≤ 60 words.

REFUSE and tell them you're routing to a manager (don't answer) if the question is about:
- Money: commissions, splits, payouts, refunds, paycheck timing
- Contract / legal terms
- Working part-time

Otherwise, answer accurately using the knowledge base below. If you don't have confident info, say so plainly and suggest /manager.

End with one of: a next-step CTA, a /command suggestion, or an offer to escalate.

KNOWLEDGE BASE:
${faqContext}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: q }],
      }),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}`);
    const j = await r.json();
    const answer = ((j.content?.[0]?.text) ?? "").trim();
    if (!answer) {
      await sendTemplate(chat_id, "ai.fallback_unknown");
      return;
    }
    if (/manager|human/i.test(answer) && /route|escalat/i.test(answer)) {
      await raiseEscalation(chat_id, "ai_routed_to_manager", { question: q });
    }
    await tgSend({ chat_id, text: answer });
    await sb.from("telegram_messages").insert({
      chat_id,
      direction: "outbound",
      message_type: "ai_answer",
      text: answer,
      ai_answered: true,
      context: { question: q, model: ANTHROPIC_MODEL },
    });
  } catch (e) {
    console.error("anthropic error", e);
    await sendTemplate(chat_id, "ai.fallback_unknown");
  }
}

// ============================================================================
// STATUS LOOKUP / IDENTITY
// ============================================================================

function inferNextStep(stage: string): string {
  switch (stage) {
    case "lobby": return "Apply at apex-financial.org/apply";
    case "applied_unpaid": return "Pay ICA — it's the gate to a manager call";
    case "applied_paid": return "Book your manager call";
    case "manager_call_scheduled": return "Be on camera for the call";
    case "manager_call_done": return "RSVP next seminar";
    case "seminar_rsvp": return "Attend live, camera on";
    case "seminar_attended": return "Enroll pre-license course";
    case "pre_license_studying": return "30 min/day study. Schedule exam.";
    case "exam_scheduled": return "Pass the exam.";
    case "licensed": return "Hire docs incoming from your manager.";
    case "hired": return "Onboarding D1 — paperwork + first video.";
    case "active_agent": return "Move to Discord — production lives there.";
    default: return "Run /help.";
  }
}

async function statusCommand(chat_id: number) {
  const { data: user } = await sb.from("telegram_users")
    .select("first_name, stage, applicant_id, agent_id")
    .eq("chat_id", chat_id)
    .maybeSingle();
  if (!user) {
    await tgSend({ chat_id, text: "I don't have your file yet. Run /start." });
    return;
  }
  let appliedAt = "not on file";
  let icaStatus = "—";
  let managerCall = "—";
  if (user.applicant_id) {
    const { data: app } = await sb.from("applications")
      .select("created_at, ica_paid_at, status")
      .eq("id", user.applicant_id)
      .maybeSingle();
    if (app) {
      appliedAt = (app.created_at as string)?.slice(0, 10) ?? "unknown";
      icaStatus = app.ica_paid_at ? `✅ paid ${(app.ica_paid_at as string).slice(0, 10)}` : "❌ not paid";
      managerCall = String(app.status ?? "").toLowerCase().includes("call") ? `scheduled — ${app.status}` : "not booked";
    }
  }
  await sendTemplate(chat_id, "cmd.status", {
    first_name: user.first_name ?? "Friend",
    stage: user.stage,
    applied_at_short: appliedAt,
    ica_status: icaStatus,
    manager_call_status: managerCall,
    seminar_status: "—",
    license_status: "—",
    next_step_one_line: inferNextStep(user.stage as string),
  });
}

async function matchByContact(chat_id: number, phone?: string, email?: string, firstName?: string) {
  const normPhone = phone ? phone.replace(/\D/g, "").slice(-10) : null;
  const { data, error } = await sb.rpc("telegram_link_application", {
    p_chat_id: chat_id,
    p_phone: normPhone,
    p_email: email ? email.toLowerCase() : null,
  });
  if (error) {
    console.error("telegram_link_application", error);
    await tgSend({ chat_id, text: "I had a problem looking that up. Try /manager." });
    return;
  }
  const matched = (data as any[])?.[0];
  if (!matched?.applicant_id) {
    await sendTemplate(chat_id, "welcome.no_match", {
      contact: phone ? "that phone" : "that email",
      apply_link: APPLY_URL,
      first_name: firstName ?? "",
    });
    return;
  }
  if (matched.new_stage === "applied_paid") {
    await sendTemplate(chat_id, "welcome.matched_paid", {
      first_name: firstName ?? "Friend",
      ica_paid_at_short: (matched.ica_paid_at as string)?.slice(0, 10) ?? "—",
      manager_call_status: "not booked yet",
    });
  } else {
    await sendTemplate(chat_id, "welcome.matched_unpaid", {
      first_name: firstName ?? "Friend",
      ica_amount: "$125",
      ica_link: "https://apex-financial.org/pay-ica",
    });
  }
  await sb.from("telegram_users").update({ flow_state: {} }).eq("chat_id", chat_id);
}

// ============================================================================
// COMMAND ROUTER
// ============================================================================

async function handleCommand(chat_id: number, fromUser: any, command: string, args: string, isGroup: boolean) {
  if (isGroup && !PUBLIC_GROUP_COMMANDS.has(command)) {
    await tgSend({ chat_id, text: `DM me to use ${command}. I'll handle it 1:1.` });
    return;
  }
  switch (command) {
    case "/start": {
      // Deep-link payload: /start apply_<uuid> | agent_<uuid>
      // Telegram delivers the payload as `args` whenever someone clicks
      // https://t.me/ApexBot?start=<payload>. When we resolve it to an
      // applications.id or agents.id, auto-link telegram_users + stamp
      // {applications|agents}.telegram_chat_id so the dispatcher's Telegram
      // channel fires on subsequent nudges.
      const arg = (args ?? "").trim();
      const applyMatch = arg.match(/^apply[_-]([0-9a-fA-F-]{36})$/);
      const agentMatch = arg.match(/^agent[_-]([0-9a-fA-F-]{36})$/);

      if (applyMatch) {
        const applicationId = applyMatch[1];
        const { data: app } = await sb
          .from("applications")
          .select("id, first_name, ica_paid_at")
          .eq("id", applicationId)
          .maybeSingle();
        if (app) {
          // Match the stage names defined in the schema: applied_unpaid vs applied_paid.
          // Matches the auto-link trigger (telegram_autolink_application) so deep-link
          // and back-end auto-link produce identical stage values.
          const derivedStage = app.ica_paid_at ? "applied_paid" : "applied_unpaid";
          await Promise.all([
            sb.from("telegram_users").update({
              applicant_id: app.id,
              stage: derivedStage,
              flow_state: { step: "linked_via_deep_link", linked_at: new Date().toISOString() },
            }).eq("chat_id", chat_id),
            sb.from("applications").update({
              telegram_chat_id: chat_id,
              telegram_opt_out: false,
            }).eq("id", app.id),
          ]);
          await tgSend({
            chat_id,
            text: `Welcome ${app.first_name ?? "in"}. Your APEX application is linked. I'll keep you on track — next steps, seminar reminders, exam dates, manager pings, every step. Reply /status to see where you are now.`,
          });
          break;
        }
      }
      if (agentMatch) {
        const agentId = agentMatch[1];
        const { data: g } = await sb
          .from("agents")
          .select("id, display_name")
          .eq("id", agentId)
          .maybeSingle();
        if (g) {
          await Promise.all([
            sb.from("telegram_users").update({
              agent_id: g.id,
              stage: "hired",
              flow_state: { step: "linked_via_deep_link", linked_at: new Date().toISOString() },
            }).eq("chat_id", chat_id),
            sb.from("agents").update({
              telegram_chat_id: chat_id,
              telegram_opt_out: false,
            }).eq("id", g.id),
          ]);
          await tgSend({
            chat_id,
            text: `Linked to ${g.display_name ?? "your agent file"}. I'll route training, infield, and field-day reminders here.`,
          });
          break;
        }
      }

      // No deep-link OR unmatched payload — fall back to identity collection.
      await sendTemplate(chat_id, "welcome.start", {}, {
        inline_keyboard: [
          [{ text: "📱 Share contact", callback_data: "start:share_contact" }],
          [{ text: "📧 Use email", callback_data: "start:use_email" }],
          [{ text: "Haven't applied yet", callback_data: "start:no_application" }],
        ],
      });
      await sb.from("telegram_users").update({ flow_state: { step: "awaiting_identity" } }).eq("chat_id", chat_id);
      break;
    }
    case "/apply":
      await tgSend({
        chat_id,
        text: `Apply in 90 seconds. The moment you submit, your slot reserves on the calendar.\n\n${APPLY_URL}`,
      });
      break;
    case "/resources":
      await tgSend({ chat_id, text: RESOURCE_TEXT });
      break;
    case "/contracting":
      await tgSend({ chat_id, text: CONTRACTING_TEXT });
      break;
    case "/faq":
      if (!args.trim()) {
        await tgSend({ chat_id, text: FAQ_TEXT });
      } else {
        await aiAnswer(chat_id, args);
      }
      break;
    case "/status":
      await statusCommand(chat_id);
      break;
    case "/license":
      await tgSend({
        chat_id,
        text: `Pre-license course (life insurance):\n\n1. Enroll: https://apex-financial.org/get-licensed\n2. Daily 30 min minimum. Cohort moves with or without you.\n3. Get stuck → reply with the question and I'll route or answer.\n\nState-specific quirks? Tell me your state.`,
      });
      break;
    case "/exam":
      await tgSend({
        chat_id,
        text: `To schedule the life-insurance exam:\n\n1. Confirm pre-license course completion (≥ 20 hrs most states)\n2. Schedule via PSI or Pearson VUE\n3. Day-of: ID + course completion cert\n\nTell me your state and I'll send the exact scheduling URL.`,
      });
      break;
    case "/seminar": {
      const { data: setting } = await sb.from("system_settings").select("value").eq("key", "next_seminar_at").maybeSingle();
      const next = (setting as any)?.value;
      const text = next
        ? `Next seminar:\n\n${next}\n\nRSVP confirms your seat. Reminders fire T-24h and T-1h.`
        : `Next seminar isn't posted yet. Sam drops the date here as soon as it's locked. Reply /seminar again in a day, or ping Sam directly.`;
      await tgSend({ chat_id, text });
      break;
    }
    case "/training": {
      const { data: u } = await sb.from("telegram_users").select("stage, agent_id").eq("chat_id", chat_id).maybeSingle();
      const eligible = ["hired", "onboarding_d1", "onboarding_d3", "onboarding_d7", "onboarding_d14", "active_agent"];
      if (!u || !eligible.includes(u.stage as string)) {
        await tgSend({ chat_id, text: `Training opens after you're hired. Your stage: ${u?.stage ?? "unknown"}` });
      } else {
        // Discord link gate: LICENSED ONLY (matches send-agent-onboarding-email
        // guard). Unlicensed hired agents still get training + script library,
        // just no Discord line — Discord is post-license privilege.
        let isLicensed = false;
        if (u?.agent_id) {
          const { data: ag } = await sb
            .from("agents")
            .select("license_status")
            .eq("id", u.agent_id)
            .maybeSingle();
          const licenseStatus = ((ag as any)?.license_status ?? "").toString().toLowerCase();
          isLicensed = licenseStatus === "licensed";
        }
        const base = `Training hub:\n\n• Onboarding videos: https://apex-financial.org/training\n• Script library: https://apex-financial.org/training/scripts`;
        const text = isLicensed
          ? `${base}\n• Live floor (Discord): https://discord.gg/apex`
          : base;
        await tgSend({ chat_id, text });
      }
      break;
    }
    case "/manager":
      await raiseEscalation(chat_id, "user_requested", { command: "/manager" });
      await sendTemplate(chat_id, "escalation.confirmed", {
        manager: "your manager",
        manager_phone: "(see DM after pickup)",
      });
      break;
    case "/ask":
      if (!args.trim()) {
        await tgSend({ chat_id, text: "Ask me anything — `/ask how long does licensing take?`" });
      } else {
        await aiAnswer(chat_id, args);
      }
      break;
    case "/pause":
      await sb.from("telegram_users").update({ opt_out_nudges: true }).eq("chat_id", chat_id);
      await sendTemplate(chat_id, "cmd.pause");
      break;
    case "/resume":
      await sb.from("telegram_users").update({ opt_out_nudges: false }).eq("chat_id", chat_id);
      await sendTemplate(chat_id, "cmd.resume");
      break;
    case "/help":
      await sendTemplate(chat_id, "cmd.help");
      break;
    case "/register": {
      if (!isGroup) {
        await tgSend({ chat_id, text: "Run /register inside a group/channel — not in DM." });
        break;
      }
      // Sam-feedback 2026-06-03: TWO-LAYER architecture.
      // Layer 1 = per-applicant 1:1 DM with bot (private, automatic, no setup).
      // Layer 2 = ONE manager-only group ("pipeline") where bot posts every
      // applicant + milestone tagged with the owner manager. Applicants are
      // NEVER in this chat.
      const valid = ["pipeline", "onboarding", "manager_alerts", "wins"];
      const requested = (args ?? "").trim().toLowerCase();
      if (!requested || !valid.includes(requested)) {
        await tgSend({
          chat_id,
          text:
            `Usage: /register <type>\n\n` +
            `• pipeline — THE manager-only group. Sam + active assigned managers. ` +
            `Bot posts every new applicant + milestone here, tagged with the owner manager. ` +
            `APPLICANTS ARE NOT IN THIS CHAT. They only get private 1:1 DMs.\n` +
            `• onboarding — alias for pipeline (backward compat).\n` +
            `• manager_alerts — optional escalation room.\n` +
            `• wins — optional public proof board.\n\n` +
            `Example: /register pipeline`,
        });
        break;
      }
      const { error } = await sb
        .from("telegram_groups")
        .upsert({ chat_id, type: requested, is_active: true }, { onConflict: "chat_id" });
      if (error) {
        await tgSend({ chat_id, text: `Register failed: ${error.message}` });
      } else {
        await tgSend({
          chat_id,
          text: `Locked. This chat is now type=${requested}. Bot will route messages accordingly.`,
        });
      }
      break;
    }
    default:
      await tgSend({ chat_id, text: "Unknown command. Try /help." });
  }
}

// ============================================================================
// CALLBACK ROUTER
// ============================================================================

async function handleCallback(chat_id: number, data: string) {
  if (data === "start:share_contact") {
    await tgSend({
      chat_id,
      text: "Tap below to share your phone — fastest way to match your file.",
      reply_markup: {
        keyboard: [[{ text: "📱 Share my phone", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } else if (data === "start:use_email") {
    await sb.from("telegram_users").update({ flow_state: { step: "awaiting_email" } }).eq("chat_id", chat_id);
    await tgSend({ chat_id, text: "Drop the email you used on the application." });
  } else if (data === "start:no_application") {
    await tgSend({
      chat_id,
      text: `Apply in 90 seconds. The moment you submit, your slot reserves on the calendar.\n\n${APPLY_URL}`,
    });
  } else if (data.startsWith("esc:take:")) {
    const id = data.split(":")[2];
    await sb.from("telegram_escalations").update({ acknowledged_at: new Date().toISOString() }).eq("id", id);
  } else if (data.startsWith("esc:resolve:")) {
    const id = data.split(":")[2];
    await sb.from("telegram_escalations").update({ resolved_at: new Date().toISOString() }).eq("id", id);
  }
}

// ============================================================================
// CHAT-MEMBER / GROUP REGISTRATION
// ============================================================================

async function handleMyChatMember(update: any) {
  const ev = update.my_chat_member;
  if (!ev?.chat) return;
  const status = ev.new_chat_member?.status;
  if (ev.chat.type === "private" && (status === "kicked" || status === "left")) {
    await sb.from("telegram_users").update({ opt_out_all: true, stage: "opt_out" }).eq("chat_id", ev.chat.id);
    return;
  }
  if (["group", "supergroup", "channel"].includes(ev.chat.type)) {
    await sb.from("telegram_groups").upsert({
      chat_id: ev.chat.id,
      title: ev.chat.title ?? "(unnamed)",
      type: "lobby",
      is_active: false,
    }, { onConflict: "chat_id", ignoreDuplicates: true });
    await tgSend({
      chat_id: ev.chat.id,
      text:
        "Bot online here. To finish setup, send:\n" +
        "  /register onboarding   (recruit/hire pipeline)\n" +
        "  /register lobby        (top-of-funnel)\n" +
        "  /register licensing    (pre-license Q&A)\n" +
        "  /register seminar      (one-way blasts)\n" +
        "  /register training     (training library)\n" +
        "  /register wins         (proof board)\n" +
        "  /register manager_alerts (escalations)\n\n" +
        "One command, one tap, you're live.",
    });
  }
}

// ============================================================================
// WEBHOOK ENTRY
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  // Fail closed. The old `WEBHOOK_SECRET && ...` guard turned this endpoint
  // fully public the moment APEX_TELEGRAM_WEBHOOK_SECRET was missing or
  // rotated away. 503 tells Telegram to retry once the secret is restored
  // instead of us accepting spoofed updates in the meantime.
  if (!WEBHOOK_SECRET) {
    console.error("webhook: APEX_TELEGRAM_WEBHOOK_SECRET unset — refusing");
    return new Response("webhook secret not configured", { status: 503, headers: corsHeaders });
  }
  if (incomingSecret !== WEBHOOK_SECRET) {
    console.warn("webhook: bad secret");
    return new Response("forbidden", { status: 403, headers: corsHeaders });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("bad request", { status: 400, headers: corsHeaders });
  }

  // AgencyHub command-center fork: Sam's DMs (chat_id 6018839640) skip APEX
  // onboarding entirely and queue for the AgencyHub bridge to handle.
  // Same bot token serves both surfaces — APEX recruits + Sam's command center.
  const SAM_CHAT_ID = 6018839640;
  const samMsg = update.message?.chat?.id === SAM_CHAT_ID ? update.message : null;
  const samCb = update.callback_query?.message?.chat?.id === SAM_CHAT_ID ? update.callback_query : null;
  if (samMsg || samCb) {
    try {
      const m = samMsg ?? samCb.message;
      const text = samMsg ? (m.text ?? "") : `cb:${samCb.data ?? ""}`;
      const isCmd = text.startsWith("/");
      const command = isCmd ? text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, "") : null;
      const args = command ? text.slice(command.length).trim() : null;
      await sb.from("agencyhub_command_queue").insert({
        chat_id: SAM_CHAT_ID,
        from_user_id: (samMsg?.from?.id ?? samCb?.from?.id) ?? null,
        from_user_name: (samMsg?.from?.username ?? samCb?.from?.username) ?? null,
        message_id: m.message_id ?? null,
        text,
        command,
        args,
      });
      if (samCb) {
        await fetch(TG("answerCallbackQuery"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ callback_query_id: samCb.id }),
        });
      }
    } catch (e) {
      console.error("agencyhub-fork insert failed", e);
    }
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (update.my_chat_member) {
      await handleMyChatMember(update);
      return new Response("ok", { headers: corsHeaders });
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      if (!chatId) return new Response("ok", { headers: corsHeaders });
      await upsertUser(cq.message.chat, cq.from);
      await ingest(chatId, cq.from?.id ?? null, {
        direction: "inbound",
        message_type: "callback_query",
        context: { data: cq.data },
      });
      await handleCallback(chatId, cq.data);
      await fetch(TG("answerCallbackQuery"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback_query_id: cq.id }),
      });
      return new Response("ok", { headers: corsHeaders });
    }

    if (update.message) {
      const m = update.message;
      const chatId = m.chat.id;
      const isGroup = m.chat.type !== "private";
      await upsertUser(m.chat, m.from);

      const text = m.text ?? "";
      const isCmd = text.startsWith("/");
      const command = isCmd ? text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, "") : null;

      await ingest(chatId, m.from?.id ?? null, {
        direction: "inbound",
        message_type: m.contact ? "contact" : (isCmd ? "command" : "text"),
        text,
        command: command ?? undefined,
        context: m.contact ? { contact: m.contact } : {},
      });

      // contact share — match application
      if (m.contact) {
        await matchByContact(chatId, m.contact.phone_number, undefined, m.contact.first_name);
        return new Response("ok", { headers: corsHeaders });
      }

      // escalation pre-check
      if (!isGroup && text) {
        const escalated = await checkEscalation(chatId, text);
        if (escalated) return new Response("ok", { headers: corsHeaders });
      }

      if (command) {
        await handleCommand(chatId, m.from, command, text.slice(command.length).trim(), isGroup);
        return new Response("ok", { headers: corsHeaders });
      }

      // group: only respond if mentioned
      if (isGroup) {
        const mentionsBot = new RegExp(`@${BOT_USERNAME}`, "i").test(text);
        if (mentionsBot) {
          await aiAnswer(chatId, text.replace(new RegExp(`@${BOT_USERNAME}`, "ig"), "").trim());
        }
        return new Response("ok", { headers: corsHeaders });
      }

      // private free-text — advance flow_state or AI
      const { data: user } = await sb.from("telegram_users").select("flow_state").eq("chat_id", chatId).maybeSingle();
      const step = (user?.flow_state as any)?.step;
      if (step === "awaiting_email" && /.+@.+\..+/.test(text)) {
        await matchByContact(chatId, undefined, text.trim());
        return new Response("ok", { headers: corsHeaders });
      }
      if (text.trim().length > 2) {
        await aiAnswer(chatId, text);
      }
      return new Response("ok", { headers: corsHeaders });
    }

    if (update.chat_member) {
      const ev = update.chat_member;
      const newUser = ev.new_chat_member?.user;
      if (newUser && ev.new_chat_member?.status === "member") {
        await tgSend({
          chat_id: ev.chat.id,
          text: `Welcome ${newUser.first_name ?? "in"}. DM @${BOT_USERNAME} with /start to link your file.`,
        });
      }
      return new Response("ok", { headers: corsHeaders });
    }

    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error("webhook error", e);
    return new Response("ok", { headers: corsHeaders }); // never 500 to Telegram
  }
});
