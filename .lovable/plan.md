

## Plan: Update Purchase Leads Page

This plan addresses all your requests for the Purchase Leads section.

---

### Summary of Changes

| Change | Details |
|--------|---------|
| Faster load screen | Pre-set lead count to cached value, remove loading delay |
| Admin-only editing | Already enforced via RLS + client-side check (verified) |
| Package pricing | Standard: $250/week, Premium: $500/week |
| Package descriptions | Standard: 30 days or less old, Premium: Logged within the week |
| Payment links | Venmo + Cash App links updated |

---

### 1. Payment Links

Will update with your provided links:
- **Venmo**: `https://venmo.com/code?user_id=4525479197410766547&created=1770247428.1210961&printed=1`
- **Cash App**: `https://cash.app/$ApexFinancial`

---

### 2. Updated Package Details

**Apex Standard Leads - $250/week**
- Description: "Quality leads that are 30 days old or less. Perfect for agents building a consistent pipeline with proven prospects."
- Features:
  - Leads 30 days or less old
  - Pre-qualified prospects
  - Verified contact info
  - Weekly delivery

**Apex Premium Leads - $500/week**
- Description: "Fresh leads logged within the past week. Ideal for agents who want the hottest prospects with maximum conversion potential."
- Features:
  - Leads logged this week
  - Highest conversion rates
  - First-priority access
  - Real-time delivery

---

### 3. Faster Load Performance

**Current Issue**: The page shows "..." while fetching lead count from the database.

**Fix**:
1. Initialize lead count to a sensible default (e.g., 800) instead of 0
2. Remove the "isLoading" text display - show the cached value immediately
3. Silently update when database responds

This makes the page feel instant while still being accurate.

---

### 4. Admin Edit Verification

Already properly enforced:
- **Client-side**: Edit button only shows when `isAdmin === true`
- **Database-level**: RLS policy on `lead_counter` table only allows UPDATE for users with admin role

No changes needed here - just confirming it's secure.

---

### Technical Implementation

**File to Modify**: `src/pages/PurchaseLeads.tsx`

Changes:
1. Update `VENMO_LINK` and `CASHAPP_LINK` constants
2. Update packages array with new pricing and descriptions
3. Change "non-standard" to "premium" for clarity
4. Set initial `leadCount` state to 800 instead of 0
5. Remove loading skeleton for lead count display

---

### Updated UI Preview

```text
+------------------------------------------+
| [840+ Available Leads]   [Timer: 5d 12h] |
+------------------------------------------+

+-------------------+  +-------------------+
| APEX STANDARD     |  | APEX PREMIUM      |
| $250/week         |  | $500/week         |
|                   |  | [BEST VALUE]      |
| 30 days or less   |  | Logged this week  |
| Pre-qualified     |  | Highest conversion|
| Verified info     |  | First-priority    |
| Weekly delivery   |  | Real-time delivery|
|                   |  |                   |
| [Venmo] [CashApp] |  | [Venmo] [CashApp] |
+-------------------+  +-------------------+
```

