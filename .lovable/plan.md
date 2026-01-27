
# Enhanced Duplicate Merge Tool: Email + Phone + Name Detection

## What You Need

The Duplicate Merge Tool should detect and merge agent records that share:
1. **Same Email** (already works)
2. **Same Phone Number** (NEW)
3. **Same Name** (already works)

This ensures all duplicate contact info across the entire system gets consolidated.

---

## Current Duplicates in System

| Match Type | Agent 1 | Agent 2 | Matching Value |
|------------|---------|---------|----------------|
| Phone | KJ Vaughns ($0) | KJ TestV ($0) | 6015404885 |
| Name | Joseph Sebasco ($4,640) | Joseph Sebasco ($0) | Same name |

---

## Current Tool Limitations

1. **No phone matching** - Only checks email and name
2. **Phone not displayed** - Even if matched, you can't see phone in the UI
3. **No profile query for phone** - The query doesn't fetch phone field

---

## Implementation Changes

### File: `src/components/admin/DuplicateMergeTool.tsx`

**Changes:**

1. **Update `DuplicateGroup` interface** to include `"phone"` as a matchType:
```typescript
matchType: "email" | "name" | "phone";
```

2. **Update agent interface** to include phone:
```typescript
agents: Array<{
  id: string;
  profileId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;  // NEW
  totalAlp: number;
  totalDeals: number;
}>;
```

3. **Update the Supabase query** to fetch phone from profiles:
```typescript
profiles!agents_profile_id_fkey (
  id,
  full_name,
  email,
  phone  // ADD THIS
)
```

4. **Add phone-based duplicate detection** after email detection:
```typescript
// Detect duplicates by phone
const phoneGroups = new Map<string, typeof agentList>();
agentList.forEach((agent) => {
  if (agent.phone && agent.phone.trim()) {
    // Normalize phone: remove non-digits
    const normalizedPhone = agent.phone.replace(/\D/g, "");
    if (normalizedPhone.length >= 10) {
      const group = phoneGroups.get(normalizedPhone) || [];
      group.push(agent);
      phoneGroups.set(normalizedPhone, group);
    }
  }
});

// Add phone duplicates to groups
phoneGroups.forEach((group, phone) => {
  if (group.length > 1) {
    const ids = group.map((a) => a.id).sort().join(",");
    if (!seenIds.has(ids)) {
      seenIds.add(ids);
      duplicateGroups.push({
        key: phone,
        matchType: "phone",
        agents: group,
      });
    }
  }
});
```

5. **Update UI to show phone** in agent cards:
```typescript
<p className="text-xs text-muted-foreground truncate">
  {agent.email || "No email"} 
  {agent.phone && ` • ${agent.phone}`}
  • ID: {agent.id.slice(0, 8)}...
</p>
```

6. **Update Badge display** for phone matches:
```typescript
<Badge variant="outline">
  {group.matchType === "email" 
    ? "Same Email" 
    : group.matchType === "phone" 
      ? "Same Phone" 
      : "Same Name"}
</Badge>
```

---

## Detection Priority Order

1. **Email** - Highest confidence (unique identifier)
2. **Phone** - High confidence (personal number)
3. **Name** - Lower confidence (may have false positives)

If agents are already grouped by email, they won't be re-grouped by phone or name (prevents duplicates in the list).

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/admin/DuplicateMergeTool.tsx` | Add phone to interface, query, detection logic, and UI display |

---

## Expected Result After Implementation

The Duplicate Merge Tool will show:

| Duplicate Group | Type | Action |
|-----------------|------|--------|
| KJ Vaughns + KJ TestV | Same Phone | Select primary → Merge |
| Joseph Sebasco (x2) | Same Name | Select primary → Merge |

With phone numbers visible in each agent card for easy verification.

---

## Summary

This enhancement adds phone number matching to catch duplicates that the email/name detection misses, giving you complete coverage for merging all duplicate records across the system.
