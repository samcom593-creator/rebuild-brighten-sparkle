

# Add Name Aliases to Production Import

## Problem
The carrier report lists agents as "Kaeden Vaughns" and "Mahmod Imran", but the system has them as **"KJ Vaughns"** and **"Moody Imran"**. The import function does exact name matching, so their 13 deals were skipped.

## Solution
Add an alias map in the `import-production-data` edge function that maps alternate carrier names to the canonical system names before lookup.

### Changes to `supabase/functions/import-production-data/index.ts`
- Add a `NAME_ALIASES` map at the top:
  - `"kaeden vaughns"` → `"kj vaughns"`
  - `"mahmod imran"` → `"moody imran"`
- Before looking up `agentKey` in `agentNameMap`, check if it exists in `NAME_ALIASES` and remap it

### Then Re-import
After deploying the updated function, re-invoke the import with only the 13 previously failed deals for Kaeden/Mahmod with `skip_existing: true`.

**Deals to retry:**
- Mahmod Imran: 7 deals totaling $8,100 (dates: 03/10, 03/09, 03/12, 03/06)
- Kaeden Vaughns: 6 deals totaling $9,557.16 (dates: 03/08, 03/09, 03/11, 03/12)

