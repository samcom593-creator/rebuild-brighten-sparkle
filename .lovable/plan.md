
# Fix Importer Validation and Add CC to All Emails

## Two Problems to Fix

### 1. Importer Still Rejects Leads With Only Instagram (No Email/Phone)

The current validation at line 285 of `AgedLeadImporter.tsx` requires at least an email OR phone. Leads with only an Instagram handle are rejected.

**Fix**: Change validation so a lead is valid if it has a first name AND at least one contact method (email, phone, OR Instagram handle).

**File: `src/components/dashboard/AgedLeadImporter.tsx`**
- Update validation logic (line 285): accept leads that have any of email, phone, or instagram_handle
- Error message updated to: "Missing email, phone, and Instagram (need at least one)"

### 2. CC Admin + Manager on ALL Outbound Emails

Several edge functions send emails to applicants/agents WITHOUT CC'ing the admin (`info@apex-financial.org`) and the assigned manager. The following functions already have CC implemented correctly:
- `welcome-new-agent` -- has CC
- `notify-agent-contracted` -- has CC
- `notify-agent-login` -- has CC
- `send-agent-portal-login` -- has CC
- `send-course-reminder` -- has CC
- `send-licensing-instructions` -- has CC

**Functions that need CC added:**

| Function | What It Sends | Current CC | Fix |
|----------|--------------|-----------|-----|
| `send-aged-lead-email` | Outreach to aged leads | None | Add CC: admin + manager (pass `managerId` from importer) |
| `send-outreach-email` | Cold/warm outreach templates | None | Add CC: admin + resolve manager from lead's `assigned_agent_id` or `assigned_manager_id` |
| `send-followup-emails` | Automated follow-ups (3 types) | None | Add CC: admin + resolve manager from application's `assigned_agent_id` |
| `send-manual-followup` | Manual follow-up emails | None | Add CC: admin + resolve manager from `agentId` param |
| `send-post-call-followup` | Post-call follow-up | None | Add CC: admin + resolve manager from `agentId` param |
| `notify-lead-assigned` | Lead assignment notification | None | Add CC: admin |
| `send-abandoned-followup` | Abandoned application follow-up | None | Add CC: admin |

**Shared pattern for resolving manager email** (already used in functions like `send-licensing-instructions`):
1. Look up the agent/manager ID from the lead or function params
2. Get the agent's `user_id` from `agents` table
3. Get the email from `auth.admin.getUserById()` (or fallback to `profiles.email`)
4. Build CC list: `[ADMIN_EMAIL, managerEmail].filter(Boolean).filter(unique)`

### Files to Modify

| File | Change |
|------|--------|
| `src/components/dashboard/AgedLeadImporter.tsx` | Accept Instagram-only leads; pass `managerId` to `send-aged-lead-email` |
| `supabase/functions/send-aged-lead-email/index.ts` | Accept `managerId`, resolve manager email, add CC |
| `supabase/functions/send-outreach-email/index.ts` | Resolve manager from lead data, add CC |
| `supabase/functions/send-followup-emails/index.ts` | Resolve manager from application, add CC to all 3 email sends |
| `supabase/functions/send-manual-followup/index.ts` | Resolve manager from agentId, add CC |
| `supabase/functions/send-post-call-followup/index.ts` | Resolve manager from agentId, add CC |
| `supabase/functions/notify-lead-assigned/index.ts` | Add admin CC |
| `supabase/functions/send-abandoned-followup/index.ts` | Add admin CC |

### Technical Pattern

Every email send call will follow this pattern:

```typescript
const ADMIN_EMAIL = "info@apex-financial.org";

// Resolve manager email from agent/manager ID
async function getManagerEmail(supabase, agentOrManagerId) {
  const { data: agent } = await supabase.from("agents").select("user_id, invited_by_manager_id").eq("id", agentOrManagerId).single();
  if (!agent) return null;
  
  // If this agent has a manager, get the manager's email
  const managerId = agent.invited_by_manager_id || agentOrManagerId;
  const { data: manager } = await supabase.from("agents").select("user_id").eq("id", managerId).single();
  if (!manager?.user_id) return null;
  
  const { data: authData } = await supabase.auth.admin.getUserById(manager.user_id);
  return authData?.user?.email || null;
}

// Build CC list
const ccList = [ADMIN_EMAIL, managerEmail]
  .filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i);

// Add to every resend.emails.send call
cc: ccList.length > 0 ? ccList : undefined,
```

This ensures every single email going to an agent or applicant also notifies the admin and their direct manager.
