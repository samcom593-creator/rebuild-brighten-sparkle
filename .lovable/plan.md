

# Import 03/20–03/22 Production Data + Fix Discrepancies

## Current DB State
- **03/22**: Missing entirely — Samuel James $2,458.92 (1 deal) not in DB
- **03/21**: Correct — Brennan $1,370.52, Jacob $876.00, KJ Vaughns $3,364.20 ✓
- **03/20**: Jacob Causer shows $2,232.00 but source totals $2,233.20 (off by $1.20). All other agents correct.
- **03/19 and earlier**: Already imported from previous batches

## Approach
Invoke `import-production-data` with all deals from the full dataset using `skip_existing: false`. The function uses SET logic (not additive), so:
- **03/22**: Inserts Samuel James's new record
- **03/20**: Fixes Jacob Causer's $1.20 rounding error
- **03/21 and earlier**: Overwrites with same correct values (no-op effectively)

This also catches any other small rounding issues across the entire date range (01/19–03/22).

Single edge function call with all ~200+ deals. No code changes needed.

