

# Complete Email Domain Migration: `tx.apex-financial.org` → `apex-financial.org`

## Status
All **86 edge functions** still contain the unverified `tx.apex-financial.org` domain. Previous attempts were interrupted by platform capacity issues before changes were saved.

## Plan
Global search-and-replace across all 86 files in `supabase/functions/`:

**Find:** `tx.apex-financial.org`  
**Replace:** `apex-financial.org`

This is a simple string replacement — no logic changes, no restructuring. Every `from:` email field gets updated to use the verified root domain.

I will process all 86 files in parallel batches to complete this in one pass.

