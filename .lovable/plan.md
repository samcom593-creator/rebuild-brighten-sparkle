

## Globe Life-Style "Outstanding Performance" Certificate Implementation

### Overview

You want to implement a professional certificate format inspired by the Globe Life "Outstanding Performance" plaque, but branded for Apex Financial. The system will:

1. **Send certificate emails to Admin only** for weekly/milestone accolades
2. **Send the same certificate format to the Agent** with their name personalized
3. Use the clean, formal design from the Globe Life PDF (without their logo - using Apex branding instead)

---

### Certificate Design Specifications

Based on the uploaded PDF, the certificate format will include:

| Element | Content |
|---------|---------|
| Header | "OUTSTANDING PERFORMANCE" (large, bold) |
| Company | "APEX Financial Group" |
| Intro | "hereby expresses its appreciation to" |
| Name | **[AGENT NAME]** (bold, prominent) |
| Achievement | "for outstanding achievement for the week ending" |
| Date | **[WEEK ENDING DATE]** (formatted nicely) |
| Amount | "FOR WRITING $X,XXX IN ALP" |
| Closing | "Your efforts are greatly appreciated." |
| Signature | Owner's signature line |
| Footer | "Powered by Apex Financial" |

---

### Implementation Plan

#### Step 1: Create New Email Template Function

**File: `supabase/functions/send-outstanding-performance/index.ts`** (NEW)

This new edge function will:
- Accept `agentId`, `amount`, `weekEndingDate`, `milestoneType`
- Generate the Globe Life-style certificate HTML
- Send to admin (info@kingofsales.net) with full details
- Send to the agent with the same certificate format
- Use clean, screenshot-worthy design without emojis in the body

#### Step 2: Certificate HTML Template

```html
<!-- Premium Certificate Design -->
<body style="background:#ffffff;">
  <div style="max-width:700px;margin:0 auto;padding:60px;">
    
    <!-- Gold accent line -->
    <div style="border-top:4px solid #C9A962;margin-bottom:40px;"></div>
    
    <!-- Main Header -->
    <h1 style="font-family:Georgia,serif;font-size:42px;font-weight:bold;
               color:#1a1a1a;margin:0 0 8px;letter-spacing:2px;">
      OUTSTANDING
    </h1>
    <h1 style="font-family:Georgia,serif;font-size:42px;font-weight:bold;
               color:#1a1a1a;margin:0 0 40px;letter-spacing:2px;">
      PERFORMANCE
    </h1>
    
    <!-- Company Name -->
    <p style="font-size:18px;font-weight:600;color:#333;margin:0 0 8px;">
      APEX Financial Group
    </p>
    <p style="font-size:14px;color:#666;margin:0 0 30px;">
      hereby expresses its appreciation to
    </p>
    
    <!-- Agent Name (Bold, Large) -->
    <h2 style="font-family:Georgia,serif;font-size:32px;font-weight:bold;
               color:#1a1a1a;margin:0 0 30px;">
      [AGENT NAME]
    </h2>
    
    <!-- Achievement Description -->
    <p style="font-size:14px;color:#666;margin:0 0 8px;">
      for outstanding achievement for the week ending
    </p>
    <p style="font-size:20px;font-weight:bold;color:#1a1a1a;margin:0 0 8px;">
      [WEEK ENDING DATE]
    </p>
    <p style="font-size:22px;font-weight:bold;color:#1a1a1a;margin:0 0 30px;">
      FOR WRITING $X,XXX IN ALP
    </p>
    
    <!-- Appreciation -->
    <p style="font-size:14px;font-style:italic;color:#666;margin:0 0 40px;">
      Your efforts are greatly appreciated.
    </p>
    
    <!-- Signature -->
    <div style="margin-top:30px;">
      <p style="font-family:'Brush Script MT',cursive;font-size:28px;
                color:#333;margin:0 0 8px;">
        [Owner Signature]
      </p>
      <div style="border-top:1px solid #333;width:200px;margin-bottom:8px;"></div>
      <p style="font-size:12px;color:#666;margin:0;">
        [Owner Name]<br>
        Chief Executive Officer<br>
        APEX Financial Group
      </p>
    </div>
    
  </div>
</body>
```

#### Step 3: Update Weekly Milestone Check

**File: `supabase/functions/check-weekly-milestones/index.ts`**

Modify to call the new `send-outstanding-performance` function for weekly achievements, ensuring both admin and agent receive the certificate.

#### Step 4: Email Distribution Logic

- **To Admin**: Full certificate + agent details + any additional notes
- **To Agent**: Same certificate with their name, clean format

---

### Technical Details

#### New Edge Function Structure

```typescript
// supabase/functions/send-outstanding-performance/index.ts

interface PerformanceRequest {
  agentId: string;
  amount: number;
  weekEndingDate: string;
  ownerName?: string;  // Default: "King of Sales"
}

// 1. Fetch agent details (name, email)
// 2. Generate certificate HTML
// 3. Send to admin (info@kingofsales.net)
// 4. Send to agent with same format
```

#### Subject Lines

- **Admin**: `Weekly Performance: [Agent Name] - $X,XXX ALP`
- **Agent**: `Outstanding Performance Recognition - [Week Ending Date]`

---

### Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/functions/send-outstanding-performance/index.ts` | CREATE - New Globe Life-style certificate |
| `supabase/functions/check-weekly-milestones/index.ts` | MODIFY - Trigger new certificate function |
| `supabase/config.toml` | MODIFY - Add new function config |

---

### Expected Results

1. **Admin receives** a formal "Outstanding Performance" certificate email for each agent milestone
2. **Agent receives** the same certificate with their name, clean and screenshot-worthy
3. **Design matches** the Globe Life PDF format but with Apex Financial branding
4. **Professional appearance** - no emojis in the certificate body, formal tone

