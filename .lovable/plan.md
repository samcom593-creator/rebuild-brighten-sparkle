
## Complete Platform Fix - Phone Number Support & Full System Verification

Based on my comprehensive audit, I've identified all the issues and prepared a complete fix plan. This covers phone number linking, CORS standardization, and ensuring all mechanisms work end-to-end.

---

### Summary of Changes

| Component | Fix | Priority |
|-----------|-----|----------|
| `link-account` edge function | Add phone number as 3rd linking method | HIGH |
| `AccountLinkForm.tsx` | Add Phone tab UI with formatted input | HIGH |
| `simple-login` edge function | Update CORS headers for platform compatibility | MEDIUM |
| `send-bulk-portal-logins` edge function | Update CORS headers | MEDIUM |
| `send-agent-portal-login` edge function | Update CORS headers | MEDIUM |
| Database | Auto-generate agent codes for unlinked agents | MEDIUM |

---

### 1. Link-Account Edge Function - Add Phone Support

**File:** `supabase/functions/link-account/index.ts`

**Changes:**
- Add `phone?: string` to the request interface
- Add phone normalization logic (extract last 10 digits)
- Search `profiles` table for matching phone
- Also search `applications` table as fallback
- Validate 10-digit minimum requirement

```typescript
// Updated interface
interface LinkAccountRequest {
  email?: string;
  agentCode?: string;
  phone?: string;  // NEW
}

// Phone search logic (new block after email logic)
else if (phone) {
  const digitsOnly = phone.replace(/\D/g, "").slice(-10);
  
  if (digitsOnly.length < 10) {
    return new Response(
      JSON.stringify({ error: "Please enter a valid 10-digit phone number" }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Search profiles by phone
  const { data: profilesByPhone } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .or(`phone.ilike.%${digitsOnly}%`)
    .limit(5);

  if (profilesByPhone?.length > 0) {
    const profileIds = profilesByPhone.map(p => p.id);
    agentQuery = agentQuery.in("profile_id", profileIds);
  } else {
    // Fallback: search applications
    const { data: application } = await supabaseAdmin
      .from("applications")
      .select("id, first_name, last_name, phone, contracted_at")
      .or(`phone.ilike.%${digitsOnly}%`)
      .not("contracted_at", "is", null)
      .maybeSingle();

    if (application) {
      const fullName = `${application.first_name} ${application.last_name}`.trim();
      agentQuery = agentQuery.ilike("display_name", fullName);
    } else {
      return new Response(
        JSON.stringify({ error: "No agent profile found with this phone number" }),
        { status: 404, headers: corsHeaders }
      );
    }
  }
}
```

---

### 2. AccountLinkForm Component - Add Phone Tab

**File:** `src/components/dashboard/AccountLinkForm.tsx`

**Changes:**
- Import `Phone` icon from lucide-react
- Add `phone` state variable
- Add third tab in TabsList for phone
- Add TabsContent for phone with formatted input
- Update `handleLink` to support "phone" method

```typescript
// New imports
import { Mail, Hash, Phone, LogOut, Loader2, CheckCircle, AlertCircle } from "lucide-react";

// New state
const [phone, setPhone] = useState("");

// Updated TabsList - 3 columns
<TabsList className="grid w-full grid-cols-3 mb-4">
  <TabsTrigger value="email" className="flex items-center gap-2">
    <Mail className="h-4 w-4" />
    Email
  </TabsTrigger>
  <TabsTrigger value="phone" className="flex items-center gap-2">
    <Phone className="h-4 w-4" />
    Phone
  </TabsTrigger>
  <TabsTrigger value="code" className="flex items-center gap-2">
    <Hash className="h-4 w-4" />
    Code
  </TabsTrigger>
</TabsList>

// New phone tab content
<TabsContent value="phone" className="space-y-4">
  <div className="text-left">
    <label className="text-sm font-medium text-muted-foreground mb-1 block">
      Your registered phone number
    </label>
    <Input
      type="tel"
      placeholder="(555) 123-4567"
      value={phone}
      onChange={(e) => setPhone(e.target.value)}
      className="w-full"
    />
    <p className="text-xs text-muted-foreground mt-1">
      Enter the phone number on file with your manager
    </p>
  </div>
  <Button
    onClick={() => handleLink("phone")}
    disabled={isLinking || phone.replace(/\D/g, "").length < 10}
    className="w-full"
    size="lg"
  >
    {isLinking ? (
      <>
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Linking...
      </>
    ) : (
      "Link with Phone"
    )}
  </Button>
</TabsContent>

// Updated handleLink function
const handleLink = async (method: "email" | "code" | "phone") => {
  const payload = 
    method === "email" ? { email: email.trim() } :
    method === "phone" ? { phone: phone.trim() } :
    { agentCode: agentCode.trim() };
  // ... rest stays same
}
```

---

### 3. Update CORS Headers in Key Edge Functions

These functions have outdated CORS headers that may cause issues on modern platforms:

**Files to update:**
- `supabase/functions/simple-login/index.ts`
- `supabase/functions/send-bulk-portal-logins/index.ts`
- `supabase/functions/send-agent-portal-login/index.ts`

**Current (outdated):**
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
```

**Updated (platform compatible):**
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
```

---

### 4. Database Migration - Auto-Generate Agent Codes

Create a migration to generate unique agent codes for all agents currently without one:

```sql
-- Generate agent codes for agents that don't have them
-- Format: First 3 letters of name + 4 random digits (e.g., "SAM4829")
UPDATE agents 
SET agent_code = UPPER(
  SUBSTRING(
    REGEXP_REPLACE(COALESCE(display_name, 'AGT'), '[^A-Za-z]', '', 'g') FROM 1 FOR 3
  ) || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0')
)
WHERE agent_code IS NULL OR agent_code = '';

-- Ensure uniqueness by adding suffix for duplicates
WITH duplicates AS (
  SELECT agent_code, ARRAY_AGG(id) as ids
  FROM agents
  GROUP BY agent_code
  HAVING COUNT(*) > 1
)
UPDATE agents a
SET agent_code = a.agent_code || SUBSTRING(a.id::text FROM 1 FOR 2)
WHERE a.id IN (
  SELECT UNNEST(ids[2:])
  FROM duplicates
);
```

---

### 5. Files Modified Summary

| File | Action |
|------|--------|
| `supabase/functions/link-account/index.ts` | Add phone search logic |
| `src/components/dashboard/AccountLinkForm.tsx` | Add Phone tab UI |
| `supabase/functions/simple-login/index.ts` | Update CORS headers |
| `supabase/functions/send-bulk-portal-logins/index.ts` | Update CORS headers |
| `supabase/functions/send-agent-portal-login/index.ts` | Update CORS headers |
| Database migration | Generate agent codes |

---

### Testing Checklist

After implementation:
- [ ] Link account with email works on published site
- [ ] Link account with phone works (any format: 555-123-4567, (555) 123-4567, etc.)
- [ ] Link account with agent code works
- [ ] Bulk email sends successfully to all agents
- [ ] Magic links auto-authenticate and persist sessions
- [ ] Leaderboards update in real-time with LIVE indicator
- [ ] Custom date range filter works in Agent Portal
- [ ] Dashboard quick actions navigate correctly

---

### Expected Outcome

After these fixes:
- Users can link their login using **email, phone number, OR agent code**
- All edge functions have consistent, modern CORS headers
- Every agent has a unique code for easy identification
- The entire platform functions seamlessly from login to production tracking
