# Voice Agent System — APEX Automation Hub

**Status:** Building  
**Integration:** Claude CLI + Supabase Edge Functions + Voice Input  

---

## Quick Reference: Voice Commands

### Task Execution (Auto-Accept)
```
"Accept all pending tasks"        → Updates todo status → auto-runs non-reversible actions
"Check applications"               → Query untouched apps → show hot leads
"Run nudge sweep"                  → Invoke nudge-unworked-applications function
"Show stuck agents"                → List 86 agents with 0 deals + age
"What's my DM backlog"             → Query inbox_messages → show count by source
```

### Routing Commands
```
"Switch to Claude for APEX backend"  → Switches session context
"Run website audit"                   → Launches full Lovable audit
"Dispatch to manager digest"          → Triggers accountability email
```

### Status Queries
```
"What tasks are pending?"           → SELECT * FROM master_tasks WHERE status='pending'
"Show me ready tasks"               → SELECT with no unmet dependencies
"How many apps did we contact?"     → Query contacted_at changes last 24h
"Summarize system health"           → Run all status checks, return report
```

---

## Architecture

### Layer 1: Voice Input (This Chat)
- You click 🎤, speak command
- Speech-to-text converts to structured task
- System routes to appropriate agent/function

### Layer 2: Task Dispatch
- Check master_tasks for matching task
- Verify dependencies met (all prior tasks done)
- Execute with auto-accept if marked safe
- Log result back to task

### Layer 3: Execution Engines
1. **Claude Backend** (APEX functions, edge functions, crons)
2. **Codex (Lovable)** (Website, frontend, React)
3. **Zapier/ManyChat** (DM routing)
4. **Direct SQL** (Quick queries, status checks)

### Layer 4: Logging & Confirmation
- Every action logged to task audit table
- Non-reversible actions always confirm
- Results returned immediately in chat

---

## Task Auto-Accept Rules

**SAFE (Auto-Execute):**
- Queries (SELECT only)
- Task status updates
- Logging actions
- Sending templated messages (to users, not public)
- Creating automations (crons, functions)
- Deploying code to non-production

**CONFIRM REQUIRED:**
- Deleting data
- Posting to public (Twitter, TikTok, Instagram)
- Sending money / changing contracts
- Modifying user data (agents, applications, leads)
- Deploying to production main branch
- Terminating automations

---

## Quick Wins (Ready to Execute)

### ✅ Right Now
1. **Build APEX missing functions** (2h, Claude)
   - `send-email` function
   - `send-bulk-email` function
   - Deploy to Supabase

2. **Run website audit** (4h, Codex)
   - Full rebuild-brighten-sparkle scan
   - Performance, SEO, accessibility, UX
   - Return issue list

3. **Setup voice dispatcher** (2h, System)
   - Map voice commands to task IDs
   - Build simple routing logic
   - Test with sample commands

### ✅ Then (Parallel)
4. **Build nudge function** (4h, Claude)
5. **Build DM inbox infra** (5h, Claude)
6. **Fix website issues** (8h, Codex)

---

## How It Works in Practice

**You:** Click 🎤 → "Run application nudge sweep"

**System:**
1. Speech → text: `"Run application nudge sweep"`
2. Match to task: `apex-app-nudge`
3. Check deps: ✅ (depends on: send-email, send-bulk-email functions)
4. Auto-execute: Invoke function with `{dry_run=false, limit=200}`
5. Log result: Update master_tasks, log action timestamp
6. Return: "Nudge sweep completed. Contacted 73 apps (0-3d: 25 SMS, 4-14d: 48 email). Next scheduled: tomorrow 6am."

---

## Next Steps

1. Confirm you want auto-accept enabled (it is by default here)
2. Test voice command: "Check pending tasks"
3. Execute Phase 1: Website audit + missing functions
4. Build out DM infrastructure in parallel

All execution tracked in master_tasks table.
