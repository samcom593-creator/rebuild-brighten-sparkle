

# Fix All Historical Production Data (01/17 – 03/22)

## Problem
Previous imports only targeted specific date ranges (03/10+, then 03/17, 03/18-19, 03/20-22). The full historical data from the source (going back to 01/17) was never fully imported. Example discrepancies:
- **Samuel James 02/27**: DB has $10,300 / 10 deals, source shows ~$12,156 / 12 deals (off by ~$1,856)
- **Michael Kayembe 03/16**: Has $1,140 ALP with 0 deals (stale manual entry, no matching carrier deal)
- Similar gaps likely exist across many agents for Jan-Feb-early March

## Fix
Call `import-production-data` with **all ~260+ deals** from the full pasted dataset (01/17 through 03/22) using `skip_existing: false`. The function's SET logic will overwrite every agent-date combination with the correct carrier-verified totals.

This single call fixes:
1. Under-counted historical days (e.g. Samuel James 02/27)
2. Stale manual entries that don't match carrier data (e.g. Kayembe 03/16)
3. Any rounding discrepancies across all dates

## Implementation
- Parse all deals from the full source dataset
- Group by agent + posted_date
- Single edge function invocation
- No code changes, no migrations

## Agents in dataset
Samuel James, Brennan Barker, Jacob Causer, Kaeden Vaughns, Chukwudi Ifediora, Obiajulu Ifediora, Mahmod Imran, Michael Kayembe, Aisha Kebbeh, Loren Lail, Landon Boyd, Bryan Ross, Leslie Patino Galeana, Samuel Lugo Puga, Codey Salazar, Joseph Sebasco, Richard Hall

