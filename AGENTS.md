# Agent Context for APEX-OS

## About You
- **Name:** Sam James, Christian entrepreneur
- **Handles:** @theprincejamez (IG, YouTube, TikTok, everywhere)
- **Companies:** APEX Financial (insurance agency/FMO), King of Sales (kingofsales.net)
- **Personal email:** sam.com593@gmail.com
- **Business email:** info@kingofsales.net

## How You Want Me to Work

### Communication Style
- Talk like a smart assistant, not a tech doc
- Short paragraphs, plain English
- No bullet walls or markdown headers in chat replies
- Save technical detail for files and commits
- Multi-topic replies: lead each with a bolded one-liner for phone scanning
- Match your energy — move fast

### Decision-Making
- Don't ask "should I" — pick the most reasonable path, state it in one line, then execute
- Only pause for irreversible actions (sending money, public posts, destructive git ops)
- Banned phrases: "want me to", "should I", "say go"
- Tie tactical work back to business impact or personal benefit

### Execution vs Analysis (NEW — 2026-05-14)
Claude is the **execution engine**. Codex owns deep analysis.

**Claude does (in this repo):** coding, file edits, terminal work, UI implementation, component building, route fixes, form fixes, styling, dashboard implementation, bug fixes, git commits, tests, deployment prep.

**Codex does (Sam runs separately):** architecture analysis, root-cause analysis, AgentLink integration audit, API/webhook audit, database/data model review, dashboard metric logic, permission logic, security review, scale-readiness review, hidden bug detection, QA audit plans.

Before any large analysis task, Claude pauses and drafts a copy-paste Codex prompt scoped to ONE system, ONE bug, or ONE decision. Sam runs Codex, hands back the answer, Claude implements.

## Project Context: APEX-OS Website

### Repository & Deployment
- **Repo:** github.com/samcom593-creator/rebuild-brighten-sparkle
- **Local path on this machine:** ~/Projects/rebuild-brighten-sparkle/
- **Hosting:** Vercel (auto-deploys on push to main). `vercel.json` configured.
- **NOT Lovable anymore.** Lovable as a hosting platform and AI builder is removed. The repo is edited directly by Claude Code via Sam's local terminal.

### Tech Stack
- **Frontend:** React 18 + TypeScript + Vite + shadcn/ui + Tailwind + react-router v7 + TanStack Query
- **Backend:** Supabase project **`xrzweoneiieddzxogewk`** (the *current* one — the project flipped from `msydzhzolwourcdmqxvn` on 2026-04-30)
  - 163+ edge functions in `supabase/functions/`
  - 32+ cron jobs
  - PostgreSQL triggers
- **Auth gateway dependency `@lovable.dev/cloud-auth-js`** is still used by Edge Functions (AI gateway). Do NOT remove without replacing the AI calls in `analyze-*`, `ai-*`, `transcribe-*`, `parse-schedule-image`, `generate-quiz-questions`.

### Source of truth for live data
- bot-sql Edge Function: POST `https://xrzweoneiieddzxogewk.supabase.co/functions/v1/bot-sql` with `{"query": "..."}` body. Bearer token at `~/.config/apex-creds/bot-sql.token` (Sam's machine). Runs as `postgres` role.
- Production numbers source: `agentlink.insuracloud.ai` — but the dashboards read from the local Supabase mirror.
- Two Sam auth accounts: `71826bba` (sam.com593@gmail.com, **canonical**) and `811fc5f4` (info@kingofsales.net).
- KJ Vaughn: auth `75b17131-...`, agent `431dff0d-...`, email kjvaughns13@gmail.com, agent_code KJV01, is_presenting=true. Has 38 apps assigned after 2026-05-14 routing fix.

### Important Notes
- **`apex-financial.org`** — this domain points to the SAME Vercel deployment as the OS now; AGENTS.md previously said "separate minimal page" — that's stale. Verify before relying on this.
- **`deals.posted_at` is the canonical deal date.** `submitted_at` and `close_date` are always NULL.
- **`applications.hiring_manager_user_id` grants visibility** via the RLS policy added 2026-05-14 — managers can now see apps routed to them as hiring managers (previously only `assigned_agent_id` worked).
- **Phantom user_id `4491dc82-...`** previously held 294 applications and didn't exist in auth.users. Cleared 2026-05-14.

---

**Last Updated:** 2026-05-14
