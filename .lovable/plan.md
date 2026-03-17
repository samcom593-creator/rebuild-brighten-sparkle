

# Import Missing Production Data (No Duplicates)

## What's Already There
Most of this data (03/10 through 03/13, most of 03/12 and 03/16) is already in the database and matches perfectly. Only a few records are missing or incorrect.

## What's Missing / Wrong
| Date | Agent | Expected AOP | Current DB | Issue |
|------|-------|-------------|------------|-------|
| 03/16 | Chukwudi Ifediora | $1,079.64 (1 deal) | No record | Missing |
| 03/16 | Aisha Kebbeh | $677.28 (1 deal) | No record | Missing |
| 03/16 | Brennan Barker | $1,088.76 (1 deal) | $0.00 (1 deal) | AOP wrong |
| 03/14 | Samuel James | $6,423.96 (4 deals) | No record | Missing |
| 03/14 | Mahmod Imran | $5,196.00 (3 deals) | No record | Missing |

## Plan
Call the `import-production-data` edge function with all 48 deals from the pasted data, using `skip_existing: false`. The function aggregates deals per agent per posted_date, then:
- **Existing records**: Overwrites with the correct totals (SET, not ADD)
- **Missing records**: Inserts new rows

This is safe because the function replaces totals rather than adding to them, so already-correct records will just be set to the same values they already have. The 5 problem records above will be fixed.

## Technical Details
- Parse all 48 rows into `{ agent_name, annual_alp, posted_date }` format
- The edge function's `NAME_ALIASES` map handles "Kaeden Vaughns" → "KJ Vaughns" and "Mahmod Imran" → "Moody Imran"
- No code changes needed — just invoke the existing edge function with the data
- No database migration needed

