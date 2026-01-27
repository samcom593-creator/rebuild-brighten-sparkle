
# Complete Data Import - Final Steps

## Current Status

✅ **Moody's $5K Gold Star Plaque** - Successfully sent to moodyimran04@gmail.com

⚠️ **Production Import** - Partially complete. Some deals failed because:

| Missing Agent | Deals | Total ALP | Issue |
|---------------|-------|-----------|-------|
| Obiajulu Ifediora | 16 | $23,195 | Profile exists as "Obi Ifediora" - needs agent record |
| Michael Kayembe | 2 | $1,825 | No profile or agent exists |
| Richard Hall | 1 | $1,179 | No profile or agent exists |
| Codey Salazar | 15 | $18,010 | No agent record linked yet |

---

## Required Database Changes

Create agent records for the missing profiles, then re-import the failed deals:

### SQL to Execute

```sql
-- 1. Create agent for Obi Ifediora (Obiajulu Ifediora in deals)
INSERT INTO agents (profile_id, invited_by_manager_id, status, is_deactivated, onboarding_stage)
SELECT '6a6ea425-36f1-4ac7-ab09-6ad0215c342a', '11213154-5d01-4522-8019-fb3cc7c9672b', 'active', false, 'evaluated'
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE profile_id = '6a6ea425-36f1-4ac7-ab09-6ad0215c342a');

-- 2. Create profile + agent for Michael Kayembe (new person)
INSERT INTO profiles (email, full_name) 
VALUES ('michael.kayembe@placeholder.com', 'Michael Kayembe')
ON CONFLICT DO NOTHING;

INSERT INTO agents (profile_id, invited_by_manager_id, status, is_deactivated, onboarding_stage)
SELECT p.id, '11213154-5d01-4522-8019-fb3cc7c9672b', 'active', false, 'evaluated'
FROM profiles p WHERE p.email = 'michael.kayembe@placeholder.com'
AND NOT EXISTS (SELECT 1 FROM agents WHERE profile_id = p.id);

-- 3. Create profile + agent for Richard Hall (new person)
INSERT INTO profiles (email, full_name)
VALUES ('richard.hall@placeholder.com', 'Richard Hall')
ON CONFLICT DO NOTHING;

INSERT INTO agents (profile_id, invited_by_manager_id, status, is_deactivated, onboarding_stage)
SELECT p.id, '11213154-5d01-4522-8019-fb3cc7c9672b', 'active', false, 'evaluated'
FROM profiles p WHERE p.email = 'richard.hall@placeholder.com'
AND NOT EXISTS (SELECT 1 FROM agents WHERE profile_id = p.id);

-- 4. Create agent for Codey Salazar (TERMINATED)
INSERT INTO agents (profile_id, invited_by_manager_id, status, is_deactivated, onboarding_stage)
SELECT 'b2793b60-b5cf-4b9b-8e35-a456d83cebdf', '11213154-5d01-4522-8019-fb3cc7c9672b', 'terminated', true, 'evaluated'
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE profile_id = 'b2793b60-b5cf-4b9b-8e35-a456d83cebdf');

-- 5. Update profile name matching (Obi → Obiajulu for import function)
UPDATE profiles SET full_name = 'Obiajulu Ifediora' WHERE id = '6a6ea425-36f1-4ac7-ab09-6ad0215c342a';
```

---

## After Database Updates

Re-run the import function with only the failed deals:
- 16 deals for Obiajulu Ifediora ($23,195)
- 2 deals for Michael Kayembe ($1,825)
- 1 deal for Richard Hall ($1,179)
- 15 deals for Codey Salazar ($18,010)

---

## Files Changed So Far

| File | Status |
|------|--------|
| `src/pages/AgentPortal.tsx` | ✅ Updated with animated branding + link |
| `supabase/functions/send-plaque-recognition/index.ts` | ✅ Created |
| `supabase/functions/import-production-data/index.ts` | ✅ Created |
| `supabase/functions/check-weekly-milestones/index.ts` | ✅ Created |
| `supabase/functions/check-monthly-milestones/index.ts` | ✅ Created |
| `supabase/config.toml` | ✅ Updated with new functions |
| `src/components/dashboard/TeamGoalsTracker.tsx` | ✅ Updated to $75K |
| `src/components/dashboard/ProductionEntry.tsx` | ✅ Added milestone triggers |

---

## Deals Successfully Imported

~71 deals were successfully imported, including all production for:
- Mahmod Imran (Moody) ✅
- Aisha Kebbeh ✅
- KJ Vaughns ✅
- Samuel James ✅
- Bryan Ross ✅
- Chukwudi Ifediora ✅
- Joseph Sebasco ✅
- Josiah Darden ✅
- Alex Wordu ✅
- Joe Intwan ✅
- Brennan Barker ✅
